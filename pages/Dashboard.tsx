import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Medication, LogEntry } from '../types';
import { MedicationCard } from '../components/MedicationCard';
import { localeForLanguage, resolveLanguage, tr } from '../services/i18n';

interface DashboardProps {
  medications: Medication[];
  logs: LogEntry[];
  onLogDose: (medId: string) => void;
  onSnooze: (medId: string) => void;
  onDismiss: (medId: string) => void;
  onUndoTaken: (logId: string) => void;
  onUndoSkipped: (logId: string) => void;
  onTestNotification: () => void;
  userName: string;
  snoozedMeds: { [key: string]: number };
  notificationsEnabled: boolean;
  snoozeMinutes: number;
  language?: 'en' | 'ar';
}

interface TimelineItem {
  id: string; // Unique combo of medId + time
  medication: Medication;
  time: string;
  status: 'taken' | 'due' | 'upcoming' | 'skipped';
  isSnoozed?: boolean;
}

export const Dashboard: React.FC<DashboardProps> = ({ 
  medications, 
  logs, 
  onLogDose, 
  onSnooze, 
  onDismiss, 
  onUndoTaken,
  onUndoSkipped,
  onTestNotification,
  userName, 
  snoozedMeds,
  notificationsEnabled,
  snoozeMinutes,
  language = 'en'
}) => {
  const navigate = useNavigate();
  const lang = resolveLanguage(language);
  const isArabic = lang === 'ar';
  const firstName = (userName || '').trim().split(/\s+/)[0] || userName || '';
  const [currentTime, setCurrentTime] = useState(new Date());
  const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

  // Update time every minute to keep "Due" status fresh
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const todayStr = new Date().toISOString().split('T')[0];
  const todayWeekday = new Date().getDay();
  const activeMedications = medications.filter(m => m.isActive !== false);

  const isScheduledToday = (med: Medication) => {
    if (med.isActive === false) return false;
    if (!med.cycleDays || med.cycleDays.length === 0) return true;
    return med.cycleDays.includes(todayWeekday);
  };

  // 1. Calculate Daily Progress
  const dailyStats = useMemo(() => {
    // Only count scheduled meds for adherence
    const scheduledMeds = activeMedications.filter(m => m.frequencyType !== 'As Needed' && isScheduledToday(m));
    let totalDoses = 0;
    
    scheduledMeds.forEach(m => {
        if (m.frequencyType === 'Daily' && m.scheduledTimes) {
            totalDoses += m.scheduledTimes.length;
        } else {
            totalDoses += 1; // Fallback for Interval/Other
        }
    });

    const scheduledIds = new Set(scheduledMeds.map(m => m.id));
    const todaysLogs = logs.filter(l => l.timestamp.startsWith(todayStr) && scheduledIds.has(l.medicationId));
    const takenCount = todaysLogs.filter(l => l.status === 'Taken').length;
    const skippedCount = todaysLogs.filter(l => l.status === 'Skipped').length;
    const pendingCount = Math.max(0, totalDoses - takenCount - skippedCount);
    
    return {
        total: totalDoses,
        taken: takenCount,
        skipped: skippedCount,
        pending: pendingCount,
        percentage: totalDoses > 0 ? Math.round((takenCount / totalDoses) * 100) : 100
    };
  }, [activeMedications, logs, todayStr]);


  const hasReminderConfigured = useMemo(() => {
    return activeMedications.some((med) => {
      if (med.frequencyType === 'Daily') return (med.scheduledTimes?.length || 0) > 0;
      if (med.frequencyType === 'Interval') return Number(med.intervalHours || 0) > 0;
      return false;
    });
  }, [activeMedications]);

  const onboardingSteps = [
    {
      id: 'add-med',
      title: tr(lang, 'Add first medicine', 'أضف أول دواء'),
      done: activeMedications.length > 0,
      actionLabel: tr(lang, 'Add Medicine', 'إضافة دواء'),
      action: () => navigate('/medications')
    },
    {
      id: 'set-reminder',
      title: tr(lang, 'Set reminder time', 'حدد وقت التذكير'),
      done: hasReminderConfigured,
      actionLabel: tr(lang, 'Set Reminder', 'ضبط التذكير'),
      action: () => navigate('/medications')
    },
    {
      id: 'test-notification',
      title: tr(lang, 'Test notification', 'اختبار الإشعار'),
      done: notificationsEnabled,
      actionLabel: tr(lang, 'Test Now', 'اختبر الآن'),
      action: onTestNotification
    }
  ];

  const onboardingDoneCount = onboardingSteps.filter((step) => step.done).length;
  const showOnboarding = onboardingDoneCount < onboardingSteps.length;

  // 2. Build the Timeline
  const timeline = useMemo(() => {
    const items: TimelineItem[] = [];
    const now = new Date(currentTime);
    const getTimeSortValue = (time: string) => {
      const [h, m] = time.split(':').map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return Number.MAX_SAFE_INTEGER;
      return h * 60 + m;
    };

    activeMedications.forEach((med) => {
      if (!isScheduledToday(med)) return;
      if (med.frequencyType === 'As Needed') return;

      const medLogs = logs
        .filter((l) => l.medicationId === med.id && l.timestamp.startsWith(todayStr) && (l.status === 'Taken' || l.status === 'Skipped'))
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      const actionStatuses = medLogs.map((l) => (l.status === 'Taken' ? 'taken' : 'skipped') as TimelineItem['status']);

      if (med.frequencyType === 'Daily' && (med.scheduledTimes?.length || 0) > 0) {
        const sortedTimes = [...(med.scheduledTimes || [])].sort((a, b) => getTimeSortValue(a) - getTimeSortValue(b));

        sortedTimes.forEach((time, index) => {
          let status: TimelineItem['status'] = 'upcoming';

          if (index < actionStatuses.length) {
            status = actionStatuses[index];
          } else {
            const [hours, mins] = time.split(':').map(Number);
            const scheduleDate = new Date(now);
            scheduleDate.setHours(hours, mins, 0, 0);
            if (!Number.isNaN(hours) && !Number.isNaN(mins) && now >= scheduleDate) {
              status = 'due';
            }
          }

          const isSnoozed = status === 'due' && Boolean(snoozedMeds[med.id] && Date.now() < snoozedMeds[med.id]);

          items.push({
            id: `${med.id}-${time}-${index}`,
            medication: med,
            time,
            status,
            isSnoozed
          });
        });
        return;
      }

      const latestStatus = actionStatuses[actionStatuses.length - 1];
      const status: TimelineItem['status'] = latestStatus || 'due';
      const isSnoozed = status === 'due' && Boolean(snoozedMeds[med.id] && Date.now() < snoozedMeds[med.id]);

      items.push({
        id: `${med.id}-interval`,
        medication: med,
        time: 'Anytime',
        status,
        isSnoozed
      });
    });

    return items.sort((a, b) => {
      const aValue = a.time === 'Anytime' ? Number.MAX_SAFE_INTEGER : getTimeSortValue(a.time);
      const bValue = b.time === 'Anytime' ? Number.MAX_SAFE_INTEGER : getTimeSortValue(b.time);
      return aValue - bValue;
    });
  }, [activeMedications, logs, todayStr, currentTime, snoozedMeds]);

  // Alerts Logic
  const lowStockMeds = activeMedications.filter(m => m.inventoryCount <= 5);
  const expiringMeds = activeMedications.filter(m => {
      if (!m.expiryDate) return false;
      const exp = new Date(m.expiryDate);
      const diff = Math.ceil((exp.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
      return diff <= 30 && diff >= 0;
  });

  const dueNowItems = timeline.filter(t => t.status === 'due' && !t.isSnoozed);
  const snoozedDueItems = timeline.filter(t => t.status === 'due' && t.isSnoozed);
  const upcomingItems = timeline.filter(t => t.status === 'upcoming');
  const todayTakenLogs = useMemo(() => {
    return logs
      .filter(l => l.timestamp.startsWith(todayStr) && l.status === 'Taken')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [logs, todayStr]);
  const todaySkippedLogs = useMemo(() => {
    return logs
      .filter((l) => l.timestamp.startsWith(todayStr) && l.status === 'Skipped')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [logs, todayStr]);
  const hasTimelineContent =
    dueNowItems.length > 0 ||
    snoozedDueItems.length > 0 ||
    upcomingItems.length > 0 ||
    todayTakenLogs.length > 0 ||
    todaySkippedLogs.length > 0 ||
    dailyStats.total > 0;
  
  const nextAction = useMemo(() => {
      if (dueNowItems.length > 0) {
          return { type: 'due' as const, item: dueNowItems[0], label: tr(lang, 'Due now', 'مستحق الآن') };
      }

      if (snoozedDueItems.length > 0) {
          const sorted = [...snoozedDueItems].sort((a, b) => {
              const aMs = snoozedMeds[a.medication.id] || Number.MAX_SAFE_INTEGER;
              const bMs = snoozedMeds[b.medication.id] || Number.MAX_SAFE_INTEGER;
              return aMs - bMs;
          });
          return { type: 'snoozed' as const, item: sorted[0], label: tr(lang, 'Snoozed', 'مؤجل') };
      }

      const upcoming = upcomingItems
        .filter(t => /^\d{2}:\d{2}$/.test(t.time))
        .map(item => {
          const [h, m] = item.time.split(':').map(Number);
          const target = h * 60 + m;
          const delta = target >= nowMinutes ? target - nowMinutes : target + 1440 - nowMinutes;
          return { item, delta };
        })
        .sort((a, b) => a.delta - b.delta);
      
      if (upcoming.length > 0) {
          return {
            type: 'upcoming' as const,
            item: upcoming[0].item,
            label: tr(lang, `Next in ${upcoming[0].delta} min`, `التالي بعد ${upcoming[0].delta} دقيقة`)
          };
      }

      return null;
  }, [dueNowItems, snoozedDueItems, upcomingItems, nowMinutes, snoozedMeds, lang]);

  const getGreeting = () => {
      const h = currentTime.getHours();
      if (h < 12) return tr(lang, 'Good Morning', 'صباح الخير');
      if (h < 18) return tr(lang, 'Good Afternoon', 'مساء الخير');
      return tr(lang, 'Good Evening', 'مساء الخير');
  };

  return (
    <div className="space-y-8 pb-24 animate-fade-in">
      
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gray-900 text-white shadow-xl">
          {/* Decorative Background Elements */}
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 rounded-full bg-teal-500 opacity-20 blur-3xl"></div>
          <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-64 h-64 rounded-full bg-purple-500 opacity-20 blur-3xl"></div>
          
          <div className="relative z-10 p-6 sm:p-8">
              <div className={`flex justify-between items-center gap-4 ${isArabic ? 'text-right' : ''}`}>
                  <div className="min-w-0 flex-1">
                      <p className="text-gray-400 font-medium text-sm mb-1">
                        {new Date().toLocaleDateString(localeForLanguage(lang), { weekday: 'long', month: 'long', day: 'numeric' })}
                      </p>
                      <h1 className="text-3xl font-bold tracking-tight mb-2 leading-tight">
                        <span className="block">{getGreeting()},</span>
                        <span
                          dir="auto"
                          className={`block text-white truncate ${isArabic ? 'text-right pl-2' : 'text-left pr-2'}`}
                        >
                          {firstName}
                        </span>
                      </h1>
                  </div>
                  
                  {/* Progress Ring */}
                  <div className="relative w-20 h-20 flex-shrink-0 flex items-center justify-center">
                      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 80 80">
                          <circle cx="40" cy="40" r="36" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-gray-700 opacity-50" />
                          <circle 
                            cx="40" cy="40" r="36" 
                            stroke="currentColor" strokeWidth="8" 
                            fill="transparent" 
                            strokeLinecap="round"
                            className="text-teal-400 transition-all duration-1000"
                            strokeDasharray={226}
                            strokeDashoffset={226 - (226 * dailyStats.percentage) / 100}
                          />
                      </svg>
                      <span className="absolute text-sm font-bold">{dailyStats.percentage}%</span>
                  </div>
              </div>

              <div className={`mt-6 flex items-center gap-4 ${isArabic ? 'flex-row-reverse' : ''}`}>
                  <div className={`flex ${isArabic ? 'flex-row-reverse -space-x-2' : '-space-x-2'}`}>
                      <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center border-2 border-gray-900 text-xs shadow-md z-10">
                        <i className="fas fa-check"></i>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center border-2 border-gray-900 text-xs text-gray-300 shadow-md">
                        <i className="fas fa-pills"></i>
                      </div>
                  </div>
                  <p className={`text-sm font-medium text-gray-300 ${isArabic ? 'text-right' : 'text-left'}`}>
                      {tr(
                        lang,
                        `${dailyStats.taken} of ${dailyStats.total} doses taken today`,
                        `تم أخذ ${dailyStats.taken} من ${dailyStats.total} جرعات اليوم`
                      )}
                  </p>
              </div>
          </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-white border border-gray-200 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{tr(lang, 'Taken', 'تم أخذها')}</p>
          <p className="text-2xl font-extrabold text-green-600 mt-1">{dailyStats.taken}</p>
        </div>
        <div className="rounded-2xl bg-white border border-gray-200 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{tr(lang, 'Skipped', 'تم تخطيها')}</p>
          <p className="text-2xl font-extrabold text-orange-500 mt-1">{dailyStats.skipped}</p>
        </div>
        <div className="rounded-2xl bg-white border border-gray-200 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{tr(lang, 'Pending', 'قيد الانتظار')}</p>
          <p className="text-2xl font-extrabold text-blue-600 mt-1">{dailyStats.pending}</p>
        </div>
      </div>

      {showOnboarding && (
        <div className="rounded-2xl border border-teal-200 bg-teal-50 p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-teal-700">{tr(lang, 'First-Time Setup', 'التهيئة الأولى')}</p>
              <h2 className="text-xl font-bold text-gray-900 mt-1">{tr(lang, 'Complete your reminder setup', 'أكمل إعداد التذكيرات')}</h2>
              <p className="text-sm text-gray-600 mt-1">
                {tr(lang, 'Finish these 3 steps once to make PillCare fully ready.', 'أكمل هذه الخطوات الثلاث مرة واحدة لتجهيز PillCare بالكامل.')}
              </p>
            </div>
            <span className="text-xs font-bold px-3 py-1 rounded-full bg-white border border-teal-200 text-teal-700">
              {tr(lang, `${onboardingDoneCount}/3 done`, `${onboardingDoneCount}/3 مكتملة`)}
            </span>
          </div>

          <div className="space-y-2">
            {onboardingSteps.map((step, index) => (
              <div key={step.id} className="rounded-xl bg-white border border-teal-100 px-3 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center ${
                    step.done ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                  }`}>
                    {step.done ? <i className="fas fa-check text-[10px]"></i> : index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{step.title}</p>
                    <p className={`text-[11px] font-bold ${step.done ? 'text-green-600' : 'text-orange-600'}`}>
                      {step.done ? tr(lang, 'Done', 'مكتمل') : tr(lang, 'Pending', 'قيد الانتظار')}
                    </p>
                  </div>
                </div>
                {!step.done && (
                  <button
                    onClick={step.action}
                    className="h-8 px-3 rounded-lg bg-teal-600 text-white text-xs font-bold hover:bg-teal-700 transition-colors"
                  >
                    {step.actionLabel}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Critical Alerts */}
      {(lowStockMeds.length > 0 || expiringMeds.length > 0) && (
          <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
              {lowStockMeds.map(m => (
                  <div key={`stock-${m.id}`} className="flex-shrink-0 w-64 p-4 bg-orange-50 border border-orange-100 rounded-2xl flex items-center gap-3">
                      <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-orange-500 shadow-sm">
                          <i className="fas fa-box-open"></i>
                      </div>
                      <div className={isArabic ? 'text-right' : ''}>
                          <p className="text-xs font-bold text-orange-800 uppercase">{tr(lang, 'Low Stock', 'مخزون منخفض')}</p>
                          <p className="text-sm font-medium text-gray-700">{m.name}: {tr(lang, `${m.inventoryCount} left`, `${m.inventoryCount} متبقي`)}</p>
                      </div>
                  </div>
              ))}
              {expiringMeds.map(m => (
                  <div key={`exp-${m.id}`} className="flex-shrink-0 w-64 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3">
                      <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-red-500 shadow-sm">
                          <i className="fas fa-calendar-times"></i>
                      </div>
                      <div className={isArabic ? 'text-right' : ''}>
                          <p className="text-xs font-bold text-red-800 uppercase">{tr(lang, 'Expires Soon', 'ينتهي قريباً')}</p>
                          <p className="text-sm font-medium text-gray-700">{m.name}</p>
                      </div>
                  </div>
              ))}
          </div>
      )}

      {/* Next Action Card */}
      {nextAction && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{tr(lang, 'Next Action', 'الإجراء التالي')}</p>
              <h3 className="text-xl font-extrabold text-gray-900 leading-tight mt-1">{nextAction.item.medication.name}</h3>
              <p className="text-sm text-gray-600 mt-1">
                {nextAction.type === 'due' && tr(lang, `Scheduled at ${nextAction.item.time}`, `موعدها ${nextAction.item.time}`)}
                {nextAction.type === 'snoozed' && (() => {
                  const until = snoozedMeds[nextAction.item.medication.id] || Date.now();
                  const minsLeft = Math.max(0, Math.ceil((until - Date.now()) / (1000 * 60)));
                  return tr(lang, `Snoozed for ${minsLeft} more min`, `مؤجل لمدة ${minsLeft} دقيقة إضافية`);
                })()}
                {nextAction.type === 'upcoming' && tr(lang, `Scheduled at ${nextAction.item.time}`, `موعدها ${nextAction.item.time}`)}
              </p>
            </div>
            <span className={`text-xs font-bold px-3 py-1 rounded-full ${
              nextAction.type === 'due' ? 'bg-red-100 text-red-700' :
              nextAction.type === 'snoozed' ? 'bg-orange-100 text-orange-700' :
              'bg-blue-100 text-blue-700'
            }`}>
              {nextAction.label}
            </span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onLogDose(nextAction.item.medication.id)}
              className={`flex-1 h-12 rounded-xl font-bold text-white shadow-sm active:scale-95 transition ${
                nextAction.item.medication.slot ? 'bg-indigo-600' : 'bg-teal-600'
              }`}
            >
              {nextAction.item.medication.slot ? tr(lang, 'Dispense Now', 'صرف الآن') : tr(lang, 'Mark Taken', 'تسجيل تم الأخذ')}
            </button>
            <button
              onClick={() => onSnooze(nextAction.item.medication.id)}
              className="h-12 px-4 rounded-xl font-bold text-orange-700 bg-orange-50 border border-orange-200 active:scale-95 transition"
            >
              {tr(lang, `Snooze ${snoozeMinutes}m`, `تأجيل ${snoozeMinutes} د`)}
            </button>
          </div>
        </div>
      )}

      {/* Timeline Section */}
      <div className="space-y-6">
          <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">{tr(lang, "Today's Schedule", 'جدول اليوم')}</h2>
              {dueNowItems.length === 0 && dailyStats.percentage < 100 && (
                  <span className="text-xs font-bold text-gray-400 bg-gray-100 px-2 py-1 rounded-lg">{tr(lang, 'Next Up', 'التالي')}</span>
              )}
          </div>

          {dailyStats.percentage === 100 && dailyStats.total > 0 && (
              <div className="text-center py-12 bg-white rounded-3xl border border-gray-100 shadow-sm">
                  <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce-slow">
                      <i className="fas fa-star text-green-500 text-3xl"></i>
                  </div>
                  <h3 className="text-xl font-bold text-gray-800">{tr(lang, 'All caught up!', 'ممتاز! كل شيء مكتمل')}</h3>
                  <p className="text-gray-500 mt-2">{tr(lang, "You've taken all your meds for today.", 'لقد أخذت جميع أدويتك لليوم.')}</p>
              </div>
          )}

          {!hasTimelineContent ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
                <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
                  <i className="fas fa-calendar-check text-lg"></i>
                </div>
                <h3 className="text-base font-bold text-gray-800">{tr(lang, 'No medication schedule yet', 'لا يوجد جدول أدوية بعد')}</h3>
                <p className="text-sm text-gray-500 mt-1">{tr(lang, 'Add a medication to see your timeline and reminders here.', 'أضف دواءً لتظهر هنا المواعيد والتذكيرات.')}</p>
              </div>
          ) : (
              <div className="space-y-4">
                  {(dueNowItems.length > 0 || snoozedDueItems.length > 0) && (
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">{tr(lang, 'Pending Now', 'المطلوب الآن')}</h3>
                        <span className="text-xs text-gray-500">{tr(lang, `${dueNowItems.length + snoozedDueItems.length} items`, `${dueNowItems.length + snoozedDueItems.length} عناصر`)}</span>
                      </div>

                      {dueNowItems.map(item => (
                        <MedicationCard
                          key={item.id}
                          medication={{ ...item.medication, scheduledTimes: [item.time] }}
                          isDue={true}
                          onTake={() => onLogDose(item.medication.id)}
                          onSnooze={() => onSnooze(item.medication.id)}
                          onDismiss={() => onDismiss(item.medication.id)}
                          language={lang}
                        />
                      ))}

                      {snoozedDueItems.map(item => {
                        const snoozeUntil = snoozedMeds[item.medication.id] || Date.now();
                        const minsLeft = Math.max(0, Math.ceil((snoozeUntil - Date.now()) / (1000 * 60)));
                        return (
                          <div key={item.id} className="space-y-1">
                            <p className="text-[11px] text-orange-600 font-semibold">{tr(lang, `Snoozed, reminds again in ${minsLeft} min`, `مؤجل، سيُذكّر بعد ${minsLeft} دقيقة`)}</p>
                            <MedicationCard
                              medication={{ ...item.medication, scheduledTimes: [item.time] }}
                              isDue={true}
                              onTake={() => onLogDose(item.medication.id)}
                              onSnooze={() => onSnooze(item.medication.id)}
                              onDismiss={() => onDismiss(item.medication.id)}
                              language={lang}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {upcomingItems.length > 0 && (
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">{tr(lang, 'Upcoming Today', 'القادم اليوم')}</h3>
                        <span className="text-xs text-gray-500">{tr(lang, `${upcomingItems.length} items`, `${upcomingItems.length} عناصر`)}</span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {upcomingItems.slice(0, 6).map((item) => (
                          <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 flex items-center justify-between">
                            <div>
                              <p className="text-sm font-semibold text-gray-800">{item.medication.name}</p>
                              <p className="text-[11px] text-gray-500">{item.time}</p>
                            </div>
                            <span className="text-[11px] font-bold text-blue-600 bg-blue-50 border border-blue-100 px-2 py-1 rounded-lg">
                              {tr(lang, 'Pending', 'قيد الانتظار')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {todaySkippedLogs.length > 0 && (
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">{tr(lang, 'Skipped Today', 'تم تخطيها اليوم')}</h3>
                        <span className="text-xs text-gray-400">{tr(lang, `${todaySkippedLogs.length} entries`, `${todaySkippedLogs.length} سجلات`)}</span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {todaySkippedLogs.slice(0, 6).map((log) => (
                          <div key={log.id} className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                            <div>
                              <p className="text-sm font-semibold text-gray-800">{log.medicationName}</p>
                              <p className="text-[11px] text-gray-500">{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                            </div>
                            <button
                              onClick={() => onUndoSkipped(log.id)}
                              className="h-8 px-3 rounded-lg text-xs font-bold text-orange-700 bg-orange-50 border border-orange-200 hover:bg-orange-100"
                            >
                              {tr(lang, 'Undo', 'تراجع')}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {todayTakenLogs.length > 0 && (
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">{tr(lang, 'Taken Today', 'تم أخذها اليوم')}</h3>
                        <span className="text-xs text-gray-400">{tr(lang, `${todayTakenLogs.length} entries`, `${todayTakenLogs.length} سجلات`)}</span>
                      </div>
                      <div className="mt-3 space-y-2">
                        {todayTakenLogs.slice(0, 6).map((log) => (
                          <div key={log.id} className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                            <div>
                              <p className="text-sm font-semibold text-gray-800">{log.medicationName}</p>
                              <p className="text-[11px] text-gray-500">{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                            </div>
                            <button
                              onClick={() => onUndoTaken(log.id)}
                              className="h-8 px-3 rounded-lg text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100"
                            >
                              {tr(lang, 'Undo', 'تراجع')}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
          )}
      </div>

      {/* As Needed Section */}
      {activeMedications.some(m => m.frequencyType === 'As Needed') && (
          <div className="mt-8 pt-8 border-t border-gray-100">
               <h3 className="text-gray-500 font-bold text-xs uppercase tracking-wide mb-4">{tr(lang, 'As Needed (PRN)', 'عند الحاجة (PRN)')}</h3>
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                   {activeMedications.filter(m => m.frequencyType === 'As Needed').map(med => (
                       <div key={med.id} className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-xl shadow-sm">
                           <div className="flex items-center gap-3">
                               <div className={`w-8 h-8 rounded-lg bg-${med.color || 'gray'}-50 text-${med.color || 'gray'}-500 flex items-center justify-center`}>
                                   <i className="fas fa-first-aid"></i>
                               </div>
                               <div className={isArabic ? 'text-right' : ''}>
                                   <p className="font-bold text-sm text-gray-800">{med.name}</p>
                                   <p className="text-[10px] text-gray-400">{med.dosage}</p>
                               </div>
                           </div>
                           <button onClick={() => onLogDose(med.id)} className="w-8 h-8 bg-teal-50 text-teal-600 rounded-full flex items-center justify-center hover:bg-teal-100 transition-colors">
                               <i className="fas fa-plus"></i>
                           </button>
                       </div>
                   ))}
               </div>
          </div>
      )}

    </div>
  );
};


