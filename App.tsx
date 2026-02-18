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
import { Medication, UserProfile, LogEntry, AppNotification } from './types';
import { syncDispenserConfig, sendDispenseCommand, syncLogs, listenToData, auth, saveUserProfile, registerPushToken, listenForForegroundPush, saveUserTimezone, getWebPushSupportStatus } from './services/firebase';
import { resolveLanguage, tr } from './services/i18n';

// Mock Data Structure
const MOCK_USER: UserProfile = {
  name: "Guest User",
  age: 34,
  conditions: ["Hypertension", "Asthma"],
  allergies: ["Penicillin", "Peanuts"],
  emergencyContact: "+1 (555) 012-3456",
  notificationsEnabled: false,
  snoozeDurationMinutes: 15,
  notificationSound: 'Chime',
  appearance: 'Light',
  language: 'en'
};

const DISPENSE_WINDOW_MINUTES = 15;
const NOTIF_BOOTSTRAP_KEY = 'pillcare_notif_bootstrap_v1';
const NOTIF_PROMPT_HIDE_KEY = 'pillcare_notif_prompt_hide_v1';
const LEGACY_MEDS_CACHE_KEY = 'pillcare_meds';
const LEGACY_LOGS_CACHE_KEY = 'pillcare_logs';
const cacheKeyForUser = (uid: string, bucket: 'meds' | 'logs' | 'profile') => `pillcare_${bucket}_${uid}`;

