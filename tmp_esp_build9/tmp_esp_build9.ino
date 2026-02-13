/*
  PillCare ESP32 Firmware (App-Controlled)
  - Reads dispense commands written by your app to:
      users/<uid>/dispense_command
  - Drives slot motors for slot 1..3
  - Publishes status to:
      users/<uid>/device_status

  Required libraries:
  - None beyond standard ESP32 core libraries
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <time.h>
#include <math.h>
#if __has_include(<TFT_eSPI.h>)
#include <TFT_eSPI.h>
#define HAS_TFT 1
#else
#define HAS_TFT 0
#endif

// ---------------------------------------------------------------------------
// 1) USER CONFIG
// ---------------------------------------------------------------------------
const char* ssid = "Orange-hC9Z";
const char* password = "tZSCUFu6";

// From your app's firebase.ts
const char* FIREBASE_API_KEY = "AIzaSyBImg8pi8XAvvBNBL3_163DUFxYd-LqIbY";
const char* FIREBASE_DB_HOST = "pillcaree-21f7b-default-rtdb.firebaseio.com";

// Use the SAME Firebase account as the app user you want this ESP to follow.
const char* FIREBASE_EMAIL = "m0hamedabedd52@gmail.com";
const char* FIREBASE_PASSWORD = "01001085006";

// Optional metadata pushed to /device_status
const char* DEVICE_NAME = "pillcare-esp32";
const char* FIRMWARE_VERSION = "2.1.0";

// ---------------------------------------------------------------------------
// 2) HARDWARE CONFIG (Stepper-based 3-slot dispenser)
// ---------------------------------------------------------------------------
const int SLOT_COUNT = 3;
const int MAX_TIMES_PER_SLOT = 8;
const int STEPS_PER_REVOLUTION = 2048;  // 28BYJ-48

const int MOTOR_PINS[SLOT_COUNT][4] = {
  {32, 25, 33, 26},
  {27, 12, 14, 13},
  {21, 17, 19, 16}
};

const int MOTOR_SEQUENCE[4][4] = {
  {1, 0, 1, 0},
  {0, 1, 1, 0},
  {0, 1, 0, 1},
  {1, 0, 0, 1}
};

// Set per-slot direction (1 or -1) and turns per command
int SLOT_DIRECTION[SLOT_COUNT] = {1, 1, 1};
float SLOT_TURNS_PER_COMMAND[SLOT_COUNT] = {1.0f, 1.0f, 1.0f};
int SLOT_SPEED_RPM[SLOT_COUNT] = {12, 12, 12};
int gMotorStepIndex[SLOT_COUNT] = {0, 0, 0};

// ---------------------------------------------------------------------------
// 3) TIMING
// ---------------------------------------------------------------------------
const unsigned long WIFI_RETRY_MS = 5000;
const unsigned long COMMAND_POLL_MS = 1200;
const unsigned long HEARTBEAT_MS = 15000;
const unsigned long CONFIG_POLL_MS = 15000;
const unsigned long SCHEDULE_TICK_MS = 1000;
const unsigned long LCD_REFRESH_MS = 1000;
const int DISPENSE_WINDOW_MINUTES = 15;

const char* NTP_SERVER = "pool.ntp.org";
const long GMT_OFFSET_SEC = 7200;      // Egypt base timezone
const int DAYLIGHT_OFFSET_SEC = 3600;  // Egypt DST when active

// ---------------------------------------------------------------------------
// 4) STATE
// ---------------------------------------------------------------------------
Preferences prefs;

String gIdToken = "";
String gUserUid = "";
unsigned long gTokenExpiryAtMs = 0;

uint64_t gLastHandledTimestamp = 0;

unsigned long gLastWifiAttemptMs = 0;
unsigned long gLastPollMs = 0;
unsigned long gLastHeartbeatMs = 0;
unsigned long gLastConfigPollMs = 0;
unsigned long gLastScheduleTickMs = 0;
unsigned long gLastLcdRefreshMs = 0;
String gSerialBuffer = "";
bool gDispenseInProgress = false;
String gLastDispenseLabel = "";

struct SlotSchedule {
  bool active = false;
  String name = "";
  float turns = 1.0f;
  int timesCount = 0;
  String times[MAX_TIMES_PER_SLOT];
  int lastDispensedYDay[MAX_TIMES_PER_SLOT];
};
SlotSchedule gSchedules[SLOT_COUNT];

#if HAS_TFT
TFT_eSPI tft = TFT_eSPI();
#define TFT_BL 15
#endif

struct DispenseCommand {
  int slot = 0;
  String medication = "";
  uint64_t timestamp = 0;
  String action = "";
};

enum CommandFetchResult {
  COMMAND_ERROR = 0,
  COMMAND_NONE = 1,
  COMMAND_OK = 2
};

bool dispenseSlot(int slotIndex);

// ---------------------------------------------------------------------------
// 5) HELPERS
// ---------------------------------------------------------------------------
String jsonEscape(const String& in) {
  String out;
  out.reserve(in.length() + 8);
  for (size_t i = 0; i < in.length(); i++) {
    char c = in[i];
    if (c == '\\') out += "\\\\";
    else if (c == '"') out += "\\\"";
    else if (c == '\n') out += "\\n";
    else if (c == '\r') out += "\\r";
    else if (c == '\t') out += "\\t";
    else out += c;
  }
  return out;
}

String extractJsonString(const String& json, const String& key) {
  const String token = "\"" + key + "\"";
  int keyPos = json.indexOf(token);
  if (keyPos < 0) return "";
  int colonPos = json.indexOf(':', keyPos + token.length());
  if (colonPos < 0) return "";

  int firstQuote = json.indexOf('"', colonPos + 1);
  if (firstQuote < 0) return "";
  int secondQuote = firstQuote + 1;
  while (secondQuote < (int)json.length()) {
    if (json[secondQuote] == '"' && json[secondQuote - 1] != '\\') break;
    secondQuote++;
  }
  if (secondQuote >= (int)json.length()) return "";

  String value = json.substring(firstQuote + 1, secondQuote);
  value.replace("\\\"", "\"");
  value.replace("\\\\", "\\");
  value.replace("\\n", "\n");
  value.replace("\\r", "\r");
  value.replace("\\t", "\t");
  return value;
}

uint64_t extractJsonUint64(const String& json, const String& key) {
  const String token = "\"" + key + "\"";
  int keyPos = json.indexOf(token);
  if (keyPos < 0) return 0;
  int colonPos = json.indexOf(':', keyPos + token.length());
  if (colonPos < 0) return 0;

  int i = colonPos + 1;
  while (i < (int)json.length() && (json[i] == ' ' || json[i] == '\t' || json[i] == '"' )) i++;

  String number;
  while (i < (int)json.length()) {
    char c = json[i];
    if (c >= '0' && c <= '9') number += c;
    else break;
    i++;
  }

  if (number.length() == 0) return 0;
#if defined(ESP32)
  return strtoull(number.c_str(), nullptr, 10);
#else
  return static_cast<uint64_t>(number.toInt());
#endif
}

String extractJsonBlock(const String& json, const String& key, char openChar, char closeChar) {
  const String token = "\"" + key + "\"";
  int keyPos = json.indexOf(token);
  if (keyPos < 0) return "";

  int colonPos = json.indexOf(':', keyPos + token.length());
  if (colonPos < 0) return "";

  int blockStart = json.indexOf(openChar, colonPos + 1);
  if (blockStart < 0) return "";

  int depth = 0;
  bool inString = false;
  for (int i = blockStart; i < (int)json.length(); i++) {
    char c = json[i];
    char prev = i > 0 ? json[i - 1] : '\0';
    if (c == '"' && prev != '\\') inString = !inString;
    if (inString) continue;
    if (c == openChar) depth++;
    if (c == closeChar) {
      depth--;
      if (depth == 0) return json.substring(blockStart, i + 1);
    }
  }
  return "";
}

String extractJsonObject(const String& json, const String& key) {
  return extractJsonBlock(json, key, '{', '}');
}

String extractJsonArray(const String& json, const String& key) {
  return extractJsonBlock(json, key, '[', ']');
}

float extractFirstPositiveFloat(const String& text) {
  String number = "";
  bool seenDigit = false;
  bool seenDot = false;

  for (int i = 0; i < (int)text.length(); i++) {
    char c = text[i];
    if (c >= '0' && c <= '9') {
      number += c;
      seenDigit = true;
      continue;
    }
    if (c == '.' && !seenDot) {
      number += c;
      seenDot = true;
      continue;
    }
    if (seenDigit) break;
    if (seenDot && !seenDigit) {
      number = "";
      seenDot = false;
    }
  }

  float v = number.toFloat();
  if (v <= 0.0f) v = 1.0f;
  return v;
}

int parseTimesArray(const String& arrayJson, String outTimes[], int maxCount) {
  if (arrayJson.length() < 2) return 0;
  int count = 0;
  int i = 0;
  while (i < (int)arrayJson.length() && count < maxCount) {
    int q1 = arrayJson.indexOf('"', i);
    if (q1 < 0) break;
    int q2 = q1 + 1;
    while (q2 < (int)arrayJson.length()) {
      if (arrayJson[q2] == '"' && arrayJson[q2 - 1] != '\\') break;
      q2++;
    }
    if (q2 >= (int)arrayJson.length()) break;
    String v = arrayJson.substring(q1 + 1, q2);
    if (v.length() == 5 && v[2] == ':') {
      outTimes[count++] = v;
    }
    i = q2 + 1;
  }
  return count;
}

bool getLocalTimeSafe(struct tm& outTm) {
  return getLocalTime(&outTm);
}

void formatCountdown(int totalSeconds, char* outBuf, size_t outBufSize) {
  if (totalSeconds < 0) totalSeconds = 0;
  int h = totalSeconds / 3600;
  int m = (totalSeconds % 3600) / 60;
  int s = totalSeconds % 60;
  snprintf(outBuf, outBufSize, "%02d:%02d:%02d", h, m, s);
}

#if HAS_TFT
void lcdInit() {
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH);
  tft.init();
  tft.setRotation(1);
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
}

void lcdShowBoot(const String& msg) {
  tft.fillScreen(TFT_BLACK);
  tft.setTextDatum(MC_DATUM);
  tft.drawString("PillCare", tft.width() / 2, 36, 4);
  tft.drawString(msg, tft.width() / 2, tft.height() / 2, 2);
}

void lcdShowDispensing(int slot, const String& name) {
  tft.fillScreen(TFT_BLACK);
  tft.setTextDatum(MC_DATUM);
  tft.setTextColor(TFT_ORANGE, TFT_BLACK);
  tft.drawString("DISPENSING", tft.width() / 2, 44, 4);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.drawString("Slot " + String(slot), tft.width() / 2, 102, 4);
  tft.drawString(name.length() > 0 ? name : "Medication", tft.width() / 2, 150, 2);
}
#else
void lcdInit() {}
void lcdShowBoot(const String&) {}
void lcdShowDispensing(int, const String&) {}
#endif

uint64_t epochMs() {
  time_t now = time(nullptr);
  if (now <= 100000) return 0;
  return static_cast<uint64_t>(now) * 1000ULL;
}

void stopMotorCoils() {
  for (int i = 0; i < SLOT_COUNT; i++) {
    for (int j = 0; j < 4; j++) {
      digitalWrite(MOTOR_PINS[i][j], LOW);
    }
  }
}

void applyMotorStep(int slotIndex, int sequenceIndex) {
  for (int pinIdx = 0; pinIdx < 4; pinIdx++) {
    digitalWrite(MOTOR_PINS[slotIndex][pinIdx], MOTOR_SEQUENCE[sequenceIndex][pinIdx] ? HIGH : LOW);
  }
}

void moveMotorSteps(int slotIndex, int steps, int rpm) {
  if (slotIndex < 0 || slotIndex >= SLOT_COUNT) return;
  if (steps == 0) return;
  if (rpm < 1) rpm = 1;

  int direction = steps > 0 ? 1 : -1;
  int totalSteps = steps > 0 ? steps : -steps;
  unsigned long stepDelayUs = (60UL * 1000000UL) / (static_cast<unsigned long>(STEPS_PER_REVOLUTION) * static_cast<unsigned long>(rpm));
  if (stepDelayUs < 800) stepDelayUs = 800;

  for (int i = 0; i < totalSteps; i++) {
    gMotorStepIndex[slotIndex] = (gMotorStepIndex[slotIndex] + (direction > 0 ? 1 : 3)) % 4;
    applyMotorStep(slotIndex, gMotorStepIndex[slotIndex]);
    delayMicroseconds(stepDelayUs);
    if ((i % 128) == 0) yield();
  }
}

void connectWiFiIfNeeded() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - gLastWifiAttemptMs < WIFI_RETRY_MS) return;

  gLastWifiAttemptMs = millis();
  Serial.printf("[WIFI] Connecting to %s\n", ssid);
  WiFi.begin(ssid, password);
}

bool isTokenValid() {
  if (gIdToken.length() == 0) return false;
  if (millis() + 60000 >= gTokenExpiryAtMs) return false;
  return true;
}

bool httpRequest(
  const String& method,
  const String& url,
  const String& payload,
  int& statusCode,
  String& responseBody
) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  if (!http.begin(client, url.c_str())) {
    Serial.println("[HTTP] begin() failed");
    return false;
  }

  if (payload.length() > 0) {
    http.addHeader("Content-Type", "application/json");
  }

  if (method == "GET") {
    statusCode = http.GET();
  } else if (method == "POST") {
    statusCode = http.POST(payload);
  } else if (method == "PUT") {
    statusCode = http.PUT(payload);
  } else if (method == "PATCH") {
    statusCode = http.sendRequest("PATCH", payload);
  } else if (method == "DELETE") {
    statusCode = http.sendRequest("DELETE");
  } else {
    Serial.printf("[HTTP] Unsupported method: %s\n", method.c_str());
    http.end();
    return false;
  }

  if (statusCode > 0) {
    responseBody = http.getString();
  } else {
    responseBody = "";
  }

  http.end();
  return statusCode > 0;
}

bool firebaseSignIn() {
  const String url =
    String("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=") +
    FIREBASE_API_KEY;

  String payload = "{\"email\":\"" + jsonEscape(String(FIREBASE_EMAIL)) +
                   "\",\"password\":\"" + jsonEscape(String(FIREBASE_PASSWORD)) +
                   "\",\"returnSecureToken\":true}";

  int code = 0;
  String body;
  if (!httpRequest("POST", url, payload, code, body)) {
    Serial.println("[AUTH] Request failed");
    return false;
  }

  if (code != 200) {
    Serial.printf("[AUTH] Failed code=%d body=%s\n", code, body.c_str());
    return false;
  }

  gIdToken = extractJsonString(body, "idToken");
  gUserUid = extractJsonString(body, "localId");
  int expiresInSec = extractJsonString(body, "expiresIn").toInt();
  if (expiresInSec <= 0) {
    expiresInSec = static_cast<int>(extractJsonUint64(body, "expiresIn"));
  }
  if (expiresInSec < 120) expiresInSec = 120;
  gTokenExpiryAtMs = millis() + static_cast<unsigned long>(expiresInSec - 60) * 1000UL;

  if (gIdToken.length() == 0 || gUserUid.length() == 0) {
    Serial.println("[AUTH] Missing token or uid in response");
    return false;
  }

  Serial.printf("[AUTH] Signed in. uid=%s\n", gUserUid.c_str());
  return true;
}

bool ensureFirebaseAuth() {
  if (isTokenValid()) return true;
  return firebaseSignIn();
}

String firebaseDbUrl(const String& pathWithoutJson) {
  return String("https://") + FIREBASE_DB_HOST + "/" + pathWithoutJson + ".json?auth=" + gIdToken;
}

bool firebaseRequest(
  const String& method,
  const String& dbPath,
  const String& payload,
  int& statusCode,
  String& responseBody
) {
  if (!ensureFirebaseAuth()) return false;

  const String url = firebaseDbUrl(dbPath);
  if (!httpRequest(method, url, payload, statusCode, responseBody)) return false;

  if (statusCode == 401 || statusCode == 403) {
    gIdToken = "";
  }

  return true;
}

bool firebasePatch(const String& dbPath, const String& payload) {
  int code = 0;
  String body;
  if (!firebaseRequest("PATCH", dbPath, payload, code, body)) return false;

  if (code < 200 || code >= 300) {
    Serial.printf("[DB] PATCH %s failed code=%d body=%s\n", dbPath.c_str(), code, body.c_str());
    return false;
  }

  return true;
}

void publishHeartbeat() {
  if (gUserUid.length() == 0) return;

  String payload = "{";
  payload += "\"online\":true,";
  payload += "\"lastSeen\":" + String(epochMs()) + ",";
  payload += "\"ip\":\"" + jsonEscape(WiFi.localIP().toString()) + "\",";
  payload += "\"deviceName\":\"" + jsonEscape(String(DEVICE_NAME)) + "\",";
  payload += "\"firmware\":\"" + jsonEscape(String(FIRMWARE_VERSION)) + "\"";
  payload += "}";
  firebasePatch("users/" + gUserUid + "/device_status", payload);
}

void publishDispenseResult(const DispenseCommand& cmd, bool ok, const String& message) {
  if (gUserUid.length() == 0) return;

  String payload = "{";
  payload += "\"online\":true,";
  payload += "\"lastSeen\":" + String(epochMs()) + ",";
  payload += "\"last_dispense\":{";
  payload += "\"slot\":" + String(cmd.slot) + ",";
  payload += "\"medication\":\"" + jsonEscape(cmd.medication) + "\",";
  payload += "\"commandTimestamp\":" + String(cmd.timestamp) + ",";
  payload += "\"processedAt\":" + String(epochMs()) + ",";
  payload += "\"status\":\"" + String(ok ? "ok" : "error") + "\",";
  payload += "\"message\":\"" + jsonEscape(message) + "\"";
  payload += "}}";
  firebasePatch("users/" + gUserUid + "/device_status", payload);
}

void clearSchedules() {
  for (int i = 0; i < SLOT_COUNT; i++) {
    gSchedules[i].active = false;
    gSchedules[i].name = "";
    gSchedules[i].turns = 1.0f;
    gSchedules[i].timesCount = 0;
    for (int j = 0; j < MAX_TIMES_PER_SLOT; j++) {
      gSchedules[i].times[j] = "";
      gSchedules[i].lastDispensedYDay[j] = -1;
    }
  }
}

void parseSlotScheduleFromObject(const String& objJson, int slotIndex) {
  if (slotIndex < 0 || slotIndex >= SLOT_COUNT) return;
  SlotSchedule& s = gSchedules[slotIndex];

  s.active = true;
  s.name = extractJsonString(objJson, "name");
  s.turns = extractFirstPositiveFloat(extractJsonString(objJson, "dosage"));

  String timesArray = extractJsonArray(objJson, "times");
  s.timesCount = parseTimesArray(timesArray, s.times, MAX_TIMES_PER_SLOT);
}

bool fetchDispenserConfig() {
  if (gUserUid.length() == 0) return false;

  int code = 0;
  String body;
  const String path = "users/" + gUserUid + "/dispenser_config";
  if (!firebaseRequest("GET", path, "", code, body)) return false;
  if (code < 200 || code >= 300) return false;

  body.trim();
  if (body == "null" || body.length() == 0) {
    clearSchedules();
    return true;
  }

  clearSchedules();
  for (int slot = 1; slot <= SLOT_COUNT; slot++) {
    String key = "slot_" + String(slot);
    String obj = extractJsonObject(body, key);
    if (obj.length() > 0) {
      parseSlotScheduleFromObject(obj, slot - 1);
      SLOT_TURNS_PER_COMMAND[slot - 1] = gSchedules[slot - 1].turns;
    }
  }
  return true;
}

bool parseHHMM(const String& hhmm, int& hh, int& mm) {
  if (hhmm.length() != 5 || hhmm[2] != ':') return false;
  hh = hhmm.substring(0, 2).toInt();
  mm = hhmm.substring(3, 5).toInt();
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return false;
  return true;
}

int circularMinuteDiff(int a, int b) {
  int diff = abs(a - b);
  if (diff > 720) diff = 1440 - diff;
  return diff;
}

bool isWithinDispenseWindow(int slotIndex, int windowMinutes, String& nearestTimeOut, int& nearestDiffOut) {
  nearestTimeOut = "--:--";
  nearestDiffOut = 9999;

  if (slotIndex < 0 || slotIndex >= SLOT_COUNT) return false;
  SlotSchedule& s = gSchedules[slotIndex];
  if (!s.active || s.timesCount <= 0) return true;

  struct tm nowTm;
  if (!getLocalTimeSafe(nowTm)) return false;

  int nowMinutes = nowTm.tm_hour * 60 + nowTm.tm_min;
  bool within = false;

  for (int i = 0; i < s.timesCount; i++) {
    int h = 0, m = 0;
    if (!parseHHMM(s.times[i], h, m)) continue;
    int targetMinutes = h * 60 + m;
    int diff = circularMinuteDiff(nowMinutes, targetMinutes);
    if (diff < nearestDiffOut) {
      nearestDiffOut = diff;
      nearestTimeOut = s.times[i];
    }
    if (diff <= windowMinutes) within = true;
  }

  return within;
}

int secondsUntilDailyTime(const struct tm& nowTm, int targetH, int targetM) {
  int nowSec = nowTm.tm_hour * 3600 + nowTm.tm_min * 60 + nowTm.tm_sec;
  int targetSec = targetH * 3600 + targetM * 60;
  int delta = targetSec - nowSec;
  if (delta < 0) delta += 24 * 3600;
  return delta;
}

void getNextDispenseInfo(int& outSlot, String& outName, String& outTime, int& outSeconds) {
  outSlot = -1;
  outName = "";
  outTime = "--:--";
  outSeconds = -1;

  struct tm nowTm;
  if (!getLocalTimeSafe(nowTm)) return;

  for (int slotIndex = 0; slotIndex < SLOT_COUNT; slotIndex++) {
    SlotSchedule& s = gSchedules[slotIndex];
    if (!s.active || s.timesCount <= 0) continue;
    for (int i = 0; i < s.timesCount; i++) {
      int h = 0, m = 0;
      if (!parseHHMM(s.times[i], h, m)) continue;
      int sec = secondsUntilDailyTime(nowTm, h, m);
      if (outSeconds < 0 || sec < outSeconds) {
        outSeconds = sec;
        outSlot = slotIndex + 1;
        outName = s.name;
        outTime = s.times[i];
      }
    }
  }
}

#if HAS_TFT
void lcdShowCountdown() {
  tft.fillScreen(TFT_BLACK);
  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.drawString("PillCare", 10, 8, 4);

  struct tm nowTm;
  char nowBuf[16] = "--:--:--";
  if (getLocalTimeSafe(nowTm)) {
    snprintf(nowBuf, sizeof(nowBuf), "%02d:%02d:%02d", nowTm.tm_hour, nowTm.tm_min, nowTm.tm_sec);
  }
  tft.drawString("Now: " + String(nowBuf), 10, 52, 2);

  int nextSlot = -1;
  String nextName;
  String nextTime;
  int nextSec = -1;
  getNextDispenseInfo(nextSlot, nextName, nextTime, nextSec);

  if (nextSlot < 0) {
    tft.drawString("No scheduled slots", 10, 94, 2);
    tft.drawString("Use app to set slot times", 10, 124, 2);
    return;
  }

  tft.drawString("Next: Slot " + String(nextSlot), 10, 94, 4);
  tft.drawString(nextName.length() > 0 ? nextName : "Medication", 10, 142, 2);
  tft.drawString("At: " + nextTime, 10, 170, 2);

  char cdBuf[16] = "00:00:00";
  formatCountdown(nextSec, cdBuf, sizeof(cdBuf));
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.drawString("Countdown: " + String(cdBuf), 10, 204, 2);
}
#else
void lcdShowCountdown() {}
#endif

void processScheduledDispense() {
  if (gDispenseInProgress) return;

  struct tm nowTm;
  if (!getLocalTimeSafe(nowTm)) return;

  char hhmm[6];
  snprintf(hhmm, sizeof(hhmm), "%02d:%02d", nowTm.tm_hour, nowTm.tm_min);
  const String nowTime = String(hhmm);

  for (int slotIndex = 0; slotIndex < SLOT_COUNT; slotIndex++) {
    SlotSchedule& s = gSchedules[slotIndex];
    if (!s.active || s.timesCount <= 0) continue;

    for (int i = 0; i < s.timesCount; i++) {
      if (s.times[i] != nowTime) continue;
      if (s.lastDispensedYDay[i] == nowTm.tm_yday) continue;

      s.lastDispensedYDay[i] = nowTm.tm_yday;
      Serial.printf("[SCHED] Auto-dispense slot %d at %s\n", slotIndex + 1, nowTime.c_str());
      dispenseSlot(slotIndex);
      return;
    }
  }
}

bool dispenseSlot(int slotIndex) {
  if (slotIndex < 0 || slotIndex >= SLOT_COUNT) return false;
  if (gDispenseInProgress) return false;

  gDispenseInProgress = true;

  float turns = SLOT_TURNS_PER_COMMAND[slotIndex];
  if (turns <= 0.0f) turns = 1.0f;
  const int dir = SLOT_DIRECTION[slotIndex] >= 0 ? 1 : -1;
  int rpm = SLOT_SPEED_RPM[slotIndex];
  if (rpm < 1) rpm = 1;
  int totalSteps = static_cast<int>(lroundf(turns * static_cast<float>(STEPS_PER_REVOLUTION)));
  if (totalSteps < 1) totalSteps = 1;
  String medName = gSchedules[slotIndex].name;
  if (medName.length() == 0) medName = "Slot " + String(slotIndex + 1);
  gLastDispenseLabel = medName;

  lcdShowDispensing(slotIndex + 1, medName);

  Serial.printf("[MOTOR] Slot %d, turns=%.2f, steps=%d, dir=%d, rpm=%d\n", slotIndex + 1, turns, totalSteps, dir, rpm);
  moveMotorSteps(slotIndex, dir * totalSteps, rpm);
  delay(250);
  yield();

  stopMotorCoils();
  gDispenseInProgress = false;
  lcdShowCountdown();
  return true;
}

CommandFetchResult fetchDispenseCommand(DispenseCommand& cmdOut) {
  if (gUserUid.length() == 0) return COMMAND_ERROR;

  int code = 0;
  String body;
  const String path = "users/" + gUserUid + "/dispense_command";

  if (!firebaseRequest("GET", path, "", code, body)) return COMMAND_ERROR;

  if (code < 200 || code >= 300) {
    Serial.printf("[DB] GET command failed code=%d body=%s\n", code, body.c_str());
    return COMMAND_ERROR;
  }

  body.trim();
  if (body == "null" || body.length() == 0) return COMMAND_NONE;

  cmdOut.slot = static_cast<int>(extractJsonUint64(body, "slot"));
  cmdOut.medication = extractJsonString(body, "medication");
  cmdOut.timestamp = extractJsonUint64(body, "timestamp");
  cmdOut.action = extractJsonString(body, "action");

  return COMMAND_OK;
}

void processDispenseCommand() {
  DispenseCommand cmd;
  CommandFetchResult result = fetchDispenseCommand(cmd);
  if (result != COMMAND_OK) return;

  if (cmd.timestamp == 0) return;
  if (cmd.timestamp <= gLastHandledTimestamp) return;

  gLastHandledTimestamp = cmd.timestamp;
  prefs.putString("last_cmd_ts", String(gLastHandledTimestamp));

  if (cmd.action != "DISPENSE") {
    publishDispenseResult(cmd, false, "Ignored: unsupported action");
    return;
  }

  if (cmd.slot < 1 || cmd.slot > SLOT_COUNT) {
    publishDispenseResult(cmd, false, "Ignored: invalid slot");
    return;
  }

  String nearestTime;
  int nearestDiff = 9999;
  bool windowOk = isWithinDispenseWindow(cmd.slot - 1, DISPENSE_WINDOW_MINUTES, nearestTime, nearestDiff);
  if (!windowOk) {
    String msg = "Outside +-15m window";
    if (nearestDiff < 9999) {
      msg += " (nearest " + nearestTime + ", diff " + String(nearestDiff) + "m)";
    }
    publishDispenseResult(cmd, false, msg);
    return;
  }

  bool ok = dispenseSlot(cmd.slot - 1);
  publishDispenseResult(cmd, ok, ok ? "Dispensed successfully" : "Motor failed");
}

void printStatus() {
  Serial.println("----- STATUS -----");
  Serial.printf("WiFi: %s\n", WiFi.status() == WL_CONNECTED ? "CONNECTED" : "DISCONNECTED");
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("IP: %s\n", WiFi.localIP().toString().c_str());
  }
  Serial.printf("Auth token: %s\n", gIdToken.length() > 0 ? "YES" : "NO");
  Serial.printf("UID: %s\n", gUserUid.c_str());
  Serial.printf("Last cmd ts: %llu\n", gLastHandledTimestamp);
  Serial.println("------------------");
}

void printSchedules() {
  Serial.println("----- SCHEDULES -----");
  for (int i = 0; i < SLOT_COUNT; i++) {
    const SlotSchedule& s = gSchedules[i];
    Serial.printf("Slot %d: active=%s turns=%.2f name=%s\n", i + 1, s.active ? "yes" : "no", s.turns, s.name.c_str());
    for (int t = 0; t < s.timesCount; t++) {
      Serial.printf("  - %s (last yday=%d)\n", s.times[t].c_str(), s.lastDispensedYDay[t]);
    }
  }
  Serial.println("---------------------");
}

void handleSerialCommand(const String& rawCmd) {
  String cmd = rawCmd;
  cmd.trim();
  cmd.toUpperCase();
  if (cmd.length() == 0) return;

  if (cmd == "HELP") {
    Serial.println("Commands: HELP, STATUS, SHOWCFG, TEST1, TEST2, TEST3, RESETCMD");
    return;
  }

  if (cmd == "STATUS") {
    printStatus();
    return;
  }

  if (cmd == "SHOWCFG") {
    printSchedules();
    return;
  }

  if (cmd == "TEST1" || cmd == "TEST2" || cmd == "TEST3") {
    int slot = cmd.substring(4).toInt(); // "TEST1" -> 1
    if (slot >= 1 && slot <= SLOT_COUNT) {
      Serial.printf("[TEST] Dispensing slot %d\n", slot);
      bool ok = dispenseSlot(slot - 1);
      Serial.printf("[TEST] Result: %s\n", ok ? "OK" : "FAIL");
    } else {
      Serial.println("[TEST] Invalid slot");
    }
    return;
  }

  if (cmd == "RESETCMD") {
    gLastHandledTimestamp = 0;
    prefs.putString("last_cmd_ts", "0");
    Serial.println("[STATE] last_cmd_ts reset to 0");
    return;
  }

  Serial.printf("[SERIAL] Unknown command: %s\n", cmd.c_str());
}

void handleSerialInput() {
  while (Serial.available() > 0) {
    char c = static_cast<char>(Serial.read());
    if (c == '\n' || c == '\r') {
      if (gSerialBuffer.length() > 0) {
        handleSerialCommand(gSerialBuffer);
        gSerialBuffer = "";
      }
    } else {
      if (gSerialBuffer.length() < 120) gSerialBuffer += c;
    }
  }
}

void setupMotors() {
  for (int i = 0; i < SLOT_COUNT; i++) {
    for (int j = 0; j < 4; j++) {
      pinMode(MOTOR_PINS[i][j], OUTPUT);
      digitalWrite(MOTOR_PINS[i][j], LOW);
    }
  }
}

// ---------------------------------------------------------------------------
// 6) ARDUINO SETUP / LOOP
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.println("\n[PILLCARE] Booting...");
  Serial.println("[PILLCARE] Type HELP in Serial Monitor for test commands.");

  clearSchedules();
  setupMotors();
  lcdInit();
  lcdShowBoot("Booting...");

  prefs.begin("pillcare", false);
  String lastTsStr = prefs.getString("last_cmd_ts", "0");
  gLastHandledTimestamp = extractJsonUint64("{\"v\":" + lastTsStr + "}", "v");
  Serial.printf("[STATE] last_cmd_ts=%llu\n", gLastHandledTimestamp);

  WiFi.mode(WIFI_STA);
  connectWiFiIfNeeded();

  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
}

void loop() {
  handleSerialInput();

  connectWiFiIfNeeded();
  if (WiFi.status() != WL_CONNECTED) {
    lcdShowBoot("Connecting WiFi...");
    delay(150);
    return;
  }

  if (!ensureFirebaseAuth()) {
    lcdShowBoot("Firebase auth...");
    delay(500);
    return;
  }

  const unsigned long nowMs = millis();

  if (nowMs - gLastPollMs >= COMMAND_POLL_MS) {
    gLastPollMs = nowMs;
    processDispenseCommand();
  }

  if (nowMs - gLastHeartbeatMs >= HEARTBEAT_MS) {
    gLastHeartbeatMs = nowMs;
    publishHeartbeat();
  }

  if (gLastConfigPollMs == 0 || nowMs - gLastConfigPollMs >= CONFIG_POLL_MS) {
    gLastConfigPollMs = nowMs;
    fetchDispenserConfig();
  }

  if (nowMs - gLastScheduleTickMs >= SCHEDULE_TICK_MS) {
    gLastScheduleTickMs = nowMs;
    processScheduledDispense();
  }

  if (nowMs - gLastLcdRefreshMs >= LCD_REFRESH_MS) {
    gLastLcdRefreshMs = nowMs;
    if (!gDispenseInProgress) {
      lcdShowCountdown();
    }
  }

  delay(30);
}
