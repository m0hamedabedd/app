import React, { useMemo, useState } from 'react';
import { LogEntry, Medication } from '../types';
import { jsPDF } from "jspdf";
import autoTable from 'jspdf-autotable';
import { analyzeAdherencePatterns } from '../services/geminiService';
import { toLocalDateKey } from '../services/dateUtils';
import { resolveLanguage, tr } from '../services/i18n';

interface ReportsProps {
  logs: LogEntry[];
  medications: Medication[];
  language?: 'en' | 'ar';
}

export const Reports: React.FC<ReportsProps> = ({ logs, medications, language = 'en' }) => {
  const lang = resolveLanguage(language);
  const isArabic = lang === 'ar';
  const [timeRange, setTimeRange] = useState<'7days' | '30days'>('7days');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInsights, setAiInsights] = useState<string | null>(null);

  // Calculate Statistics
  const stats = useMemo(() => {
    const daysToLookBack = timeRange === '7days' ? 7 : 30;
    const now = new Date();
    const cutoffDate = new Date();
    cutoffDate.setDate(now.getDate() - daysToLookBack);
    
    // Filter logs by date range
    const relevantLogs = logs.filter(l => new Date(l.timestamp) >= cutoffDate);
    
    const totalLogs = relevantLogs.length;
    const taken = relevantLogs.filter(l => l.status === 'Taken').length;
    const missed = relevantLogs.filter(l => l.status === 'Missed').length;
    const skipped = relevantLogs.filter(l => l.status === 'Skipped').length;
    
    // Strict adherence: Taken / (Taken + Missed)
    const denominator = taken + missed; 
    const adherence = denominator > 0 ? Math.round((taken / denominator) * 100) : (totalLogs > 0 ? 100 : 0);

    // Chart Data
    const chartData = Array.from({ length: daysToLookBack }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (daysToLookBack - 1 - i)); // Correct order
        const dateStr = toLocalDateKey(d);
        
        const dayLogs = relevantLogs.filter(l => toLocalDateKey(l.timestamp) === dateStr);
        return {
            date: dateStr,
            label: daysToLookBack === 7 
                ? d.toLocaleDateString('en-US', { weekday: 'short' }) 
                : d.getDate().toString(),
            taken: dayLogs.filter(l => l.status === 'Taken').length,
            missed: dayLogs.filter(l => l.status === 'Missed').length,
            skipped: dayLogs.filter(l => l.status === 'Skipped').length
        };
    });

    // Medication Breakdown
    const medStats = medications.map(med => {
        const medLogs = relevantLogs.filter(l => l.medicationId === med.id);
        const mTaken = medLogs.filter(l => l.status === 'Taken').length;
        const mMissed = medLogs.filter(l => l.status === 'Missed').length;
        const mTotal = mTaken + mMissed;
        
        // If no logs, assume 100% or 0%? Let's assume 100% if no missed logged.
        const mAdherence = mTotal > 0 ? Math.round((mTaken / mTotal) * 100) : (medLogs.length > 0 ? 0 : 100); 
        
        return { 
            ...med, 
            stats: { adherence: mAdherence, total: medLogs.length, taken: mTaken, missed: mMissed }
        };
    }).sort((a, b) => a.stats.adherence - b.stats.adherence); // Lowest adherence first

    // Simple Streak Calculation (Consecutive days with at least one 'Taken' and no 'Missed')
    let currentStreak = 0;
    for (let i = 0; i < 365; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = toLocalDateKey(d);
        
        const dayLogs = logs.filter(l => toLocalDateKey(l.timestamp) === dateStr);
        if (dayLogs.length === 0 && i > 0) break; // Stop if no data (except today)
        
        const hasTaken = dayLogs.some(l => l.status === 'Taken');
        const hasMissed = dayLogs.some(l => l.status === 'Missed');

        if (hasTaken && !hasMissed) {
            currentStreak++;
        } else if (i === 0 && dayLogs.length === 0) {
            // Don't break streak for today if nothing logged yet
            continue;
        } else {
            break;
        }
    }

    return { totalLogs, taken, missed, skipped, adherence, chartData, medStats, currentStreak };
  }, [logs, medications, timeRange]);

  const getAdherenceColor = (score: number) => {
    if (score >= 90) return 'text-teal-500 stroke-teal-500';
    if (score >= 70) return 'text-orange-400 stroke-orange-400';
    return 'text-red-500 stroke-red-500';
  };

  const getAdherenceBg = (score: number) => {
    if (score >= 90) return 'bg-teal-50 text-teal-700';
    if (score >= 70) return 'bg-orange-50 text-orange-700';
    return 'bg-red-50 text-red-700';
  };

  const handleGeneratePDF = () => {
      const doc = new jsPDF();
      
      // Branding
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.setTextColor(13, 148, 136); // Teal-600
      doc.text("PillCare Report", 14, 20);
      
      // Meta
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`Date: ${new Date().toLocaleDateString()}`, 14, 28);
      doc.text(`Range: Last ${timeRange === '7days' ? '7 Days' : '30 Days'}`, 14, 33);
      
      // Summary Box
      doc.setDrawColor(200);
      doc.setFillColor(245, 247, 250);
      doc.rect(14, 40, 180, 25, 'F');
      
      doc.setFontSize(12);
      doc.setTextColor(50);
      doc.text(`Overall Adherence: ${stats.adherence}%`, 20, 50);
      doc.text(`Streak: ${stats.currentStreak} Days`, 20, 58);
      
      doc.text(`Taken: ${stats.taken}`, 120, 50);
      doc.text(`Missed: ${stats.missed}`, 120, 58);

      let finalY = 75;

      // AI Insights (if available)
      if (aiInsights) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(14);
          doc.setTextColor(13, 148, 136);
          doc.text("AI Health Insights", 14, 75);
          
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10);
          doc.setTextColor(60);
          
          // Remove non-ASCII characters (emojis, etc) to prevent PDF corruption
          const cleanInsights = aiInsights.replace(/[^\x20-\x7E\n]/g, '');
          
          const splitText = doc.splitTextToSize(cleanInsights, 180);
          doc.text(splitText, 14, 82);
          
          // Move cursor down based on text length
          finalY = 82 + (splitText.length * 5) + 10;
      }

      // Medication Table
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(13, 148, 136);
      doc.text("Medication Breakdown", 14, finalY);
      
      autoTable(doc, {
        startY: finalY + 5,
        head: [['Medication', 'Adherence', 'Taken', 'Missed', 'Schedule']],
        body: stats.medStats.map(m => [
            m.name,
            `${m.stats.adherence}%`,
            m.stats.taken,
            m.stats.missed,
            m.frequency
        ]),
        theme: 'grid',
        headStyles: { fillColor: [13, 148, 136] },
      });

      doc.save(`PillCare_Report_${toLocalDateKey(new Date())}.pdf`);
  };

  const handleGenerateInsights = async () => {
    setAiLoading(true);
    try {
        const insights = await analyzeAdherencePatterns(stats, stats.medStats);
        setAiInsights(insights);
    } catch (e) {
        console.error(e);
    } finally {
        setAiLoading(false);
    }
  };

  return (
    <div className="space-y-6 pb-24 animate-fade-in">
      <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center">
            <i className={`fas fa-chart-line text-teal-600 ${isArabic ? 'ml-2' : 'mr-2'}`}></i>
            {tr(lang, 'Analytics', 'التحليلات')}
          </h2>
          
          <div className="flex gap-2">
            <button 
                onClick={handleGeneratePDF}
                className="bg-white p-2 rounded-xl shadow-sm border border-gray-200 text-teal-600 hover:bg-teal-50 transition-colors"
                title="Download PDF Report"
            >
                <i className="fas fa-file-pdf text-xl"></i>
            </button>
            <div className="bg-white p-1 rounded-xl shadow-sm border border-gray-200 flex text-xs font-semibold">
                <button 
                    onClick={() => setTimeRange('7days')}
                    className={`px-3 py-1.5 rounded-lg transition-all ${timeRange === '7days' ? 'bg-teal-100 text-teal-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                    {tr(lang, '7D', '٧ أيام')}
                </button>
                <button 
                    onClick={() => setTimeRange('30days')}
                    className={`px-3 py-1.5 rounded-lg transition-all ${timeRange === '30days' ? 'bg-teal-100 text-teal-700 shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                    {tr(lang, '30D', '٣٠ يوماً')}
                </button>
            </div>
          </div>
      </div>

      {/* AI Insights Section */}
      <div className="bg-gradient-to-r from-violet-600 to-indigo-600 rounded-2xl p-5 shadow-lg text-white">
        <div className="flex justify-between items-start mb-3">
             <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center backdrop-blur-sm">
                    <i className="fas fa-magic text-yellow-300"></i>
                </div>
                <h3 className="font-bold">{tr(lang, 'AI Health Insights', 'رؤى الصحة بالذكاء الاصطناعي')}</h3>
             </div>
             {!aiInsights && (
                <button 
                    onClick={handleGenerateInsights}
                    disabled={aiLoading}
                    className="bg-white/20 hover:bg-white/30 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all backdrop-blur-sm flex items-center gap-1"
                >
                    {aiLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-sync-alt"></i>}
                    <span>{tr(lang, 'Generate', 'توليد')}</span>
                </button>
             )}
        </div>
        
        {aiLoading ? (
            <div className="animate-pulse flex gap-4">
                <div className="flex-1 space-y-2 py-1">
                    <div className="h-2 bg-white/20 rounded"></div>
                    <div className="h-2 bg-white/20 rounded w-3/4"></div>
                </div>
            </div>
        ) : aiInsights ? (
            <div className="animate-fade-in">
                <p className="text-sm text-indigo-100 leading-relaxed whitespace-pre-wrap">
                    {aiInsights}
                </p>
                <div className="mt-3 flex justify-end">
                    <button onClick={handleGenerateInsights} className="text-[10px] text-indigo-200 hover:text-white uppercase font-bold tracking-wide">
                        {tr(lang, 'Refresh', 'تحديث')}
                    </button>
                </div>
            </div>
        ) : (
            <p className="text-sm text-indigo-100 opacity-80">
                {tr(lang, 'Tap generate to get personalized insights about your medication adherence patterns and habits.', 'اضغط توليد للحصول على رؤى مخصصة حول التزامك بالأدوية وعاداتك.')}
            </p>
        )}
      </div>

      {/* Top Cards Row */}
      <div className="grid grid-cols-2 gap-4">
          {/* Adherence Card */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 shadow-lg border border-slate-700 flex flex-col justify-between relative overflow-hidden h-36">
             <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-teal-300/30 to-transparent rounded-bl-[2.5rem] z-0"></div>
             <h3 className="text-slate-300 text-xs font-bold uppercase tracking-wider z-10">{tr(lang, 'Adherence', 'الالتزام')}</h3>
             <div className="flex items-center mt-2 z-10 flex-1">
                 <div className="relative w-14 h-14 mr-3 flex-shrink-0">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 64 64">
                        <circle cx="32" cy="32" r="28" className="stroke-slate-600" strokeWidth="6" fill="transparent" />
                        <circle 
                            cx="32" cy="32" r="28" 
                            className={`transition-all duration-1000 ${getAdherenceColor(stats.adherence)}`}
                            strokeWidth="6" 
                            fill="transparent" 
                            strokeLinecap="round"
                            strokeDasharray={175.9}
                            strokeDashoffset={175.9 - (175.9 * stats.adherence) / 100}
                        />
                    </svg>
                 </div>
                 <div className="flex flex-col justify-center">
                     <span className={`text-2xl font-bold leading-none ${getAdherenceColor(stats.adherence).split(' ')[0]}`}>
                        {stats.adherence}%
                     </span>
                     <p className="text-[10px] text-slate-300 mt-1 leading-tight">{tr(lang, 'Completion Rate', 'معدل الإنجاز')}</p>
                 </div>
             </div>
          </div>

          {/* Streak Card */}
          <div className="bg-gradient-to-br from-teal-500 to-emerald-600 rounded-2xl p-5 shadow-lg text-white flex flex-col justify-between relative overflow-hidden h-36">
              <div className="absolute -right-4 -top-4 text-white opacity-10 text-6xl">
                  <i className="fas fa-fire"></i>
              </div>
              <h3 className="text-teal-100 text-xs font-bold uppercase tracking-wider">{tr(lang, 'Streak', 'السلسلة')}</h3>
              <div className="flex-1 flex flex-col justify-center">
                  <div className={`flex items-baseline ${isArabic ? 'justify-end' : ''}`}> 
                      <span className="text-4xl font-bold">{stats.currentStreak}</span>
                      <span className={`text-sm font-medium text-teal-200 ${isArabic ? 'mr-1' : 'ml-1'}`}>{tr(lang, 'days', 'أيام')}</span>
                  </div>
                  <p className="text-[10px] text-teal-200 mt-1">{tr(lang, 'Consecutive perfect days', 'أيام متتالية مثالية')}</p>
              </div>
          </div>
      </div>

      {/* Overview Stats Grid */}
      <div className="grid grid-cols-3 gap-3">
          <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 text-center">
              <p className="text-teal-600 font-bold text-xl">{stats.taken}</p>
              <p className="text-[10px] text-gray-400 uppercase font-semibold">{tr(lang, 'Taken', 'تم أخذها')}</p>
          </div>
          <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 text-center">
              <p className="text-red-500 font-bold text-xl">{stats.missed}</p>
              <p className="text-[10px] text-gray-400 uppercase font-semibold">{tr(lang, 'Missed', 'فاتت')}</p>
          </div>
          <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 text-center">
              <p className="text-gray-500 font-bold text-xl">{stats.skipped}</p>
              <p className="text-[10px] text-gray-400 uppercase font-semibold">{tr(lang, 'Skipped', 'تم تخطيها')}</p>
          </div>
      </div>

      {/* Activity Chart */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <div className="flex justify-between items-center mb-6">
              <h3 className="font-bold text-gray-800">{tr(lang, 'Activity History', 'سجل النشاط')}</h3>
              <div className="flex gap-3 text-xs">
                  <div className="flex items-center"><span className={`w-2 h-2 rounded-full bg-teal-500 ${isArabic ? 'ml-1' : 'mr-1'}`}></span>{tr(lang, 'Taken', 'تم أخذها')}</div>
                  <div className="flex items-center"><span className={`w-2 h-2 rounded-full bg-red-400 ${isArabic ? 'ml-1' : 'mr-1'}`}></span>{tr(lang, 'Missed', 'فاتت')}</div>
              </div>
          </div>
          
          <div className="flex items-end justify-between h-40 gap-1 sm:gap-3">
              {stats.chartData.map((day, idx) => {
                  const maxVal = Math.max(...stats.chartData.map(d => d.taken + d.missed + d.skipped), 3);
                  const takenH = (day.taken / maxVal) * 100;
                  const missedH = (day.missed / maxVal) * 100;
                  const skippedH = (day.skipped / maxVal) * 100;

                  return (
                      <div key={idx} className="flex flex-col items-center flex-1 h-full justify-end group cursor-pointer">
                          <div className="w-full max-w-[1.5rem] bg-gray-50 rounded-lg relative flex flex-col justify-end overflow-hidden h-full">
                              <div style={{ height: `${skippedH}%` }} className="bg-gray-300 w-full"></div>
                              <div style={{ height: `${missedH}%` }} className="bg-red-400 w-full"></div>
                              <div style={{ height: `${takenH}%` }} className="bg-teal-500 w-full rounded-t-sm"></div>
                          </div>
                          <span className="text-[9px] sm:text-[10px] text-gray-400 mt-2 font-medium truncate w-full text-center">
                              {day.label}
                          </span>
                          
                          {/* Tooltip on hover */}
                          <div className="absolute mb-8 hidden group-hover:block bg-gray-800 text-white text-[10px] p-2 rounded shadow-lg z-20 pointer-events-none whitespace-nowrap">
                             {tr(lang, `${day.date}: ${day.taken} taken, ${day.missed} missed`, `${day.date}: ${day.taken} تم أخذها، ${day.missed} فاتت`)}
                          </div>
                      </div>
                  );
              })}
          </div>
      </div>

      {/* Medication Breakdown */}
      <div>
          <h3 className="font-bold text-gray-800 mb-4 px-1">{tr(lang, 'Medication Performance', 'أداء الأدوية')}</h3>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-50">
              {stats.medStats.length === 0 ? (
                  <div className="p-6 text-center text-gray-400 text-sm">{tr(lang, 'No data available yet.', 'لا توجد بيانات بعد.')}</div>
              ) : (
                  stats.medStats.map(med => (
                      <div key={med.id} className={`p-4 flex items-center justify-between hover:bg-gray-50 transition-colors ${isArabic ? 'text-right' : ''}`}> 
                          <div className="flex items-center gap-3">
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg
                                  ${med.stats.adherence >= 80 ? 'bg-teal-100 text-teal-600' : 
                                    med.stats.adherence >= 50 ? 'bg-orange-100 text-orange-500' : 'bg-red-100 text-red-500'}`}>
                                  <i className="fas fa-pills"></i>
                              </div>
                              <div className={isArabic ? 'text-right' : ''}>
                                  <p className="font-bold text-gray-800 text-sm">{med.name}</p>
                                  <p className="text-xs text-gray-400">{tr(lang, `${med.stats.total} scheduled doses`, `${med.stats.total} جرعات مجدولة`)}</p>
                              </div>
                          </div>
                          
                          <div className={isArabic ? 'text-left' : 'text-right'}>
                              <span className={`text-xs font-bold px-2 py-1 rounded-md ${getAdherenceBg(med.stats.adherence)}`}>
                                  {med.stats.adherence}%
                              </span>
                          </div>
                      </div>
                  ))
              )}
          </div>
      </div>
    </div>
  );
};
