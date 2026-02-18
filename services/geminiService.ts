import { GoogleGenAI, Type } from "@google/genai";
import { Medication } from "../types";

const geminiApiKey =
  process.env.API_KEY ||
  process.env.GEMINI_API_KEY ||
  "";

const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;
const CHAT_RECENT_WINDOW = 12;
const CHAT_OLDER_DIGEST_LIMIT = 16;
const CHAT_LINE_MAX_CHARS = 120;
const CHAT_TIMEOUT_MS = 8000;
const SAFETY_FLASH_TIMEOUT_MS = 10000;
const SAFETY_PRO_TIMEOUT_MS = 12000;
const CHAT_PRIMARY_MODEL = 'gemini-2.5-flash';
const CHAT_FALLBACK_MODEL = 'gemini-2.5-flash-lite';
const SAFETY_FAST_MODEL = 'gemini-2.5-flash';
const SAFETY_FAST_FALLBACK_MODEL = 'gemini-2.5-flash-lite';
const SAFETY_PRO_MODEL = 'gemini-2.5-pro';
const SAFETY_PRO_FALLBACK_MODEL = 'gemini-2.5-flash';

export type InteractionSeverity = 'High' | 'Moderate' | 'Low' | 'None';

export interface InteractionItem {
  severity: InteractionSeverity;
  description: string;
  drugs: string[];
}

export interface DrugInteractionAnalysis {
  summary: string;
  interactions: InteractionItem[];
}

export interface HealthChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

const normalizeSeverity = (value: string): InteractionSeverity => {
  if (value === 'High' || value === 'Moderate' || value === 'Low' || value === 'None') {
    return value;
  }
  return 'None';
};

const buildMedicationContext = (medications: Medication[]) => {
  if (medications.length === 0) return 'No medications currently listed.';
  return medications
    .map((m, idx) => `${idx + 1}. ${m.name} (${m.dosage || 'dosage not specified'})`)
    .join('\n');
};

const buildConditionContext = (conditions: string[]) => {
  if (!conditions || conditions.length === 0) return 'No medical conditions listed.';
  return conditions.map((c, idx) => `${idx + 1}. ${c}`).join('\n');
};

const parseJsonResponse = <T>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const fenced =
      raw.match(/```json\s*([\s\S]*?)```/i)?.[1] ||
      raw.match(/```([\s\S]*?)```/i)?.[1];
    if (!fenced) return null;
    try {
      return JSON.parse(fenced) as T;
    } catch {
      return null;
    }
  }
};

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const toFriendlyAiError = (error: unknown): string => {
  const e = error as any;
  const raw =
    e?.message ||
    e?.error?.message ||
    e?.statusText ||
    (typeof e === 'string' ? e : '');
  const msg = String(raw || '').toLowerCase();

  if (msg.includes('timed out')) {
    return "AI is taking too long right now. Please retry.";
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('permission') || msg.includes('api key')) {
    return "AI access failed (API key or restrictions). Check Gemini key permissions and allowed origins.";
  }
  if (msg.includes('not found') || msg.includes('model')) {
    return "AI model is unavailable for this key/project. Try another model or verify API access.";
  }

  return "AI request failed. Check internet connection and Gemini API configuration.";
};

const interactionResponseSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    interactions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          severity: {
            type: Type.STRING,
            enum: ['High', 'Moderate', 'Low', 'None']
          },
          description: { type: Type.STRING },
          drugs: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ['severity', 'description', 'drugs']
      }
    }
  },
  required: ['summary', 'interactions']
};

const sanitizeInteractionResult = (parsed: Partial<DrugInteractionAnalysis>): DrugInteractionAnalysis => {
  const interactions = Array.isArray(parsed.interactions) ? parsed.interactions : [];
  return {
    summary: parsed.summary?.trim() || "No analysis summary returned.",
    interactions: interactions.map((item: any) => ({
      severity: normalizeSeverity(item?.severity || 'None'),
      description:
        typeof item?.description === 'string' && item.description.trim().length > 0
          ? item.description.trim()
          : 'No specific interaction details provided.',
      drugs: Array.isArray(item?.drugs)
        ? item.drugs.filter((d: unknown) => typeof d === 'string')
        : []
    }))
  };
};

