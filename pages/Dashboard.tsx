import React, { useState, useEffect, useMemo } from 'react';
import { Medication, LogEntry } from '../types';
import { MedicationCard } from '../components/MedicationCard';

interface DashboardProps {
  medications: Medication[];
  logs: LogEntry[];
  onLogDose: (medId: string) => void;
  onSnooze: (medId: string) => void;
  onDismiss: (medId: string) => void;
  userName: string;
  snoozedMeds: { [key: string]: number };
}

type TimeOfDay = 'Morning' | 'Afternoon' | 'Evening' | 'Night';

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
  userName, 
  snoozedMeds 
}) => {
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update time every minute to keep "Due" status fresh
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const todayStr = new Date().toISOString().split('T')[0];

  // 1. Calculate Daily Progress
  const dailyStats = useMemo(() => {
    // Only count scheduled meds for adherence
    const scheduledMeds = medications.filter(m => m.frequencyType !== 'As Needed');
    let totalDoses = 0;
    
    scheduledMeds.forEach(m => {
        if (m.frequencyType === 'Daily' && m.scheduledTimes) {
            totalDoses += m.scheduledTimes.length;
        } else {
            totalDoses += 1; // Fallback for Interval/Other
        }
    });

    const todaysLogs = logs.filter(l => l.timestamp.startsWith(todayStr));
    const takenCount = todaysLogs.filter(l => l.status === 'Taken').length;
    
    return {
        total: totalDoses,
        taken: takenCount,
        percentage: totalDoses > 0 ? Math.round((takenCount / totalDoses) * 100) : 100
    };
  }, [medications, logs, todayStr]);


  // 2. Build the Timeline
  const timeline = useMemo(() => {
      let items: TimelineItem[] = [];

      medications.forEach(med => {
          // Skip As Needed for the timeline (they appear in a separate section if active)
          if (med.frequencyType === 'As Needed') return;

          const medLogs = logs.filter(l => l.medicationId === med.id && l.timestamp.startsWith(todayStr));
          const takenCount = medLogs.filter(l => l.status === 'Taken').length;
          const skippedCount = medLogs.filter(l => l.status === 'Skipped').length;
          const totalActioned = takenCount + skippedCount;

          if (med.frequencyType === 'Daily' && med.scheduledTimes) {
              med.scheduledTimes.forEach((time, index) => {
                  let status: TimelineItem['status'] = 'upcoming';
                  
                  // Simple Logic: Match doses sequentially
                  // If index < totalActioned, this dose is done.
                  if (index < totalActioned) {
                      // Check if the specific log at this index was skipped or taken
                      // (This is an approximation since we don't link log to specific time slot in DB yet)
                      // For MVP visual: if we have 2 logs, first 2 slots are done.
                      status = 'taken'; // visual simplification
                  } else {
                      // Not taken yet. Is it due?
                      const [hours, mins] = time.split(':').map(Number);
                      const scheduleDate = new Date();
                      scheduleDate.setHours(hours, mins, 0, 0);
                      
                      if (currentTime > scheduleDate) {
                          status = 'due';
                      }
                  }

                  // Override for Snooze
                  const isSnoozed = snoozedMeds[med.id] && Date.now() < snoozedMeds[med.id];
                  
                  items.push({
                      id: `${med.id}-${time}`,
                      medication: med,
                      time,
                      status,
                      isSnoozed
                  });
              });
          } else {
              // Interval or other
              // Just show one generic slot per interval or a "Next Due" calculation
              // For MVP, if not taken today, show as Due if start date is past.
              const isTaken = totalActioned > 0;
              items.push({
                  id: `${med.id}-interval`,
                  medication: med,
                  time: 'Anytime',
                  status: isTaken ? 'taken' : 'due',
              });
          }
      });

      // Sort by time
      return items.sort((a, b) => a.time.localeCompare(b.time));
  }, [medications, logs, todayStr, currentTime, snoozedMeds]);

  // Group Timeline by Time of Day
  const groupedTimeline = useMemo(() => {
      const groups: Record<string, TimelineItem[]> = {
          'Morning': [],
          'Afternoon': [],
          'Evening': []
      };

      timeline.forEach(item => {
          if (item.status === 'taken' || item.status === 'skipped') return; // Don't show completed in main timeline for clutter reduction

          const hour = parseInt(item.time.split(':')[0]);
          if (hour < 12) groups['Morning'].push(item);
          else if (hour < 17) groups['Afternoon'].push(item);
          else groups['Evening'].push(item);
      });

      return groups;
  }, [timeline]);

  // Alerts Logic
  const lowStockMeds = medications.filter(m => m.inventoryCount <= 5);
  const expiringMeds = medications.filter(m => {
      if (!m.expiryDate) return false;
      const exp = new Date(m.expiryDate);
      const diff = Math.ceil((exp.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
      return diff <= 30 && diff >= 0;
  });

  const getGreeting = () => {
      const h = currentTime.getHours();
      if (h < 12) return 'Good Morning';
      if (h < 18) return 'Good Afternoon';
      return 'Good Evening';
  };

  return (
    <div className="space-y-8 pb-24 animate-fade-in">
      
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gray-900 text-white shadow-xl">
          {/* Decorative Background Elements */}
          <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 rounded-full bg-teal-500 opacity-20 blur-3xl"></div>
          <div className="absolute bottom-0 left-0 -ml-16 -mb-16 w-64 h-64 rounded-full bg-purple-500 opacity-20 blur-3xl"></div>
          
          <div className="relative z-10 p-6 sm:p-8">
              <div className="flex justify-between items-center gap-4">
                  <div className="min-w-0 flex-1">
                      <p className="text-gray-400 font-medium text-sm mb-1">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                      <h1 className="text-3xl font-bold tracking-tight mb-2 leading-tight">
                        <span className="block">{getGreeting()},</span>
                        <span className="block text-white truncate pr-2">{userName.split(' ')[0]}</span>
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

              <div className="mt-6 flex items-center space-x-4">
                  <div className="flex -space-x-2">
                      <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center border-2 border-gray-900 text-xs shadow-md z-10">
                        <i className="fas fa-check"></i>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center border-2 border-gray-900 text-xs text-gray-300 shadow-md">
                        <i className="fas fa-pills"></i>
                      </div>
                  </div>
                  <p className="text-sm font-medium text-gray-300">
                      {dailyStats.taken} of {dailyStats.total} doses taken today
                  </p>
              </div>
          </div>
      </div>

      {/* Critical Alerts */}
      {(lowStockMeds.length > 0 || expiringMeds.length > 0) && (
          <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
              {lowStockMeds.map(m => (
                  <div key={`stock-${m.id}`} className="flex-shrink-0 w-64 p-4 bg-orange-50 border border-orange-100 rounded-2xl flex items-center space-x-3">
                      <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-orange-500 shadow-sm">
                          <i className="fas fa-box-open"></i>
                      </div>
                      <div>
                          <p className="text-xs font-bold text-orange-800 uppercase">Low Stock</p>
                          <p className="text-sm font-medium text-gray-700">{m.name}: {m.inventoryCount} left</p>
                      </div>
                  </div>
              ))}
              {expiringMeds.map(m => (
                  <div key={`exp-${m.id}`} className="flex-shrink-0 w-64 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center space-x-3">
                      <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-red-500 shadow-sm">
                          <i className="fas fa-calendar-times"></i>
                      </div>
                      <div>
                          <p className="text-xs font-bold text-red-800 uppercase">Expires Soon</p>
                          <p className="text-sm font-medium text-gray-700">{m.name}</p>
                      </div>
                  </div>
              ))}
          </div>
      )}

      {/* Timeline Section */}
      <div className="space-y-6">
          <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Today's Schedule</h2>
              {timeline.filter(t => t.status === 'due').length === 0 && dailyStats.percentage < 100 && (
                  <span className="text-xs font-bold text-gray-400 bg-gray-100 px-2 py-1 rounded-lg">Next Up</span>
              )}
          </div>

          {dailyStats.percentage === 100 && dailyStats.total > 0 ? (
              <div className="text-center py-12 bg-white rounded-3xl border border-gray-100 shadow-sm">
                  <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce-slow">
                      <i className="fas fa-star text-green-500 text-3xl"></i>
                  </div>
                  <h3 className="text-xl font-bold text-gray-800">All caught up!</h3>
                  <p className="text-gray-500 mt-2">You've taken all your meds for today.</p>
              </div>
          ) : (
              <div className="relative space-y-8">
                  {/* Vertical Line */}
                  <div className="absolute left-4 top-4 bottom-4 w-0.5 bg-gray-200 z-0"></div>

                  {/* Due Now High Priority */}
                  {timeline.some(t => t.status === 'due' && !t.isSnoozed) && (
                      <div className="relative z-10 pl-12">
                          <div className="absolute left-0 top-0 w-8 h-8 rounded-full bg-red-500 border-4 border-white shadow-md flex items-center justify-center text-white text-xs animate-pulse">
                              <i className="fas fa-bell"></i>
                          </div>
                          <h3 className="text-red-500 font-bold text-sm uppercase tracking-wide mb-3">Due Now</h3>
                          <div className="space-y-3">
                              {timeline.filter(t => t.status === 'due' && !t.isSnoozed).map(item => (
                                  <MedicationCard 
                                      key={item.id}
                                      medication={{...item.medication, scheduledTimes: [item.time]}} // Show only relevant time
                                      isDue={true}
                                      onTake={() => onLogDose(item.medication.id)}
                                      onSnooze={() => onSnooze(item.medication.id)}
                                      onDismiss={() => onDismiss(item.medication.id)}
                                  />
                              ))}
                          </div>
                      </div>
                  )}

                  {/* Morning Group */}
                  {groupedTimeline['Morning'].length > 0 && (
                      <div className="relative z-10 pl-12">
                          <div className="absolute left-0 top-0 w-8 h-8 rounded-full bg-orange-100 border-4 border-white shadow-sm flex items-center justify-center text-orange-500 text-xs">
                              <i className="fas fa-sun"></i>
                          </div>
                          <h3 className="text-gray-400 font-bold text-sm uppercase tracking-wide mb-3">Morning</h3>
                          <div className="space-y-3">
                              {groupedTimeline['Morning'].filter(t => t.status !== 'due').map(item => (
                                  <MedicationCard key={item.id} medication={{...item.medication, scheduledTimes: [item.time]}} />
                              ))}
                          </div>
                      </div>
                  )}

                  {/* Afternoon Group */}
                  {groupedTimeline['Afternoon'].length > 0 && (
                      <div className="relative z-10 pl-12">
                          <div className="absolute left-0 top-0 w-8 h-8 rounded-full bg-blue-100 border-4 border-white shadow-sm flex items-center justify-center text-blue-500 text-xs">
                              <i className="fas fa-cloud-sun"></i>
                          </div>
                          <h3 className="text-gray-400 font-bold text-sm uppercase tracking-wide mb-3">Afternoon</h3>
                          <div className="space-y-3">
                              {groupedTimeline['Afternoon'].filter(t => t.status !== 'due').map(item => (
                                  <MedicationCard key={item.id} medication={{...item.medication, scheduledTimes: [item.time]}} />
                              ))}
                          </div>
                      </div>
                  )}

                  {/* Evening Group */}
                  {groupedTimeline['Evening'].length > 0 && (
                      <div className="relative z-10 pl-12">
                          <div className="absolute left-0 top-0 w-8 h-8 rounded-full bg-indigo-100 border-4 border-white shadow-sm flex items-center justify-center text-indigo-500 text-xs">
                              <i className="fas fa-moon"></i>
                          </div>
                          <h3 className="text-gray-400 font-bold text-sm uppercase tracking-wide mb-3">Evening</h3>
                          <div className="space-y-3">
                              {groupedTimeline['Evening'].filter(t => t.status !== 'due').map(item => (
                                  <MedicationCard key={item.id} medication={{...item.medication, scheduledTimes: [item.time]}} />
                              ))}
                          </div>
                      </div>
                  )}
              </div>
          )}
      </div>

      {/* As Needed Section */}
      {medications.some(m => m.frequencyType === 'As Needed') && (
          <div className="mt-8 pt-8 border-t border-gray-100">
               <h3 className="text-gray-500 font-bold text-xs uppercase tracking-wide mb-4">As Needed (PRN)</h3>
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                   {medications.filter(m => m.frequencyType === 'As Needed').map(med => (
                       <div key={med.id} className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-xl shadow-sm">
                           <div className="flex items-center space-x-3">
                               <div className={`w-8 h-8 rounded-lg bg-${med.color || 'gray'}-50 text-${med.color || 'gray'}-500 flex items-center justify-center`}>
                                   <i className="fas fa-first-aid"></i>
                               </div>
                               <div>
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