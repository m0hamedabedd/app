import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Medication } from '../types';
import {
  analyzeDrugInteractions,
  chatWithHealthAssistant,
  DrugInteractionAnalysis,
  HealthChatMessage,
  InteractionSeverity
} from '../services/geminiService';
import { resolveLanguage, tr } from '../services/i18n';

interface InteractionsProps {
  medications: Medication[];
  userAllergies: string[];
  userConditions: string[];
  language?: 'en' | 'ar';
}

type AssistantMode = 'chat' | 'safety';

interface ChatBubble {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
}

const CHAT_STORAGE_KEY = 'pillcare_ai_chat_history_v2';
const MODE_STORAGE_KEY = 'pillcare_ai_mode_v1';
const SAFETY_STORAGE_KEY = 'pillcare_ai_safety_state_v1';

const makeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const severityOrder: InteractionSeverity[] = ['High', 'Moderate', 'Low', 'None'];

const severityMeta: Record<InteractionSeverity, { card: string; badge: string; icon: string; label: string }> = {
  High: {
    card: 'border-red-300 bg-red-50',
    badge: 'bg-red-100 text-red-700',
    icon: 'fa-exclamation-triangle',
    label: 'High Risk'
  },
  Moderate: {
    card: 'border-orange-300 bg-orange-50',
    badge: 'bg-orange-100 text-orange-700',
    icon: 'fa-exclamation-triangle',
    label: 'Moderate Risk'
  },
  Low: {
    card: 'border-yellow-300 bg-yellow-50',
    badge: 'bg-yellow-100 text-yellow-700',
    icon: 'fa-exclamation-triangle',
    label: 'Low Risk'
  },
  None: {
    card: 'border-green-300 bg-green-50',
    badge: 'bg-green-100 text-green-700',
    icon: 'fa-check-circle',
    label: 'No Known Risk'
  }
};

