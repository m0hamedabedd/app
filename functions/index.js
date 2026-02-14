const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.database();

const REMINDER_WINDOW_MINUTES = 1;

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
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(new Date());
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    const dateKey = `${map.year}-${map.month}-${map.day}`;
    const timeKey = `${map.hour}:${map.minute}`;
    return { dateKey, timeKey };
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
      const { dateKey, timeKey } = getNowParts(timezone);
      const medications = toArray(userData.medications);
      const tokenRecords = userData.fcmTokens || {};

      const tokens = Object.values(tokenRecords)
        .map((row) => row && row.token)
        .filter(Boolean);

      if (!tokens.length) continue;

      const dueMeds = medications.filter((med) => {
        if (!med || med.frequencyType !== "Daily") return false;
        const times = Array.isArray(med.scheduledTimes) ? med.scheduledTimes : [];
        return times.includes(timeKey);
      });

      if (!dueMeds.length) continue;

      const dayLogRef = db.ref(`users/${uid}/pushReminderLog/${dateKey}`);
      const dayLogSnap = await dayLogRef.get();
      const dayLog = dayLogSnap.val() || {};

      for (const med of dueMeds) {
        const reminderKey = `${med.id || med.name || "med"}_${timeKey}`;
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

    logger.info("Medication reminder run complete", {
      usersProcessed,
      totalSent,
      reminderWindowMinutes: REMINDER_WINDOW_MINUTES
    });
  }
);
