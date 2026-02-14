import firebase from 'firebase/compat/app';
import 'firebase/compat/database';
import 'firebase/compat/auth';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getMessaging, getToken, isSupported, onMessage, MessagePayload } from 'firebase/messaging';
import { Medication, LogEntry, UserProfile } from "../types";

// Firebase configuration provided by the user
export const firebaseConfig = {
  apiKey: "AIzaSyBImg8pi8XAvvBNBL3_163DUFxYd-LqIbY",
  authDomain: "pillcaree-21f7b.firebaseapp.com",
  databaseURL: "https://pillcaree-21f7b-default-rtdb.firebaseio.com",
  projectId: "pillcaree-21f7b",
  storageBucket: "pillcaree-21f7b.firebasestorage.app",
  messagingSenderId: "649163877313",
  appId: "1:649163877313:web:f00ef64521c91ecff65d40",
  measurementId: "G-2JB29FMHNM"
};

// Initialize Firebase
const app = firebase.apps.length === 0 ? firebase.initializeApp(firebaseConfig) : firebase.app();
const db = app.database();
export const auth = app.auth();
const modularApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

const sanitizeForFirebase = (data: any) => {
  if (data === undefined) return null;
  return JSON.parse(JSON.stringify(data));
};

const toSafeKey = (input: string) =>
  btoa(unescape(encodeURIComponent(input))).replace(/[./#[\]$+=]/g, "_");

export const registerPushToken = async () => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  if (typeof window === 'undefined') return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
  if (!vapidKey) {
    console.warn("Missing VITE_FIREBASE_VAPID_KEY. Push token registration skipped.");
    return;
  }

  const supported = await isSupported().catch(() => false);
  if (!supported) return;

  const registration = await navigator.serviceWorker.ready;
  const messaging = getMessaging(modularApp);
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration
  });

  if (!token) return;

  const tokenKey = toSafeKey(token);
  const tokenRef = db.ref(`users/${uid}/fcmTokens/${tokenKey}`);
  await tokenRef.set(sanitizeForFirebase({
    token,
    updatedAt: Date.now(),
    platform: "web"
  }));
};

export const listenForForegroundPush = async (
  handler: (payload: MessagePayload) => void
) => {
  const supported = await isSupported().catch(() => false);
  if (!supported) return () => {};
  const messaging = getMessaging(modularApp);
  return onMessage(messaging, handler);
};

export const sendDispenseCommand = (slot: number, medName: string) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const commandRef = db.ref(`users/${uid}/dispense_command`);
  commandRef.set(sanitizeForFirebase({
    slot: slot,
    medication: medName,
    timestamp: Date.now(),
    action: "DISPENSE"
  })).catch((error: any) => {
    console.error("Firebase Error (Dispense):", error);
  });
};

export const syncDispenserConfig = (medications: Medication[]) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const fullListRef = db.ref(`users/${uid}/medications`);
  fullListRef.set(sanitizeForFirebase(medications)).catch(e => console.error("Firebase Error (Sync Meds):", e));

  const configRef = db.ref(`users/${uid}/dispenser_config`);
  const slotConfig: Record<string, any> = {
    updatedAt: Date.now()
  };

  medications.forEach(med => {
    if (med.slot) {
      slotConfig[`slot_${med.slot}`] = {
        id: med.id,
        name: med.name,
        dosage: med.dosage,
        frequency: med.frequency,
        times: med.scheduledTimes || []
      };
    }
  });

  configRef.set(sanitizeForFirebase(slotConfig)).catch(console.error);
};

export const syncLogs = (logs: LogEntry[]) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const logsRef = db.ref(`users/${uid}/logs`);
  logsRef.set(sanitizeForFirebase(logs)).catch(e => console.error("Firebase Error (Sync Logs):", e));
};

export const saveUserProfile = (profile: UserProfile) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const profileRef = db.ref(`users/${uid}/userProfile`);
  profileRef.set(sanitizeForFirebase(profile)).catch(e => console.error("Firebase Error (Save Profile):", e));
};

export const saveUserTimezone = (timezone: string) => {
  const uid = auth.currentUser?.uid;
  if (!uid || !timezone) return;

  const timezoneRef = db.ref(`users/${uid}/userProfile/timezone`);
  timezoneRef.set(timezone).catch(e => console.error("Firebase Error (Save Timezone):", e));
};

/**
 * Listen to database changes to keep app in sync across devices
 */
export const listenToData = (
  onMeds: (meds: Medication[]) => void, 
  onLogs: (logs: LogEntry[]) => void,
  onProfile: (profile: UserProfile) => void
) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return () => {};

  const medsRef = db.ref(`users/${uid}/medications`);
  const logsRef = db.ref(`users/${uid}/logs`);
  const profileRef = db.ref(`users/${uid}/userProfile`);

  const medsListener = medsRef.on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
      // Firebase returns objects for arrays sometimes if keys are indices, handle conversion
      const medsArray = Array.isArray(data) ? data : Object.values(data);
      onMeds(medsArray as Medication[]);
    } else {
      onMeds([]);
    }
  });

  const logsListener = logsRef.on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
      const logsArray = Array.isArray(data) ? data : Object.values(data);
      // Sort logs by timestamp desc
      logsArray.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      onLogs(logsArray as LogEntry[]);
    } else {
      onLogs([]);
    }
  });

  const profileListener = profileRef.on('value', (snapshot) => {
      const data = snapshot.val();
      if (data) {
          // Ensure arrays exist if empty in DB
          if (!data.conditions) data.conditions = [];
          if (!data.allergies) data.allergies = [];
          onProfile(data as UserProfile);
      }
  });

  return () => {
    medsRef.off('value', medsListener);
    logsRef.off('value', logsListener);
    profileRef.off('value', profileListener);
  };
};
