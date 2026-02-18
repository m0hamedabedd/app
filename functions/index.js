const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.database();

const REMINDER_WINDOW_MINUTES = 1;
const WEEKDAY_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

const toArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return Object.values(value);
};

const getNowParts = (timeZone) => {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(new Date());
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    const dateKey = `${map.year}-${map.month}-${map.day}`;
    const timeKey = `${map.hour}:${map.minute}`;
    const weekday = WEEKDAY_INDEX[map.weekday] ?? 0;
    return { dateKey, timeKey, weekday };
  } catch (err) {
    logger.warn(`Invalid timezone "${timeZone}", falling back to UTC`);
    return getNowParts("UTC");
  }
};

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const toTimeSortValue = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return Number.MAX_SAFE_INTEGER;
  return h * 60 + m;
};

const getDateKeyForTimezone = (isoTimestamp, timeZone) => {
  try {
    const dt = new Date(isoTimestamp);
    if (Number.isNaN(dt.getTime())) return null;

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(dt);

    const map = {};
    for (const p of parts) map[p.type] = p.value;
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return null;
  }
};

exports.sendMedicationReminders = onSchedule(
  {
    schedule: "* * * * *",
    timeZone: "UTC",
    region: "us-central1"
  },
  async () => {
    const usersSnap = await db.ref("users").get();
    const users = usersSnap.val() || {};
    const nowMs = Date.now();

    let totalSent = 0;
    let usersProcessed = 0;

    for (const [uid, userData] of Object.entries(users)) {
      const profile = userData.userProfile || {};
      if (!profile.notificationsEnabled) continue;

      const timezone = profile.timezone || "UTC";
      const { dateKey, timeKey, weekday } = getNowParts(timezone);
      const medications = toArray(userData.medications);
      const logs = toArray(userData.logs);
      const tokenRecords = userData.fcmTokens || {};

      const tokens = Object.values(tokenRecords)
        .map((row) => row && row.token)
        .filter(Boolean);

      if (!tokens.length) continue;

      const actionedCountByMed = {};
      for (const log of logs) {
        if (!log || !log.medicationId) continue;
        if (log.status !== "Taken" && log.status !== "Skipped") continue;

        const logDateKey = getDateKeyForTimezone(log.timestamp, timezone);
        if (logDateKey !== dateKey) continue;

        actionedCountByMed[log.medicationId] = (actionedCountByMed[log.medicationId] || 0) + 1;
      }

      const dueEntries = medications
        .map((med) => {
          if (!med || med.isActive === false || med.frequencyType !== "Daily") return null;

          const cycleDays = Array.isArray(med.cycleDays) ? med.cycleDays : [];
          if (cycleDays.length > 0 && !cycleDays.includes(weekday)) return null;

          const times = (Array.isArray(med.scheduledTimes) ? med.scheduledTimes : [])
            .filter((t) => typeof t === "string")
            .sort((a, b) => toTimeSortValue(a) - toTimeSortValue(b));

          if (!times.includes(timeKey)) return null;

          const actionedCount = actionedCountByMed[med.id] || 0;
          const dueSlotIndex = times.findIndex((t, idx) => t === timeKey && idx >= actionedCount);
          if (dueSlotIndex < 0) return null;

          return { med, dueSlotIndex };
        })
        .filter(Boolean);

      if (!dueEntries.length) continue;

      const dayLogRef = db.ref(`users/${uid}/pushReminderLog/${dateKey}`);
      const dayLogSnap = await dayLogRef.get();
      const dayLog = dayLogSnap.val() || {};

      for (const entry of dueEntries) {
        const med = entry.med;
        const reminderKey = `${med.id || med.name || "med"}_${timeKey}_${entry.dueSlotIndex}`;
        if (dayLog[reminderKey]) continue;

        const title = `Time for ${med.name || "your medication"}`;
        const body = `It's ${timeKey}. Take ${med.dosage || "your dose"} now.`;

        let sentForThisReminder = 0;
        for (const tokenBatch of chunk(tokens, 500)) {
          const response = await admin.messaging().sendEachForMulticast({
            tokens: tokenBatch,
            notification: {
              title,
              body
            },
            data: {
              type: "medication_reminder",
              medicationId: String(med.id || ""),
              medicationName: String(med.name || ""),
              scheduledTime: timeKey,
              userId: uid
            },
            webpush: {
              headers: {
                Urgency: "high",
                TTL: "120"
              },
              notification: {
                title,
                body,
                icon: "/icons/icon-192.svg",
                badge: "/icons/icon-192.svg",
                requireInteraction: true,
                tag: `pillcare_${uid}_${reminderKey}`,
                vibrate: [180, 120, 180]
              },
              fcmOptions: {
                link: "/#/"
              }
            }
          });

          sentForThisReminder += response.successCount;

          // Remove invalid tokens so future sends stay clean
          const invalidTokens = [];
          response.responses.forEach((r, idx) => {
            if (r.success) return;
            const code = r.error?.code || "";
            if (
              code.includes("registration-token-not-registered") ||
              code.includes("invalid-registration-token")
            ) {
              invalidTokens.push(tokenBatch[idx]);
            }
          });

          for (const badToken of invalidTokens) {
            const tokenKey = Buffer.from(badToken, "utf8")
              .toString("base64")
              .replace(/[./#[\]$+=]/g, "_");
            await db.ref(`users/${uid}/fcmTokens/${tokenKey}`).remove();
          }
        }

        if (sentForThisReminder > 0) {
          dayLog[reminderKey] = nowMs;
          totalSent += sentForThisReminder;
        }
      }

      await dayLogRef.update(dayLog);
      usersProcessed++;
    }

    await db.ref("_system/reminderHeartbeat").set({
      timestamp: nowMs,
      usersProcessed,
      totalSent
    });

    logger.info("Medication reminder run complete", {
      usersProcessed,
      totalSent,
      reminderWindowMinutes: REMINDER_WINDOW_MINUTES
    });
  }
);