export const Interactions: React.FC<InteractionsProps> = ({
  medications,
  userAllergies,
  userConditions,
  language = 'en'
}) => {
  const lang = resolveLanguage(language);
  const [mode, setMode] = useState<AssistantMode>('chat');

  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatBubble[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<DrugInteractionAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [lastAnalysisAt, setLastAnalysisAt] = useState<number | null>(null);
  const [storageHydrated, setStorageHydrated] = useState(false);

  const chatBottomRef = useRef<HTMLDivElement>(null);

  const greetingText = useMemo(() => {
    const count = medications.length;
    return tr(
      lang,
      `Hello! I am your AI Health Assistant. I can see ${count} medication${count === 1 ? '' : 's'} in your plan. Ask me about side effects, timing, and safe use.`,
      `مرحباً! أنا مساعدك الصحي الذكي. أرى ${count} ${count === 1 ? 'دواء' : 'أدوية'} في خطتك. اسألني عن الأعراض الجانبية أو التوقيت أو الاستخدام الآمن.`
    );
  }, [medications.length, lang]);

  useEffect(() => {
    try {
      const storedMode = localStorage.getItem(MODE_STORAGE_KEY);
      if (storedMode === 'chat' || storedMode === 'safety') {
        setMode(storedMode);
      }

      const storedChat = localStorage.getItem(CHAT_STORAGE_KEY);
      if (storedChat) {
        const parsed = JSON.parse(storedChat) as ChatBubble[];
        if (Array.isArray(parsed)) {
          const valid = parsed.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string');
          if (valid.length > 0) {
            setChatMessages(valid);
          }
        }
      }

      const storedSafety = localStorage.getItem(SAFETY_STORAGE_KEY);
      if (storedSafety) {
        const parsed = JSON.parse(storedSafety) as {
          analysisResult?: DrugInteractionAnalysis | null;
          analysisError?: string | null;
          lastAnalysisAt?: number | null;
        };

        if (typeof parsed.analysisError === 'string' || parsed.analysisError === null) {
          setAnalysisError(parsed.analysisError ?? null);
        }

        if (typeof parsed.lastAnalysisAt === 'number' || parsed.lastAnalysisAt === null) {
          setLastAnalysisAt(parsed.lastAnalysisAt ?? null);
        }

        if (parsed.analysisResult && typeof parsed.analysisResult === 'object') {
          const safeInteractions = Array.isArray(parsed.analysisResult.interactions)
            ? parsed.analysisResult.interactions.map((item) => ({
                severity: severityOrder.includes(item?.severity as InteractionSeverity)
                  ? (item.severity as InteractionSeverity)
                  : 'None',
                description: typeof item?.description === 'string' ? item.description : '',
                drugs: Array.isArray(item?.drugs) ? item.drugs.filter((d) => typeof d === 'string') : []
              }))
            : [];

          setAnalysisResult({
            summary: typeof parsed.analysisResult.summary === 'string' ? parsed.analysisResult.summary : '',
            interactions: safeInteractions
          });
        }
      }
    } catch (error) {
      console.error("Failed to load AI assistant state", error);
    } finally {
      setStorageHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!storageHydrated) return;

    if (chatMessages.length === 0) {
      setChatMessages([
        {
          id: 'welcome',
          role: 'assistant',
          text: greetingText,
          createdAt: Date.now()
        }
      ]);
      return;
    }

    if (chatMessages.length === 1 && chatMessages[0].id === 'welcome') {
      setChatMessages((prev) => [
        {
          ...prev[0],
          text: greetingText
        }
      ]);
    }
  }, [greetingText, storageHydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!storageHydrated) return;
    if (chatMessages.length === 0) return;
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatMessages));
  }, [chatMessages, storageHydrated]);

  useEffect(() => {
    if (!storageHydrated) return;
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [mode, storageHydrated]);

  useEffect(() => {
    if (!storageHydrated) return;
    localStorage.setItem(
      SAFETY_STORAGE_KEY,
      JSON.stringify({
        analysisResult,
        analysisError,
        lastAnalysisAt
      })
    );
  }, [analysisResult, analysisError, lastAnalysisAt, storageHydrated]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading, mode]);

  const quickPrompts = useMemo(() => {
    const medPrompts = medications.map((med) => `Side effects of ${med.name}?`);
    const conditionPrompts = userConditions.slice(0, 2).map((c) => `Can my meds affect ${c}?`);
    const allPrompts = [...medPrompts, ...conditionPrompts, 'Best time to take meds?'];
    return Array.from(new Set(allPrompts)).slice(0, 10);
  }, [medications, userConditions]);

  const showQuickPrompts = useMemo(() => {
    return !chatMessages.some((message) => message.role === 'user');
  }, [chatMessages]);

  const riskStats = useMemo(() => {
    if (!analysisResult || analysisResult.interactions.length === 0) {
      return { highest: 'None' as InteractionSeverity, high: 0, moderate: 0, low: 0, none: 0 };
    }

    const counts = {
      High: 0,
      Moderate: 0,
      Low: 0,
      None: 0
    };
    analysisResult.interactions.forEach((item) => {
      counts[item.severity] += 1;
    });

    const highest =
      severityOrder.find((severity) => counts[severity] > 0) || 'None';

    return {
      highest,
      high: counts.High,
      moderate: counts.Moderate,
      low: counts.Low,
      none: counts.None
    };
  }, [analysisResult]);

  const toHistoryMessages = (messages: ChatBubble[]): HealthChatMessage[] => {
    return messages.map((m) => ({ role: m.role, text: m.text }));
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const clearChatHistory = () => {
    localStorage.removeItem(CHAT_STORAGE_KEY);
    setChatMessages([
      {
        id: 'welcome',
        role: 'assistant',
        text: greetingText,
        createdAt: Date.now()
      }
    ]);
  };

  const sendChatMessage = async (textOverride?: string) => {
    const text = (textOverride ?? chatInput).trim();
    if (!text || chatLoading) return;

    const userMessage: ChatBubble = {
      id: makeId(),
      role: 'user',
      text,
      createdAt: Date.now()
    };

    const nextMessages = [...chatMessages, userMessage];
    setChatMessages(nextMessages);
    setChatInput('');
    setChatLoading(true);

    try {
      const reply = await chatWithHealthAssistant(
        text,
        medications,
        userConditions,
        toHistoryMessages(nextMessages)
      );

      setChatMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: 'assistant',
          text: reply,
          createdAt: Date.now()
        }
      ]);
    } catch (error) {
      console.error("Chat error:", error);
      setChatMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: 'assistant',
          text: 'I could not process that request right now. Please try again.',
          createdAt: Date.now()
        }
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const runSafetyCheck = async () => {
    if (medications.length === 0) return;

    setAnalysisLoading(true);
    setAnalysisError(null);
    setAnalysisResult(null);

    try {
      const result = await analyzeDrugInteractions(medications, userAllergies);
      setAnalysisResult(result);
      setLastAnalysisAt(Date.now());
    } catch (error) {
      console.error("Safety check error:", error);
      setAnalysisError('Safety analysis failed. Please check your API key and internet connection, then try again.');
    } finally {
      setAnalysisLoading(false);
    }
  };

  return (
    <div className="h-full min-h-0 w-full bg-gradient-to-b from-slate-100 via-slate-50 to-white animate-fade-in">
      <div className="mx-auto h-full min-h-0 max-w-5xl px-2 sm:px-4 pt-2 pb-2 flex flex-col gap-2">
        <div className="rounded-2xl bg-gray-100 p-1.5 flex gap-1 border border-gray-200">
          <button
            onClick={() => setMode('chat')}
            className={`h-11 flex-1 rounded-xl text-sm font-extrabold transition-all ${
              mode === 'chat'
                ? 'bg-white text-teal-700 shadow'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <i className="fas fa-comments mr-2"></i>
            {tr(lang, 'Chat Mode', 'وضع المحادثة')}
          </button>
          <button
            onClick={() => setMode('safety')}
            className={`h-11 flex-1 rounded-xl text-sm font-extrabold transition-all ${
              mode === 'safety'
                ? 'bg-white text-teal-700 shadow'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <i className="fas fa-shield-alt mr-2"></i>
            {tr(lang, 'Safety Check', 'فحص الأمان')}
          </button>
        </div>

        {mode === 'chat' && (
          <section className="flex-1 min-h-0 rounded-[28px] border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col">
            <header className="px-4 py-3 border-b border-gray-100 bg-white flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-black text-gray-900 flex items-center gap-2">
                  <span className="w-8 h-8 rounded-xl bg-teal-500 text-white flex items-center justify-center shadow-sm">
                    <i className="fas fa-robot text-sm"></i>
                  </span>
                  AI Health Assistant
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="px-2 py-0.5 rounded-full bg-teal-50 border border-teal-100 text-teal-700 font-semibold">
                    {tr(lang, `${medications.length} meds in context`, `${medications.length} دواء في السياق`)}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-gray-600 font-semibold">
                    {tr(lang, 'Memory enabled', 'الذاكرة مفعلة')}
                  </span>
                </div>
              </div>
              <button
                onClick={clearChatHistory}
                className="h-8 px-3 rounded-lg border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50"
              >
                {tr(lang, 'Clear', 'مسح')}
              </button>
            </header>

            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar touch-pan-y px-3 py-3 sm:px-4 sm:py-4 bg-gray-100">
              <div className="space-y-3">
                {chatMessages.map((message) => (
                  <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[88%] sm:max-w-[78%] space-y-1">
                      <div
                        className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                          message.role === 'user'
                            ? 'bg-teal-600 text-white rounded-br-md'
                            : 'bg-gray-50 text-gray-800 border border-gray-200 rounded-bl-md'
                        }`}
                      >
                        {message.text}
                      </div>
                      <p className={`text-[10px] ${message.role === 'user' ? 'text-right text-teal-600' : 'text-gray-400'}`}>
                        {formatTime(message.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}

                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-gray-50 border border-gray-200 shadow-sm">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce"></span>
                          <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0.12s' }}></span>
                          <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0.24s' }}></span>
                        </div>
                        <span className="text-[11px] text-gray-500 font-medium">{tr(lang, 'typing...', 'يكتب الآن...')}</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatBottomRef}></div>
              </div>
            </div>

            <footer className="p-3 border-t border-gray-100 bg-white space-y-3">
              {showQuickPrompts && (
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => void sendChatMessage(prompt)}
                      className="flex-shrink-0 h-8 px-3 rounded-full bg-teal-50 border border-teal-200 text-teal-700 text-xs font-semibold hover:bg-teal-100 transition-colors"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void sendChatMessage();
                    }
                  }}
                  placeholder={tr(lang, 'Ask about side effects, timing, or interactions...', 'اسأل عن الأعراض الجانبية أو التوقيت أو التداخلات...')}
                  className="flex-1 h-11 rounded-full border border-gray-200 bg-gray-50 px-4 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-200"
                />
                <button
                  onClick={() => void sendChatMessage()}
                  disabled={!chatInput.trim() || chatLoading}
                  className={`w-11 h-11 rounded-full text-white shadow-sm transition ${
                    !chatInput.trim() || chatLoading
                      ? 'bg-gray-300 cursor-not-allowed'
                      : 'bg-teal-500 hover:bg-teal-600'
                  }`}
                >
                  <i className="fas fa-paper-plane"></i>
                </button>
              </div>
              <p className="text-[10px] text-center text-gray-400">
                {tr(lang, 'AI assistant may be imperfect. Confirm medical decisions with a licensed clinician.', 'قد يخطئ المساعد الذكي. أكد القرارات الطبية مع مختص مرخّص.')}
              </p>
            </footer>
          </section>
        )}

        {mode === 'safety' && (
          <section className="flex-1 min-h-0 rounded-[28px] border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="h-full min-h-0 overflow-y-auto no-scrollbar touch-pan-y p-4 sm:p-5 space-y-4">
              {!analysisResult && !analysisLoading && (
                <div className="space-y-5">
                  <div className="text-center py-3">
                    <div className="mx-auto w-20 h-20 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                      <i className="fas fa-shield-alt text-3xl"></i>
                    </div>
                    <h3 className="text-2xl font-black text-gray-900 mt-4">{tr(lang, 'Safety Check', '\u0641\u062d\u0635 \u0627\u0644\u0633\u0644\u0627\u0645\u0629')}</h3>
                    <p className="text-sm text-gray-500 mt-2">
                      {tr(lang, 'Review your medication list for interaction and allergy risks.', 'راجع قائمة أدويتك لمخاطر التداخل والحساسية.')}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs font-bold tracking-wide text-gray-400 uppercase">{tr(lang, 'Reviewing', 'جاري المراجعة')}</p>
                    <div className="flex flex-wrap gap-2">
                      {medications.length > 0 ? (
                        medications.map((med) => (
                          <span
                            key={med.id}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200"
                          >
                            {med.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-gray-400 italic">{tr(lang, 'No medications added yet.', 'لم تتم إضافة أدوية بعد.')}</span>
                      )}
                      {userAllergies.map((allergy) => (
                        <span
                          key={allergy}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 text-red-700 border border-red-200"
                        >
                          {tr(lang, 'Allergy', 'حساسية')}: {allergy}
                        </span>
                      ))}
                    </div>
                  </div>

                  {analysisError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {analysisError}
                    </div>
                  )}

                  <button
                    onClick={() => void runSafetyCheck()}
                    disabled={medications.length === 0}
                    className={`w-full h-12 rounded-xl font-bold text-white shadow-md transition ${
                      medications.length === 0
                        ? 'bg-gray-300 cursor-not-allowed'
                        : 'bg-indigo-600 hover:bg-indigo-700'
                    }`}
                  >
                    <i className="fas fa-search mr-2"></i>
                    {tr(lang, 'Run Analysis', 'تشغيل التحليل')}
                  </button>
                </div>
              )}

              {analysisLoading && (
                <div className="space-y-3 animate-pulse">
                  <div className="h-16 rounded-2xl bg-gray-100"></div>
                  <div className="h-24 rounded-2xl bg-gray-100"></div>
                  <div className="h-24 rounded-2xl bg-gray-100"></div>
                </div>
              )}

              {analysisResult && !analysisLoading && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                        <i className="fas fa-file-medical text-teal-500"></i>
                        {tr(lang, 'Summary', 'الملخص')}
                      </h3>
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${severityMeta[riskStats.highest].badge}`}>
                        {tr(
                          lang,
                          severityMeta[riskStats.highest].label,
                          riskStats.highest === 'High'
                            ? 'خطر مرتفع'
                            : riskStats.highest === 'Moderate'
                            ? 'خطر متوسط'
                            : riskStats.highest === 'Low'
                            ? 'خطر منخفض'
                            : 'لا يوجد خطر معروف'
                        )}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 mt-2 leading-relaxed">{analysisResult.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="px-2.5 py-1 rounded-lg bg-red-50 border border-red-100 text-red-700 font-semibold">{tr(lang, 'High', 'مرتفع')}: {riskStats.high}</span>
                      <span className="px-2.5 py-1 rounded-lg bg-orange-50 border border-orange-100 text-orange-700 font-semibold">{tr(lang, 'Moderate', 'متوسط')}: {riskStats.moderate}</span>
                      <span className="px-2.5 py-1 rounded-lg bg-yellow-50 border border-yellow-100 text-yellow-700 font-semibold">{tr(lang, 'Low', 'منخفض')}: {riskStats.low}</span>
                      <span className="px-2.5 py-1 rounded-lg bg-green-50 border border-green-100 text-green-700 font-semibold">{tr(lang, 'None', 'لا يوجد')}: {riskStats.none}</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {analysisResult.interactions.length > 0 ? (
                      analysisResult.interactions.map((interaction, index) => {
                        const meta = severityMeta[interaction.severity];
                        return (
                          <div
                            key={`${interaction.severity}-${index}`}
                            className={`rounded-2xl border p-4 ${meta.card}`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                              <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${meta.badge}`}>
                                <i className={`fas ${meta.icon}`}></i>
                                {tr(
                                  lang,
                                  meta.label,
                                  interaction.severity === 'High'
                                    ? 'خطر مرتفع'
                                    : interaction.severity === 'Moderate'
                                    ? 'خطر متوسط'
                                    : interaction.severity === 'Low'
                                    ? 'خطر منخفض'
                                    : 'لا يوجد خطر معروف'
                                )}
                              </span>
                              {interaction.drugs.length > 0 && (
                                <span className="text-xs font-semibold text-gray-600">
                                  {interaction.drugs.join(' + ')}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-800 leading-relaxed">{interaction.description}</p>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-2xl border border-green-300 bg-green-50 p-5 text-center">
                        <div className="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto mb-3">
                          <i className="fas fa-check-circle"></i>
                        </div>
                        <p className="font-bold text-green-700">{tr(lang, 'No interactions found', 'لم يتم العثور على تداخلات')}</p>
                        <p className="text-xs text-green-700 mt-1">
                          {tr(lang, 'Your current medication combination appears safe based on this analysis.', 'يبدو أن تركيبة أدويتك الحالية آمنة وفق هذا التحليل.')}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => void runSafetyCheck()}
                      className="h-11 flex-1 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700"
                    >
                      {tr(lang, 'Run Again', 'إعادة التحليل')}
                    </button>
                    <button
                      onClick={() => {
                        setAnalysisResult(null);
                        setAnalysisError(null);
                      }}
                      className="h-11 flex-1 rounded-xl border border-gray-300 bg-white text-gray-700 font-bold hover:bg-gray-50"
                    >
                      {tr(lang, 'Start Over', 'البدء من جديد')}
                    </button>
                  </div>

                  {lastAnalysisAt && (
                    <p className="text-[11px] text-gray-400 text-right">
                      {tr(lang, 'Last analysis', 'آخر تحليل')}: {new Date(lastAnalysisAt).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')}
                    </p>
                  )}
                </div>
              )}

              <p className="text-[10px] text-center text-gray-400">
                {tr(lang, 'AI assistant may be imperfect. Always confirm clinical decisions with a licensed clinician.', 'قد يخطئ المساعد الذكي. تأكد دائماً من القرارات الطبية مع مختص مرخّص.')}
              </p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