const buildHistoryForModel = (history: HealthChatMessage[]) => {
  const cleanHistory = history.filter((m) => m.text.trim().length > 0);
  if (cleanHistory.length <= CHAT_RECENT_WINDOW) {
    return cleanHistory.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }]
    }));
  }

  const older = cleanHistory.slice(0, -CHAT_RECENT_WINDOW);
  const recent = cleanHistory.slice(-CHAT_RECENT_WINDOW);

  const olderDigest = older
    .slice(-CHAT_OLDER_DIGEST_LIMIT)
    .map((m) => {
      const text = m.text.replace(/\s+/g, ' ').trim().slice(0, CHAT_LINE_MAX_CHARS);
      return `${m.role === 'assistant' ? 'AI' : 'User'}: ${text}`;
    })
    .join('\n');

  return [
    {
      role: 'user',
      parts: [{
        text: `Conversation memory summary from older chats:\n${olderDigest}`
      }]
    },
    ...recent.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }]
    }))
  ];
};

export const chatWithHealthAssistant = async (
  userMessage: string,
  medications: Medication[],
  conditions: string[],
  history: HealthChatMessage[] = []
): Promise<string> => {
  if (!ai) {
    return "AI is not configured. Add your Gemini API key in environment variables.";
  }

  const medContext = buildMedicationContext(medications);
  const conditionContext = buildConditionContext(conditions);
  const fullHistory = buildHistoryForModel(history);

  const systemInstruction = [
    "You are PillCare AI Health Assistant.",
    "Use only the user medication and condition context provided below as the primary source of truth.",
    "Medication context:",
    medContext,
    "Condition context:",
    conditionContext,
    "Answer in concise, professional language.",
    "Keep each response under 120 words unless the user explicitly asks for detail.",
    "Provide practical guidance and remind the user to consult a licensed clinician for decisions."
  ].join('\n');

  const runChatModel = async (
    model: string,
    historyPayload: Array<{ role: string; parts: Array<{ text: string }> }>,
    timeoutMs: number
  ) => {
    return await withTimeout(
      ai.models.generateContent({
        model,
        contents: [
          ...historyPayload,
          {
            role: 'user',
            parts: [{ text: userMessage }]
          }
        ],
        config: { systemInstruction }
      }),
      timeoutMs,
      `${model} chat`
    );
  };

  try {
    const response = await runChatModel(CHAT_PRIMARY_MODEL, fullHistory, CHAT_TIMEOUT_MS);

    return (response.text || "I couldn't generate a response right now.").trim();
  } catch (error) {
    try {
      // Fallback with a tighter recent-window context if request is slow or fails.
      const shortHistory = buildHistoryForModel(history.slice(-60));
      const retry = await runChatModel(CHAT_FALLBACK_MODEL, shortHistory, CHAT_TIMEOUT_MS);

      return (retry.text || "I couldn't generate a response right now.").trim();
    } catch (retryError) {
      console.error("Error chatting with health assistant:", error, retryError);
      return toFriendlyAiError(retryError);
    }
  }
};

