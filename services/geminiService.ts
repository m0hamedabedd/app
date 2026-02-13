import { GoogleGenAI, Type } from "@google/genai";
import { Medication } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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

export const analyzeDrugInteractions = async (medications: Medication[], allergies: string[]): Promise<string> => {
  if (medications.length < 1) return "Please add at least one medication to check.";

  const medList = medications.map(m => `${m.name} (${m.dosage})`).join(", ");
  const allergyList = allergies.join(", ");

  const prompt = `
    I am taking the following medications: ${medList}.
    I have these allergies: ${allergyList}.
    
    Analyze strictly for:
    1. Potential drug-drug interactions between these specific medications.
    2. Potential drug-allergy interactions.
    
    Keep the response concise, friendly, and structured. 
    If there are no known interactions, clearly state that.
    Start with a summary.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview', // Upgraded to Pro for complex medical reasoning
      contents: prompt,
    });
    return response.text || "No analysis could be generated.";
  } catch (error) {
    console.error("Error analyzing interactions:", error);
    return "Sorry, I couldn't analyze the interactions right now. Please try again later.";
  }
};

export const scanMedicationBottle = async (imageFile: File): Promise<{
    medication?: Partial<Medication>,
    rawText: string
}> => {
    const base64Data = await fileToGenerativePart(imageFile);
    
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview', // Changed from gemini-2.5-flash-image to support responseSchema
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
        const json = JSON.parse(text);

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
    const medSummary = medStats.map((m: any) => `${m.name}: ${m.stats.adherence}% adherence (${m.stats.missed} missed)`).join('; ');
    
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
            model: 'gemini-3-flash-preview',
            contents: prompt,
        });
        return response.text || "Keep up the good work! Consistent tracking is key to your health.";
    } catch (error) {
        console.error("Error analyzing adherence:", error);
        return "Unable to generate insights at this time.";
    }
};