const normalizeUserProfile = (incoming?: Partial<UserProfile>): UserProfile => {
  const profile = { ...MOCK_USER, ...(incoming || {}) };
  return {
    ...profile,
    conditions: Array.isArray(profile.conditions) ? profile.conditions : [],
    allergies: Array.isArray(profile.allergies) ? profile.allergies : [],
    snoozeDurationMinutes: profile.snoozeDurationMinutes || 15,
    notificationSound: profile.notificationSound || 'Chime',
    appearance: profile.appearance || 'Light',
    language: profile.language || 'en'
  };
};

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [user, setUser] = useState<UserProfile>(normalizeUserProfile(MOCK_USER));
  const [medications, setMedications] = useState<Medication[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotifPrompt, setShowNotifPrompt] = useState(false);
  const [pushSupported, setPushSupported] = useState<boolean | null>(null);
  const [pushSupportReason, setPushSupportReason] = useState<string>('ok');
  const [isIosDevice, setIsIosDevice] = useState(false);
  const [isStandaloneMode, setIsStandaloneMode] = useState(false);

  const [snoozedMeds, setSnoozedMeds] = useState<{ [key: string]: number }>({});
  
  const lastReminderCheckMsRef = useRef<number>(Date.now());
  const reminderDayRef = useRef<string>(new Date().toISOString().split('T')[0]);
  const firedReminderKeysRef = useRef<Set<string>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timezoneSyncedRef = useRef<string>("");
  const medicationsStateRef = useRef<Medication[]>([]);
  const logsStateRef = useRef<LogEntry[]>([]);
  const dataListenerStartedAtRef = useRef<number>(0);
  const loggingOutRef = useRef(false);
  const lastUidRef = useRef<string | null>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(u => {
      const previousUid = lastUidRef.current;
      lastUidRef.current = u?.uid || null;
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
        setUser(normalizeUserProfile(MOCK_USER));
        setSnoozedMeds({});
        setShowNotifPrompt(false);
        setPushSupported(null);
        setPushSupportReason('ok');

        // Only clear local caches when user explicitly logs out.
        if (loggingOutRef.current && previousUid) {
          localStorage.removeItem(cacheKeyForUser(previousUid, 'meds'));
          localStorage.removeItem(cacheKeyForUser(previousUid, 'logs'));
          localStorage.removeItem(cacheKeyForUser(previousUid, 'profile'));
          localStorage.removeItem(LEGACY_MEDS_CACHE_KEY);
          localStorage.removeItem(LEGACY_LOGS_CACHE_KEY);
          loggingOutRef.current = false;
        }
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    medicationsStateRef.current = medications;
  }, [medications]);

  useEffect(() => {
    logsStateRef.current = logs;
  }, [logs]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    try {
      const medsRaw =
        localStorage.getItem(cacheKeyForUser(currentUser.uid, 'meds')) ||
        localStorage.getItem(LEGACY_MEDS_CACHE_KEY);
      const logsRaw =
        localStorage.getItem(cacheKeyForUser(currentUser.uid, 'logs')) ||
        localStorage.getItem(LEGACY_LOGS_CACHE_KEY);
      const profileRaw = localStorage.getItem(cacheKeyForUser(currentUser.uid, 'profile'));

      if (medsRaw) {
        const cachedMeds = JSON.parse(medsRaw);
        if (Array.isArray(cachedMeds)) setMedications(cachedMeds);
      }
      if (logsRaw) {
        const cachedLogs = JSON.parse(logsRaw);
        if (Array.isArray(cachedLogs)) setLogs(cachedLogs);
      }
      if (profileRaw) {
        const cachedProfile = JSON.parse(profileRaw);
        if (cachedProfile && typeof cachedProfile === 'object') {
          setUser(prev => normalizeUserProfile({ ...prev, ...cachedProfile }));
        }
      }
    } catch (e) {
      console.error("Failed to hydrate cached user data", e);
    }
  }, [currentUser?.uid]);

  // Listen for Data
  useEffect(() => {
    if (currentUser) {
        dataListenerStartedAtRef.current = Date.now();
        const uid = currentUser.uid;
        const unsubscribe = listenToData(
            (fetchedMeds) => {
                const incoming = fetchedMeds || [];
                const startupWindowMs = 12000;
                const withinStartupWindow = Date.now() - dataListenerStartedAtRef.current < startupWindowMs;
                const shouldKeepCached =
                  withinStartupWindow &&
                  incoming.length === 0 &&
                  medicationsStateRef.current.length > 0;

                if (shouldKeepCached) return;

                setMedications(incoming);
                const serialized = JSON.stringify(incoming);
                localStorage.setItem(cacheKeyForUser(uid, 'meds'), serialized);
                localStorage.setItem(LEGACY_MEDS_CACHE_KEY, serialized);
            },
            (fetchedLogs) => {
                const incoming = fetchedLogs || [];
                const startupWindowMs = 12000;
                const withinStartupWindow = Date.now() - dataListenerStartedAtRef.current < startupWindowMs;
                const shouldKeepCached =
                  withinStartupWindow &&
                  incoming.length === 0 &&
                  logsStateRef.current.length > 0;

                if (shouldKeepCached) return;

                setLogs(incoming);
                const serialized = JSON.stringify(incoming);
                localStorage.setItem(cacheKeyForUser(uid, 'logs'), serialized);
                localStorage.setItem(LEGACY_LOGS_CACHE_KEY, serialized);
            },
            (fetchedProfile) => {
                setUser(prev => normalizeUserProfile({ ...prev, ...fetchedProfile }));
                if (fetchedProfile) {
                  localStorage.setItem(
                    cacheKeyForUser(uid, 'profile'),
                    JSON.stringify(fetchedProfile)
                  );
                }
            }
        );
        return () => unsubscribe();
    }
  }, [currentUser]);

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

  const playReminderSound = (sound: UserProfile['notificationSound']) => {
    if (!sound || sound === 'Off') return;
    try {
      const AudioCtor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
      if (!AudioCtor) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AudioCtor();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }

      const wave = sound === 'Beep' ? 'square' : 'sine';
      const freq = sound === 'Beep' ? 760 : 880;
      const pulseDuration = sound === 'Beep' ? 0.2 : 0.36;
      const startOffsets = sound === 'Beep' ? [0, 0.28, 0.56] : [0, 0.42];

      startOffsets.forEach((offset) => {
        const startAt = ctx.currentTime + offset;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = wave;
        osc.frequency.setValueAtTime(freq, startAt);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.085, startAt + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + pulseDuration - 0.02);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startAt);
        osc.stop(startAt + pulseDuration);
      });
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
      vibrate: [260, 120, 260, 120, 420],
      data: {
        link: '/#/'
      }
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

  const isMedicationScheduledToday = (med: Medication, now: Date = new Date()) => {
    if (med.isActive === false) return false;
    const cycleDays = med.cycleDays;
    if (!cycleDays || cycleDays.length === 0) return true;
    return cycleDays.includes(now.getDay());
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

    playReminderSound(user.notificationSound);
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
            if (!isMedicationScheduledToday(med, now)) return;
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ua = window.navigator.userAgent || '';
    const iOS = /iPad|iPhone|iPod/.test(ua) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    setIsIosDevice(iOS);
    setIsStandaloneMode(Boolean(standalone));
  }, []);

  const setNotificationsEnabled = (enabled: boolean) => {
    setUser(prev => {
      if (Boolean(prev.notificationsEnabled) === enabled) return prev;
      const next = { ...prev, notificationsEnabled: enabled };
      if (currentUser) saveUserProfile(next);
      return next;
    });
  };

  const pushSetupHint = (reason?: string) => {
    if (reason === 'missing-vapid-key') {
      return "Push is not fully configured on this build. Missing VITE_FIREBASE_VAPID_KEY.";
    }
    if (reason === 'unsupported-browser') {
      return "This device/browser cannot receive web push in the current app mode.";
    }
    if (reason === 'permission-not-granted') {
      return "Browser notification permission is not granted yet.";
    }
    return "Push setup is incomplete. Re-enable notifications from Settings and try again.";
  };

  const registerPushTokenWithFeedback = async (showWarning: boolean) => {
    const result = await registerPushToken();
    if (!result.ok && showWarning) {
      addNotification('Reminder Setup Needed', pushSetupHint(result.reason), 'warning');
    }
    return result;
  };

  const bootstrapNotifications = async () => {
    if (!currentUser) return;

    const support = await getWebPushSupportStatus();
    setPushSupported(support.supported);
    setPushSupportReason(support.reason);

    const hiddenByUser = localStorage.getItem(NOTIF_PROMPT_HIDE_KEY) === '1';
    const bootstrapKey = `${NOTIF_BOOTSTRAP_KEY}_${currentUser.uid}`;
    const alreadyBootstrapped = localStorage.getItem(bootstrapKey) === '1';

    if (!support.supported) {
      setShowNotifPrompt(!hiddenByUser);
      return;
    }

    if (Notification.permission === 'granted') {
      if (!alreadyBootstrapped) {
        localStorage.setItem(bootstrapKey, '1');
        setNotificationsEnabled(true);
      }
      setShowNotifPrompt(false);
      if (!alreadyBootstrapped || user.notificationsEnabled) {
        const tokenResult = await registerPushTokenWithFeedback(true);
        if (!tokenResult.ok) {
          setShowNotifPrompt(true);
        }
      }
      return;
    }

    if (!alreadyBootstrapped) {
      localStorage.setItem(bootstrapKey, '1');
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        setNotificationsEnabled(true);
        setShowNotifPrompt(false);
        const tokenResult = await registerPushTokenWithFeedback(true);
        if (!tokenResult.ok) {
          setShowNotifPrompt(true);
          return;
        }
        addNotification('Notifications Enabled', 'Medication reminders will now alert you on this device.', 'success');
        return;
      }
    }

    setShowNotifPrompt(!hiddenByUser);
  };

  useEffect(() => {
    if (!currentUser) return;
    void bootstrapNotifications();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || !user.notificationsEnabled) return;
    void registerPushTokenWithFeedback(false);
  }, [currentUser, user.notificationsEnabled]);

  useEffect(() => {
    if (!currentUser) return;
    let unsubscribe: (() => void) | undefined;

    const attach = async () => {
      unsubscribe = await listenForForegroundPush((payload) => {
        const title = payload.notification?.title || "Medication Reminder";
        const body = payload.notification?.body || "You have a due medication.";
        addNotification(title, body, 'reminder');
        playReminderSound(user.notificationSound);
      });
    };

    void attach();
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [currentUser, user.notificationSound]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const appearance = user.appearance || 'Light';
    const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const useDark = appearance === 'Dark' || (appearance === 'System' && systemDark);

    document.body.classList.toggle('theme-dark', useDark);
  }, [user.appearance]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const language = user.language || 'en';
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  }, [user.language]);

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

  const handleEnableNotificationsFromPrompt = async () => {
    if (!currentUser) return;
    const support = await getWebPushSupportStatus();
    setPushSupported(support.supported);
    setPushSupportReason(support.reason);

    if (!support.supported) {
      addNotification(
        "Push Setup Needed",
        pushSetupHint(support.reason),
        'warning'
      );
      return;
    }

    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      setNotificationsEnabled(true);
      setShowNotifPrompt(false);
      localStorage.removeItem(NOTIF_PROMPT_HIDE_KEY);
      localStorage.setItem(`${NOTIF_BOOTSTRAP_KEY}_${currentUser.uid}`, '1');
      const tokenResult = await registerPushTokenWithFeedback(true);
      if (!tokenResult.ok) {
        setShowNotifPrompt(true);
        return;
      }
      addNotification('Notifications Enabled', 'You will receive reminders even when the app is not open.', 'success');
      return;
    }

    setShowNotifPrompt(true);
    addNotification('Notifications Blocked', 'Allow notifications in browser settings to get reminders.', 'warning');
  };

  const handleHideNotificationPrompt = () => {
    setShowNotifPrompt(false);
    localStorage.setItem(NOTIF_PROMPT_HIDE_KEY, '1');
  };

  // --- Handlers ---

  const handleAddMedication = (med: Medication) => {
    const normalizedMed: Medication = {
      ...med,
      isActive: med.isActive !== false,
      cycleDays: med.cycleDays && med.cycleDays.length > 0 ? med.cycleDays : [0, 1, 2, 3, 4, 5, 6],
      stomachCondition: med.stomachCondition || 'Any'
    };

    const newMeds = [...medications, normalizedMed];
    setMedications(newMeds);
    syncDispenserConfig(newMeds);
    addNotification('Medication Added', `${normalizedMed.name} has been added to your schedule.`, 'success');
  };

  const handleUpdateMedication = (updatedMed: Medication) => {
    const normalizedMed: Medication = {
      ...updatedMed,
      isActive: updatedMed.isActive !== false,
      cycleDays: updatedMed.cycleDays && updatedMed.cycleDays.length > 0 ? updatedMed.cycleDays : [0, 1, 2, 3, 4, 5, 6],
      stomachCondition: updatedMed.stomachCondition || 'Any'
    };
    const newMeds = medications.map(m => m.id === normalizedMed.id ? normalizedMed : m);
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
        if (med.isActive === false) {
            addNotification("Medication Inactive", `${med.name} is currently inactive. Activate it in Medications page first.`, 'warning');
            return;
        }

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
    const minutes = user.snoozeDurationMinutes || 15;
    const snoozeUntil = Date.now() + minutes * 60 * 1000;
    setSnoozedMeds(prev => ({ ...prev, [medId]: snoozeUntil }));
    addNotification("Snoozed", `Reminder set for ${minutes} minutes from now.`, 'info');
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

  const handleUndoSkipped = (logId: string) => {
    const targetLog = logs.find(l => l.id === logId && l.status === 'Skipped');
    if (!targetLog) return;

    const newLogs = logs.filter(l => l.id !== logId);
    setLogs(newLogs);
    syncLogs(newLogs);

    addNotification("Skip Undone", `${targetLog.medicationName} is back to pending.`, 'info');
  };

  const handleUndoTaken = (logId: string) => {
    const targetLog = logs.find(l => l.id === logId && l.status === 'Taken');
    if (!targetLog) return;

    const newLogs = logs.filter(l => l.id !== logId);
    setLogs(newLogs);
    syncLogs(newLogs);

    const med = medications.find(m => m.id === targetLog.medicationId);
    if (med) {
      const newMeds = medications.map(m =>
        m.id === targetLog.medicationId
          ? { ...m, inventoryCount: Math.max(0, m.inventoryCount + 1) }
          : m
      );
      setMedications(newMeds);
      syncDispenserConfig(newMeds);
    }

    addNotification("Dose Undone", `${targetLog.medicationName} was restored to pending.`, 'info');
  };

  const handleTestReminderNotification = async () => {
    if (typeof Notification === 'undefined') {
      addNotification('Notifications Unavailable', 'This browser does not support notifications.', 'warning');
      return;
    }

    if (!user.notificationsEnabled || Notification.permission !== 'granted') {
      setShowNotifPrompt(true);
      addNotification('Enable Notifications', 'Allow notifications first to run a reminder test.', 'warning');
      return;
    }

    const title = 'PillCare Reminder Test';
    const message = 'Reminder channel is working. Scheduled medication alerts are ready.';

    addNotification(title, message, 'success');
    await sendBrowserNotification(title, message);
    playReminderSound(user.notificationSound);
  };

  const handleUpdateProfile = (updatedProfile: UserProfile) => {
      const normalized = normalizeUserProfile(updatedProfile);
      setUser(normalized);
      saveUserProfile(normalized);
      addNotification("Profile Updated", "Your changes have been saved successfully.", 'success');
  };

  const handleLogout = () => {
    loggingOutRef.current = true;
    auth.signOut();
  };

  const language = resolveLanguage(user.language);

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
      <Layout notifications={notifications} onClearNotifications={handleClearNotifications} language={language}>
        {showNotifPrompt && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-amber-900">{tr(language, 'Enable Reminders', 'تفعيل التذكيرات')}</p>
                <p className="mt-1 text-xs text-amber-800">
                  {tr(
                    language,
                    'Turn on notifications so medication reminders appear even when you leave the app.',
                    'فعّل الإشعارات ليظهر تنبيه الدواء حتى عند إغلاق التطبيق.'
                  )}
                </p>
                {pushSupported === false && (
                  <p className="mt-2 text-xs text-amber-800">
                    {pushSupportReason === 'missing-vapid-key'
                      ? tr(
                          language,
                          "Push is not configured yet for this deployment. Add VITE_FIREBASE_VAPID_KEY in your environment variables, then redeploy.",
                          "Push غير مهيأ بعد لهذا الإصدار. أضف VITE_FIREBASE_VAPID_KEY في متغيرات البيئة ثم أعد النشر."
                        )
                      : isIosDevice && !isStandaloneMode
                      ? tr(
                          language,
                          "On iPhone, open this site in Safari, tap Share, then Add to Home Screen. Open the installed app and allow notifications.",
                          "في iPhone افتح الموقع من Safari ثم مشاركة ثم إضافة إلى الشاشة الرئيسية، وبعدها افتح التطبيق واسمح بالإشعارات."
                        )
                      : tr(language, "This browser currently does not support web push for this app context.", "هذا المتصفح لا يدعم إشعارات الويب في هذا السياق.")}
                  </p>
                )}
              </div>
              <button
                onClick={handleHideNotificationPrompt}
                className="text-xs font-bold text-amber-700 hover:text-amber-900"
              >
                {tr(language, 'Not now', 'ليس الآن')}
              </button>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={handleEnableNotificationsFromPrompt}
                className="h-10 rounded-xl bg-amber-600 px-4 text-sm font-bold text-white hover:bg-amber-700"
              >
                {tr(language, 'Enable Notifications', 'تفعيل الإشعارات')}
              </button>
              <button
                onClick={() => void bootstrapNotifications()}
                className="h-10 rounded-xl border border-amber-300 px-4 text-sm font-bold text-amber-800 hover:bg-amber-100"
              >
                {tr(language, 'Recheck', 'إعادة الفحص')}
              </button>
            </div>
          </div>
        )}
        <Routes>
          <Route path="/" element={
            <Dashboard 
                medications={medications} 
                logs={logs} 
                onLogDose={handleLogDose} 
                onSnooze={handleSnooze}
                onDismiss={handleDismiss}
                onUndoTaken={handleUndoTaken}
                onUndoSkipped={handleUndoSkipped}
                onTestNotification={() => void handleTestReminderNotification()}
                userName={user.name}
                snoozedMeds={snoozedMeds}
                notificationsEnabled={Boolean(user.notificationsEnabled)}
                snoozeMinutes={user.snoozeDurationMinutes || 15}
                language={language}
            />
          } />
          <Route path="/medications" element={
            <Medications 
                medications={medications} 
                onAdd={handleAddMedication} 
                onUpdate={handleUpdateMedication}
                onDelete={handleDeleteMedication}
                language={language}
            />
          } />
          <Route path="/interactions" element={
            <Interactions 
                medications={medications} 
                userAllergies={user.allergies}
                userConditions={user.conditions}
                language={language}
                userId={currentUser?.uid}
            />
          } />
          <Route path="/history" element={<History logs={logs} />} />
          <Route path="/reports" element={<Reports logs={logs} medications={medications} language={language} />} />
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
