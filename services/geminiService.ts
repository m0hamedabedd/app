import { GoogleGenAI, Type } from "@google/genai";
import { Medication } from "../types";

const geminiApiKey =
  import.meta.env.VITE_GEMINI_API_KEY ||
  process.env.API_KEY ||
  process.env.GEMINI_API_KEY ||
  "";

const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;
const CHAT_RECENT_WINDOW = 12;
const CHAT_OLDER_DIGEST_LIMIT = 16;
const CHAT_LINE_MAX_CHARS = 120;
const CHAT_TIMEOUT_MS = 8000;
const SAFETY_TIMEOUT_MS = 12000;
const CHAT_PRIMARY_MODEL = 'gemini-2.5-flash';
const CHAT_FALLBACK_MODEL = 'gemini-2.5-flash-lite';
const SAFETY_MODEL_SEQUENCE = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];

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
  if (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit')
  ) {
    return "AI usage limit reached for now. Please retry shortly, or upgrade Gemini quota/billing.";
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

const isUsefulSafetyResult = (result: DrugInteractionAnalysis) => {
  if (result.interactions.length > 0) return true;
  if (!result.summary) return false;
  return result.summary.trim().toLowerCase() !== 'no analysis summary returned.';
};

const extractErrorText = (error: unknown) => {
  const e = error as any;
  return String(
    e?.message ||
    e?.error?.message ||
    e?.statusText ||
    (typeof e === 'string' ? e : '')
  ).toLowerCase();
};

const localSafetyFallback = (
  medications: Medication[],
  allergies: string[],
  reason?: string
): DrugInteractionAnalysis => {
  const interactions: InteractionItem[] = [];
  const allergyTerms = allergies.map((a) => a.trim().toLowerCase()).filter(Boolean);
  const medNames = medications.map((m) => m.name.trim()).filter(Boolean);
  const medNamesLower = medNames.map((n) => n.toLowerCase());

  const duplicates = medNamesLower.filter((name, idx, arr) => arr.indexOf(name) !== idx);
  if (duplicates.length > 0) {
    const uniqueDupes = Array.from(new Set(duplicates));
    interactions.push({
      severity: 'Moderate',
      description: 'Possible duplicate medication names detected. Verify that duplicate entries are intentional to avoid double-dosing.',
      drugs: uniqueDupes
    });
  }

  if (allergyTerms.length > 0) {
    medications.forEach((med) => {
      const medName = String(med.name || '').toLowerCase();
      if (!medName) return;
      const hit = allergyTerms.find((term) => term.length >= 3 && medName.includes(term));
      if (hit) {
        interactions.push({
          severity: 'High',
          description: `Medication name appears related to listed allergy "${hit}". Confirm safety with a licensed clinician before use.`,
          drugs: [med.name]
        });
      }
    });
  }

  if (interactions.length === 0) {
    interactions.push({
      severity: 'None',
      description: 'No obvious conflicts detected in this quick fallback check. Run AI analysis again when quota/network is available.',
      drugs: medNames.slice(0, 4)
    });
  }

  const reasonText = reason ? ` AI detail check is temporarily unavailable (${reason}).` : '';
  return {
    summary: `Quick safety fallback generated from current medication/allergy list.${reasonText}`,
    interactions
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

  const strictJsonPrompt = `
${prompt}

Return strictly as valid JSON with this shape:
{
  "summary": "short clinical overview",
  "interactions": [
    {
      "severity": "High|Moderate|Low|None",
      "description": "short risk statement",
      "drugs": ["drug A", "drug B"]
    }
  ]
}
No markdown. No extra keys.
  `;

  const runStructuredModel = async (model: string, timeoutMs: number) => {
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

  const runLooseJsonModel = async (model: string, timeoutMs: number) => {
    const response = await withTimeout(ai.models.generateContent({
      model,
      contents: strictJsonPrompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 500
      }
    }), timeoutMs, `${model} safety loose-json`);

    const raw = response.text || '{}';
    const parsed = parseJsonResponse<Partial<DrugInteractionAnalysis>>(raw) || {};
    return sanitizeInteractionResult(parsed);
  };

  let lastError: unknown = null;
  for (const model of SAFETY_MODEL_SEQUENCE) {
    try {
      const structured = await runStructuredModel(model, SAFETY_TIMEOUT_MS);
      if (isUsefulSafetyResult(structured)) return structured;
    } catch (structuredError) {
      lastError = structuredError;
    }

    try {
      const loose = await runLooseJsonModel(model, SAFETY_TIMEOUT_MS);
      if (isUsefulSafetyResult(loose)) return loose;
    } catch (looseError) {
      lastError = looseError;
    }
  }

  console.error("Error analyzing interactions:", lastError);
  const rawReason = extractErrorText(lastError);
  const reasonLabel =
    rawReason.includes('quota') || rawReason.includes('resource_exhausted') || rawReason.includes('429')
      ? 'Gemini quota reached'
      : toFriendlyAiError(lastError);

  return localSafetyFallback(medications, allergies, reasonLabel);
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
