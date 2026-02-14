import React, { useState, useEffect, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Medications } from './pages/Medications';
import { Interactions } from './pages/Interactions';
import { Profile } from './pages/Profile';
import { History } from './pages/History';
import { Reports } from './pages/Reports';
import { AuthPage } from './pages/Auth';
import { Medication, UserProfile, LogEntry, DosageForm, AppNotification } from './types';
import { syncDispenserConfig, sendDispenseCommand, syncLogs, listenToData, auth, saveUserProfile, registerPushToken, listenForForegroundPush, saveUserTimezone } from './services/firebase';

// Mock Data Structure
const MOCK_USER: UserProfile = {
  name: "Guest User",
  age: 34,
  conditions: ["Hypertension", "Asthma"],
  allergies: ["Penicillin", "Peanuts"],
  emergencyContact: "+1 (555) 012-3456",
  notificationsEnabled: false
};

const DISPENSE_WINDOW_MINUTES = 15;

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [user, setUser] = useState<UserProfile>(MOCK_USER);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const [snoozedMeds, setSnoozedMeds] = useState<{ [key: string]: number }>({});
  
  const lastReminderCheckMsRef = useRef<number>(Date.now());
  const reminderDayRef = useRef<string>(new Date().toISOString().split('T')[0]);
  const firedReminderKeysRef = useRef<Set<string>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timezoneSyncedRef = useRef<string>("");

  // Auth Listener
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(u => {
      setCurrentUser(u);
      setLoadingAuth(false);
      
      if (u) {
        if (!user.name || user.name === "Guest User") {
            setUser(prev => ({
                ...prev,
                name: u.displayName || u.email?.split('@')[0] || "User"
            }));
        }
      } else {
        setMedications([]);
        setLogs([]);
        setNotifications([]);
        setUser(MOCK_USER);
        setSnoozedMeds({});
        localStorage.removeItem('pillcare_meds');
        localStorage.removeItem('pillcare_logs');
      }
    });
    return unsubscribe;
  }, []);

  // Listen for Data
  useEffect(() => {
    if (currentUser) {
        const unsubscribe = listenToData(
            (fetchedMeds) => {
                setMedications(fetchedMeds || []);
                localStorage.setItem('pillcare_meds', JSON.stringify(fetchedMeds || []));
            },
            (fetchedLogs) => {
                setLogs(fetchedLogs || []);
                localStorage.setItem('pillcare_logs', JSON.stringify(fetchedLogs || []));
            },
            (fetchedProfile) => {
                setUser(prev => ({ ...prev, ...fetchedProfile }));
            }
        );
        return () => unsubscribe();
    }
  }, [currentUser]);

  // Sync Logic
  useEffect(() => {
    if (currentUser && medications.length > 0) syncDispenserConfig(medications);
  }, [medications, currentUser]);

  useEffect(() => {
    if (currentUser && logs.length > 0) syncLogs(logs);
  }, [logs, currentUser]);

  // --- Notification System ---

  const addNotification = (title: string, message: string, type: AppNotification['type'] = 'info') => {
      const newNotif: AppNotification = {
          id: Date.now().toString(),
          title,
          message,
          type,
          timestamp: new Date().toISOString(),
          read: false
      };
      setNotifications(prev => [newNotif, ...prev]);
  };

  const playReminderSound = () => {
    try {
      const AudioCtor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
      if (!AudioCtor) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AudioCtor();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.36);
    } catch (e) {
      console.error("Failed to play reminder sound", e);
    }
  };

  const sendBrowserNotification = async (title: string, body: string) => {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const options: NotificationOptions = {
      body,
      icon: 'https://cdn-icons-png.flaticon.com/512/883/883360.png',
      badge: 'https://cdn-icons-png.flaticon.com/512/883/883360.png',
      tag: `pillcare-${title}`,
      renotify: true,
      requireInteraction: true,
      vibrate: [180, 120, 180]
    };

    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, options);
        return;
      }

      new Notification(title, options);
    } catch (e) {
      console.error("Failed to send notification", e);
    }
  };

  const parseTodayTime = (base: Date, hhmm: string) => {
    const [hStr, mStr] = hhmm.split(':');
    const h = Number(hStr);
    const m = Number(mStr);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    const dt = new Date(base);
    dt.setHours(h, m, 0, 0);
    return dt;
  };

  const triggerReminder = (
    title: string,
    message: string,
    dedupeKey?: string
  ) => {
    if (dedupeKey && firedReminderKeysRef.current.has(dedupeKey)) return;
    if (dedupeKey) firedReminderKeysRef.current.add(dedupeKey);

    addNotification(title, message, 'reminder');
    if (user.notificationsEnabled) {
      void sendBrowserNotification(title, message);
    }

    playReminderSound();
  };

  // Periodic Reminder Check (Every 60s)
  useEffect(() => {
    if (!currentUser) return;

    const checkReminders = () => {
        const now = new Date();
        const nowMs = now.getTime();
        const fromMs = lastReminderCheckMsRef.current - 1000;
        lastReminderCheckMsRef.current = nowMs;

        const dayKey = now.toISOString().split('T')[0];
        if (reminderDayRef.current !== dayKey) {
          reminderDayRef.current = dayKey;
          firedReminderKeysRef.current.clear();
        }

        medications.forEach(med => {
            if (med.frequencyType !== 'Daily' || !med.scheduledTimes?.length) return;

            med.scheduledTimes.forEach(time => {
                const scheduleDate = parseTodayTime(now, time);
                if (!scheduleDate) return;
                const scheduleMs = scheduleDate.getTime();

                if (scheduleMs > fromMs && scheduleMs <= nowMs + 1000) {
                    if (snoozedMeds[med.id] && nowMs < snoozedMeds[med.id]) return;
                    const key = `daily:${dayKey}:${med.id}:${time}`;
                    triggerReminder(
                      `Time for ${med.name}`,
                      `It's ${time}. Please take your ${med.dosage} dose.`,
                      key
                    );
                }
            });
        });

        Object.entries(snoozedMeds).forEach(([medId, snoozeUntil]) => {
          if (nowMs < snoozeUntil) return;
          const med = medications.find(m => m.id === medId);
          if (!med) return;

          const key = `snooze:${medId}:${Math.floor(snoozeUntil / 60000)}`;
          triggerReminder(
            `Snooze ended: ${med.name}`,
            `Reminder is active again for ${med.dosage}.`,
            key
          );

          setSnoozedMeds(prev => {
            if (!(medId in prev)) return prev;
            const next = { ...prev };
            delete next[medId];
            return next;
          });
        });
    };

    checkReminders();
    const timer = setInterval(checkReminders, 15000);
    return () => clearInterval(timer);
  }, [medications, currentUser, user.notificationsEnabled, snoozedMeds]);

  // Initial Permission Request
  useEffect(() => {
    // We do NOT automatically request permission here anymore if we want the user to control it via Profile
    // However, if already granted, we can assume we are good.
    // If we want to prompt early, we can, but let's stick to user-initiated in Profile for better UX.
  }, []);

  useEffect(() => {
    if (!currentUser || !user.notificationsEnabled) return;
    void registerPushToken();
  }, [currentUser, user.notificationsEnabled]);

  useEffect(() => {
    if (!currentUser) return;
    let unsubscribe: (() => void) | undefined;

    const attach = async () => {
      unsubscribe = await listenForForegroundPush((payload) => {
        const title = payload.notification?.title || "Medication Reminder";
        const body = payload.notification?.body || "You have a due medication.";
        addNotification(title, body, 'reminder');
        playReminderSound();
      });
    };

    void attach();
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (!tz) return;
    if (timezoneSyncedRef.current === tz) return;
    if (user.timezone === tz) {
      timezoneSyncedRef.current = tz;
      return;
    }
    timezoneSyncedRef.current = tz;
    saveUserTimezone(tz);
  }, [currentUser, user.timezone]);

  const handleClearNotifications = () => {
      setNotifications([]);
  };

  // --- Handlers ---

  const handleAddMedication = (med: Medication) => {
    const newMeds = [...medications, med];
    setMedications(newMeds);
    syncDispenserConfig(newMeds);
    addNotification('Medication Added', `${med.name} has been added to your schedule.`, 'success');
  };

  const handleUpdateMedication = (updatedMed: Medication) => {
    const newMeds = medications.map(m => m.id === updatedMed.id ? updatedMed : m);
    setMedications(newMeds);
    syncDispenserConfig(newMeds);
  };

  const handleDeleteMedication = (id: string) => {
    const newMeds = medications.filter(m => m.id !== id);
    setMedications(newMeds);
    syncDispenserConfig(newMeds);
  };

  const isWithinDispenseWindow = (med: Medication, now: Date) => {
    if (!med.scheduledTimes || med.scheduledTimes.length === 0) {
      return { allowed: true, nearest: '--:--', diff: 0 };
    }

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    let nearest = med.scheduledTimes[0];
    let nearestDiff = Number.MAX_SAFE_INTEGER;

    for (const t of med.scheduledTimes) {
      const [hStr, mStr] = t.split(':');
      const h = Number(hStr);
      const m = Number(mStr);
      if (Number.isNaN(h) || Number.isNaN(m)) continue;

      const target = h * 60 + m;
      let diff = Math.abs(nowMinutes - target);
      if (diff > 720) diff = 1440 - diff;

      if (diff < nearestDiff) {
        nearestDiff = diff;
        nearest = t;
      }
    }

    return {
      allowed: nearestDiff <= DISPENSE_WINDOW_MINUTES,
      nearest,
      diff: nearestDiff
    };
  };

  const handleLogDose = (medId: string) => {
    const med = medications.find(m => m.id === medId);
    if (med) {
        if (med.slot) {
            const windowCheck = isWithinDispenseWindow(med, new Date());
            if (!windowCheck.allowed) {
                addNotification(
                    "Outside Dispense Window",
                    `${med.name} can be dispensed within +/-${DISPENSE_WINDOW_MINUTES} minutes of ${windowCheck.nearest}. Current diff: ${windowCheck.diff} min.`,
                    'warning'
                );
                return;
            }
        }

        const newLog: LogEntry = {
            id: Date.now().toString(),
            medicationId: med.id,
            medicationName: med.name,
            timestamp: new Date().toISOString(),
            status: 'Taken'
        };
        const newLogs = [newLog, ...logs];
        setLogs(newLogs);
        syncLogs(newLogs);
        
        const newInventory = Math.max(0, med.inventoryCount - 1);
        const newMeds = medications.map(m => 
            m.id === medId ? { ...m, inventoryCount: newInventory } : m
        );
        setMedications(newMeds);
        syncDispenserConfig(newMeds);

        if (med.slot) sendDispenseCommand(med.slot, med.name);

        if (newInventory <= 5 && newInventory > 0) {
             const msg = `Only ${newInventory} pills left of ${med.name}.`;
             if (user.notificationsEnabled) {
                 sendBrowserNotification("Low Stock Alert", msg);
             }
             addNotification("Low Stock Warning", msg, 'warning');
        } else if (newInventory === 0) {
             const msg = `${med.name} is out of stock!`;
             if (user.notificationsEnabled) {
                 sendBrowserNotification("Out of Stock", msg);
             }
             addNotification("Out of Stock", msg, 'warning');
        }
    }
  };

  const handleSnooze = (medId: string) => {
    const snoozeUntil = Date.now() + 15 * 60 * 1000;
    setSnoozedMeds(prev => ({ ...prev, [medId]: snoozeUntil }));
    addNotification("Snoozed", "Reminder set for 15 minutes from now.", 'info');
  };

  const handleDismiss = (medId: string) => {
    const med = medications.find(m => m.id === medId);
    if (med) {
        const newLog: LogEntry = {
            id: Date.now().toString(),
            medicationId: med.id,
            medicationName: med.name,
            timestamp: new Date().toISOString(),
            status: 'Skipped'
        };
        const newLogs = [newLog, ...logs];
        setLogs(newLogs);
        syncLogs(newLogs);
    }
  };

  const handleUpdateProfile = (updatedProfile: UserProfile) => {
      setUser(updatedProfile);
      saveUserProfile(updatedProfile);
      addNotification("Profile Updated", "Your changes have been saved successfully.", 'success');
  };

  const handleLogout = () => {
    auth.signOut();
  };

  if (loadingAuth) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center text-teal-600">
            <i className="fas fa-heartbeat fa-spin text-4xl mb-2"></i>
            <p className="font-medium">Loading PillCare...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <AuthPage />;
  }

  return (
    <HashRouter>
      <Layout notifications={notifications} onClearNotifications={handleClearNotifications}>
        <Routes>
          <Route path="/" element={
            <Dashboard 
                medications={medications} 
                logs={logs} 
                onLogDose={handleLogDose} 
                onSnooze={handleSnooze}
                onDismiss={handleDismiss}
                userName={user.name}
                snoozedMeds={snoozedMeds}
            />
          } />
          <Route path="/medications" element={
            <Medications 
                medications={medications} 
                onAdd={handleAddMedication} 
                onUpdate={handleUpdateMedication}
                onDelete={handleDeleteMedication} 
            />
          } />
          <Route path="/interactions" element={
            <Interactions 
                medications={medications} 
                userAllergies={user.allergies} 
            />
          } />
          <Route path="/history" element={<History logs={logs} />} />
          <Route path="/reports" element={<Reports logs={logs} medications={medications} />} />
          <Route path="/profile" element={
            <Profile 
                user={user} 
                medications={medications}
                logs={logs}
                onLogout={handleLogout} 
                onUpdate={handleUpdateProfile} 
            />
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
};

export default App;