export const analyzeDrugInteractions = async (
  medications: Medication[],
  allergies: string[]
): Promise<DrugInteractionAnalysis> => {
  if (!ai) {
    return {
      summary: "AI is not configured. Add your Gemini API key in environment variables.",
      interactions: []
    };
  }

  if (medications.length < 1) {
    return {
      summary: "Add at least one medication to run an interaction check.",
      interactions: []
    };
  }

  const medList = medications.map((m) => `${m.name} (${m.dosage})`).join(", ");
  const allergyList = allergies.length > 0 ? allergies.join(", ") : "No known allergies listed";

  const prompt = `
You are a medication safety analyzer.
Patient medications: ${medList}
Patient allergies: ${allergyList}

Analyze:
1) Potential drug-drug interactions among listed medications.
2) Potential allergy-related risks based on listed allergies.

Rules:
- Return only structured medical-safety findings.
- If no interaction is known, include one interaction object with severity "None".
- Keep descriptions concise and clinically professional.
  `;

  const runModel = async (model: string, timeoutMs: number) => {
    const response = await withTimeout(ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: interactionResponseSchema
      }
    }), timeoutMs, `${model} safety check`);

    const raw = response.text || '{}';
    const parsed = parseJsonResponse<Partial<DrugInteractionAnalysis>>(raw) || {};
    return sanitizeInteractionResult(parsed);
  };

  try {
    // Fast-first path for better UX.
    return await runModel(SAFETY_FAST_MODEL, SAFETY_FLASH_TIMEOUT_MS);
  } catch (error) {
    try {
      // Fast fallback model.
      return await runModel(SAFETY_FAST_FALLBACK_MODEL, SAFETY_FLASH_TIMEOUT_MS);
    } catch (fallbackError) {
      try {
        // Higher-accuracy fallback.
        return await runModel(SAFETY_PRO_MODEL, SAFETY_PRO_TIMEOUT_MS);
      } catch (proError) {
        try {
          // Pro backup model.
          return await runModel(SAFETY_PRO_FALLBACK_MODEL, SAFETY_PRO_TIMEOUT_MS);
        } catch (proFallbackError) {
          console.error("Error analyzing interactions:", error, fallbackError, proError, proFallbackError);
          return {
            summary: toFriendlyAiError(proFallbackError),
            interactions: []
          };
        }
      }
    }
  }
};

// Helper to convert blob/file to base64
const fileToGenerativePart = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // Remove data url prefix (e.g., "data:image/jpeg;base64,")
      const base64Data = base64String.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const scanMedicationBottle = async (imageFile: File): Promise<{
  medication?: Partial<Medication>,
  rawText: string
}> => {
  if (!ai) {
    return { rawText: "AI is not configured. Add your Gemini API key in environment variables." };
  }

  const base64Data = await fileToGenerativePart(imageFile);

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: imageFile.type
            }
          },
          {
            text: "Extract the medication name, dosage, and instructions from this image. Return the result in JSON format with keys: name, dosage, instructions. Also provide a short summary text."
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            dosage: { type: Type.STRING },
            instructions: { type: Type.STRING },
            summary: { type: Type.STRING }
          }
        }
      }
    });

    const text = response.text || "{}";
    const json = parseJsonResponse<Record<string, string>>(text) || {};

    return {
      medication: {
        name: json.name,
        dosage: json.dosage,
        instructions: json.instructions,
      },
      rawText: json.summary || "Scanned successfully."
    };
  } catch (error) {
    console.error("Error scanning bottle:", error);
    return { rawText: "Failed to scan image. Please try again or enter details manually." };
  }
}

export const analyzeAdherencePatterns = async (
  stats: { adherence: number, taken: number, missed: number },
  medStats: any[]
): Promise<string> => {
  if (!ai) return "AI is not configured. Add your Gemini API key in environment variables.";

  const medSummary = medStats
    .map((m: any) => `${m.name}: ${m.stats.adherence}% adherence (${m.stats.missed} missed)`)
    .join('; ');

  const prompt = `
        Analyze this medication adherence report:
        Overall Adherence: ${stats.adherence}%
        Total Taken: ${stats.taken}
        Total Missed: ${stats.missed}
        
        Medication Breakdown: ${medSummary}
        
        Provide 3-4 short, insightful, and motivating bullet points. 
        Identify if there are specific medications being neglected. 
        If adherence is high (over 90%), praise the user warmly.
        If low, offer gentle, constructive advice on habit building.
        IMPORTANT: Do not use emojis or markdown formatting. Use plain text only.
    `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text || "Keep up the good work! Consistent tracking is key to your health.";
  } catch (error) {
    console.error("Error analyzing adherence:", error);
    return "Unable to generate insights at this time.";
  }
};
