import React, { useState } from 'react';
import { Medication } from '../types';
import { analyzeDrugInteractions } from '../services/geminiService';

interface InteractionsProps {
  medications: Medication[];
  userAllergies: string[];
}

export const Interactions: React.FC<InteractionsProps> = ({ medications, userAllergies }) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleCheck = async () => {
    setLoading(true);
    setResult(null);
    try {
        const analysis = await analyzeDrugInteractions(medications, userAllergies);
        setResult(analysis);
    } catch (error) {
        setResult("Failed to check interactions. Please try again.");
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-800 flex items-center">
        <i className="fas fa-user-md text-teal-500 mr-2"></i>
        AI Safety Check
      </h2>

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <p className="text-gray-600 mb-4">
          Our AI assistant reviews your current medication list against your allergies and each other to identify potential risks.
        </p>

        <div className="mb-6 space-y-2">
            <h4 className="font-semibold text-gray-700 text-sm uppercase tracking-wide">Reviewing:</h4>
            <div className="flex flex-wrap gap-2">
                {medications.map(m => (
                    <span key={m.id} className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-xs font-medium border border-blue-100">
                        {m.name}
                    </span>
                ))}
                {userAllergies.map(a => (
                     <span key={a} className="bg-red-50 text-red-700 px-3 py-1 rounded-full text-xs font-medium border border-red-100">
                        Allergy: {a}
                    </span>
                ))}
            </div>
             {medications.length === 0 && <span className="text-gray-400 italic text-sm">No medications added yet.</span>}
        </div>

        <button 
            onClick={handleCheck}
            disabled={loading || medications.length === 0}
            className={`w-full py-3 rounded-xl font-bold text-white shadow-md transition-all flex items-center justify-center space-x-2
                ${loading || medications.length === 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 active:scale-95'}
            `}>
            {loading ? (
                <>
                    <i className="fas fa-circle-notch fa-spin"></i>
                    <span>Analyzing...</span>
                </>
            ) : (
                <>
                    <i className="fas fa-shield-alt"></i>
                    <span>Run Interaction Check</span>
                </>
            )}
        </button>
      </div>

      {result && (
        <div className="bg-white rounded-2xl p-6 shadow-md border-l-4 border-indigo-500 animate-fade-in">
            <h3 className="font-bold text-lg text-gray-800 mb-2">Analysis Result</h3>
            <div className="prose prose-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {result}
            </div>
            <p className="text-xs text-gray-400 mt-4 border-t pt-2">
                Disclaimer: This is an AI-generated analysis. Always consult with a certified medical professional before making changes to your medication.
            </p>
        </div>
      )}
    </div>
  );
};