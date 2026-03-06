/*
  PillCare ESP32 Firmware
  Changes from previous version:
    - REMOVED all Preferences/NVS flash memory (caused corruption issues)
    - FIXED button logic: 10kΩ pull-up to 3V3 → GPIO36 idles HIGH, goes LOW on press
    - FIXED LCD: setSwapBytes(true), rotation=0, explicit 240x240 constants
    - All state is now RAM-only (resets on reboot, which is fine)
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>
#include <SPI.h>
#include <time.h>
#include <math.h>

// ---------------------------------------------------------------------------
// 1. CONFIGURATION
// ---------------------------------------------------------------------------
const char* ssid     = "WE";
const char* password = "a.r&m.z.o.z*117";

const char* FIREBASE_API_KEY = "AIzaSyBImg8pi8XAvvBNBL3_163DUFxYd-LqIbY";
const char* FIREBASE_DB_HOST = "pillcaree-21f7b-default-rtdb.firebaseio.com";
const char* FIREBASE_EMAIL   = "m0hamedabedd52@gmail.com";
const char* FIREBASE_PASSWORD = "01001085006";

const char* NTP_SERVER               = "pool.ntp.org";
const long  DEFAULT_GMT_OFFSET_SEC   = 7200;   // UTC+2 Egypt fallback
const int   DEFAULT_DAYLIGHT_OFFSET_SEC = 0;

// ---------------------------------------------------------------------------
// 2. SCREEN CONSTANTS — ST7789 1.54" is EXACTLY 240×240
// ---------------------------------------------------------------------------
#define SCREEN_W   240
#define SCREEN_H   240
#define PANEL_DIV   90   // Left panel 0..89, Right panel 90..239

// ---------------------------------------------------------------------------
// 3. HARDWARE PINS
// ---------------------------------------------------------------------------
const int SLOT_COUNT         = 3;
const int STEPS_PER_REV      = 2048;
const int MAX_TIMES_PER_SLOT = 8;

// 28BYJ-48 stepper motors — IN1 IN2 IN3 IN4
const int MOTOR_PINS[SLOT_COUNT][4] = {
  {16, 19, 21, 22},
  {17, 13, 33, 32},
  {25, 26, 27, 14}
};

const int BUTTON_PIN = 36;
const int TFT_BL_PIN = 15;

// ---------------------------------------------------------------------------
// 4. UI COLORS
// ---------------------------------------------------------------------------
TFT_eSPI tft = TFT_eSPI();

#define C_LEFT_PANEL  tft.color565( 10,  25,  47)
#define C_RIGHT_PANEL tft.color565(  5,   5,   5)
#define C_CYAN        tft.color565(100, 255, 218)
#define C_WHITE       tft.color565(230, 241, 255)
#define C_GRAY        tft.color565(136, 146, 176)
#define C_BADGE_BG    tft.color565( 23,  42,  69)
#define C_URGENT      tft.color565(255, 107, 107)
#define C_BLACK       tft.color565(  0,   0,   0)

// ---------------------------------------------------------------------------
// 5. TIMING CONSTANTS
// ---------------------------------------------------------------------------
const unsigned long COMMAND_POLL_INTERVAL_MS = 1200;
const unsigned long CONFIG_POLL_INTERVAL_MS  = 6000;
const unsigned long WIFI_RETRY_INTERVAL_MS   = 15000;
const unsigned long WIFI_CONNECT_TIMEOUT_MS  = 10000;
const unsigned long DASHBOARD_REFRESH_MS     = 5000;
const unsigned long TIMEZONE_POLL_INTERVAL_MS = 60000;
const uint32_t      TIME_SYNC_TIMEOUT_MS     = 2000;

// ---------------------------------------------------------------------------
// 6. DATA STRUCTURES
// ---------------------------------------------------------------------------
struct SlotSchedule {
  bool   active          = false;
  String name            = "";
  float  turnsPerDose    = 1.0f;
  int    timesCount      = 0;
  String times[MAX_TIMES_PER_SLOT];
  int    lastDispensedYDay[MAX_TIMES_PER_SLOT];
  int    lastDispensedMinuteOfDay[MAX_TIMES_PER_SLOT];
};
SlotSchedule gSchedules[SLOT_COUNT];

// ---------------------------------------------------------------------------
// 7. GLOBALS  (RAM only — no flash/Preferences)
// ---------------------------------------------------------------------------
String        gIdToken           = "";
String        gUserUid           = "";
unsigned long gTokenExpiry       = 0;
unsigned long gLastCommandPoll   = 0;
unsigned long gLastConfigPoll    = 0;
unsigned long gLastWifiAttemptMs = 0;
unsigned long gLastDashboardDraw = 0;
unsigned long gLastTimezonePoll  = 0;
uint64_t      gLastHandledTimestamp = 0;   // resets to 0 on every boot (fine)
bool          gClockConfigured   = false;
bool          gDispensingInProgress = false;
bool          gHasValidTime      = false;
unsigned long gStatusHoldUntilMs = 0;
time_t        gLastKnownEpoch    = 0;
unsigned long gLastKnownEpochMs  = 0;

bool          gForceRedraw       = true;
int           lastRemainingMinutes = -999;
long          gGmtOffsetSec      = DEFAULT_GMT_OFFSET_SEC;
int           gDaylightOffsetSec = DEFAULT_DAYLIGHT_OFFSET_SEC;

// ---------------------------------------------------------------------------
// 8. BUTTON — 10kΩ pull-up resistor on GPIO36
//
//   Wiring:  3V3 ──[10kΩ]── GPIO36 ──[Button]── GND
//   Idle  = HIGH (pulled up via resistor)
//   Press = LOW  (button pulls to GND)
//
//   Debounce: require sustained LOW for >60ms to confirm a real press.
// ---------------------------------------------------------------------------
unsigned long solidLowStartTime    = 0;
bool          buttonActionTriggered = false;
bool          buttonTriggered       = false;

void handleButton() {
  int state = digitalRead(BUTTON_PIN);

  if (state == LOW) {
    // Button pressed (pulled to GND)
    if (solidLowStartTime == 0) {
      solidLowStartTime = millis();
    } else if ((millis() - solidLowStartTime) > 60) {
      if (!buttonActionTriggered) {
        Serial.println("[BUTTON] Press confirmed.");
        buttonTriggered       = true;
        buttonActionTriggered = true;
      }
    }
  } else {
    // HIGH = idle / released — reset debounce
    solidLowStartTime     = 0;
    buttonActionTriggered = false;
  }
}

// ---------------------------------------------------------------------------
// 9. FORWARD DECLARATIONS
// ---------------------------------------------------------------------------
void rotateSlot(int slotIdx, float turns = 1.0f);
void loadTimesFromVariant(JsonVariant timesNode, SlotSchedule& s);
void drawDashboard(bool force = false);
void syncTimezoneOffsetFromProfile(bool force = false);

// ---------------------------------------------------------------------------
// 10. TIME HELPERS
// ---------------------------------------------------------------------------
bool parseHHMM(const String& hhmm, int& outH, int& outM) {
  if (hhmm.length() != 5 || hhmm[2] != ':') return false;
  if (!isDigit(hhmm[0]) || !isDigit(hhmm[1]) ||
      !isDigit(hhmm[3]) || !isDigit(hhmm[4])) return false;
  int h = (hhmm[0]-'0')*10 + (hhmm[1]-'0');
  int m = (hhmm[3]-'0')*10 + (hhmm[4]-'0');
  if (h > 23 || m > 59) return false;
  outH = h; outM = m;
  return true;
}

void cacheCurrentEpoch() {
  time_t now = time(nullptr);
  if (now > 100000) {
    gLastKnownEpoch   = now;
    gLastKnownEpochMs = millis();
    gHasValidTime     = true;
  }
}

bool getLocalTimeSafe(struct tm& outTm) {
  if (getLocalTime(&outTm, TIME_SYNC_TIMEOUT_MS)) {
    cacheCurrentEpoch();
    return true;
  }
  if (gLastKnownEpoch > 100000) {
    time_t estimated = gLastKnownEpoch +
                       (time_t)((millis() - gLastKnownEpochMs) / 1000UL);
    localtime_r(&estimated, &outTm);
    return true;
  }
  return false;
}

void ensureValidTime() {
  if (gHasValidTime) return;
  if (WiFi.status() != WL_CONNECTED) return;
  configTime(gGmtOffsetSec, gDaylightOffsetSec, NTP_SERVER);
  struct tm tmProbe;
  for (int i = 0; i < 10; i++) {
    if (getLocalTime(&tmProbe, 500)) { cacheCurrentEpoch(); break; }
    delay(200);
  }
}

void configureClockOnce() {
  if (gClockConfigured || WiFi.status() != WL_CONNECTED) return;
  configTime(gGmtOffsetSec, gDaylightOffsetSec, NTP_SERVER);
  gClockConfigured = true;
  ensureValidTime();
}

int secondsUntilDailyTime(const struct tm& nowTm, int targetH, int targetM) {
  int nowSec    = nowTm.tm_hour * 3600 + nowTm.tm_min * 60 + nowTm.tm_sec;
  int targetSec = targetH * 3600 + targetM * 60;
  int delta     = targetSec - nowSec;
  if (delta < 0) delta += 86400;
  return delta;
}

// ---------------------------------------------------------------------------
// 11. SCHEDULE HELPERS
// ---------------------------------------------------------------------------
float extractFirstPositiveFloat(const String& text) {
  String number = "";
  bool seenDigit = false, seenDot = false;
  for (int i = 0; i < (int)text.length(); i++) {
    char c = text[i];
    if (c >= '0' && c <= '9') { number += c; seenDigit = true; continue; }
    if (c == '.' && !seenDot)  { number += c; seenDot   = true; continue; }
    if (seenDigit) break;
    if (seenDot && !seenDigit) { number = ""; seenDot = false; }
  }
  float v = number.toFloat();
  return (v <= 0.0f) ? 1.0f : v;
}

float parseTurnsPerDose(JsonVariant slotNode) {
  float turns = 1.0f;
  if (!slotNode["pillsPerDose"].isNull())
    turns = slotNode["pillsPerDose"].as<float>();
  else if (!slotNode["turnsPerDose"].isNull())
    turns = slotNode["turnsPerDose"].as<float>();
  else if (!slotNode["dosage"].isNull()) {
    JsonVariant d = slotNode["dosage"];
    if (d.is<float>() || d.is<int>() || d.is<long>()) turns = d.as<float>();
    else turns = extractFirstPositiveFloat(d.as<String>());
  }
  return (turns < 0.25f) ? 1.0f : turns;
}

void clearSchedules() {
  for (int i = 0; i < SLOT_COUNT; i++) {
    gSchedules[i].active       = false;
    gSchedules[i].name         = "";
    gSchedules[i].turnsPerDose = 1.0f;
    gSchedules[i].timesCount   = 0;
    for (int t = 0; t < MAX_TIMES_PER_SLOT; t++) {
      gSchedules[i].times[t]                   = "";
      gSchedules[i].lastDispensedYDay[t]        = -1;
      gSchedules[i].lastDispensedMinuteOfDay[t] = -1;
    }
  }
}

void loadTimesFromVariant(JsonVariant timesNode, SlotSchedule& s) {
  if (timesNode.is<JsonArray>()) {
    for (JsonVariant v : timesNode.as<JsonArray>()) {
      if (s.timesCount >= MAX_TIMES_PER_SLOT) break;
      int h = 0, m = 0;
      String hhmm = v.as<String>();
      if (parseHHMM(hhmm, h, m)) s.times[s.timesCount++] = hhmm;
    }
  } else if (timesNode.is<JsonObject>()) {
    for (JsonPair kv : timesNode.as<JsonObject>()) {
      if (s.timesCount >= MAX_TIMES_PER_SLOT) break;
      int h = 0, m = 0;
      String hhmm = kv.value().as<String>();
      if (parseHHMM(hhmm, h, m)) s.times[s.timesCount++] = hhmm;
    }
  }
}

void restoreDispenseHistory(SlotSchedule& target, const SlotSchedule& old) {
  for (int i = 0; i < target.timesCount; i++) {
    for (int j = 0; j < old.timesCount; j++) {
      if (target.times[i] == old.times[j]) {
        target.lastDispensedYDay[i]        = old.lastDispensedYDay[j];
        target.lastDispensedMinuteOfDay[i] = old.lastDispensedMinuteOfDay[j];
        break;
      }
    }
  }
}

bool hasAnyActiveSchedules() {
  for (int i = 0; i < SLOT_COUNT; i++)
    if (gSchedules[i].active && gSchedules[i].timesCount > 0) return true;
  return false;
}

void applySlotNode(int idx, JsonVariant slotNode, const SlotSchedule& old) {
  if (idx < 0 || idx >= SLOT_COUNT || slotNode.isNull()) return;
  SlotSchedule& s = gSchedules[idx];
  s.active       = true;
  s.name         = slotNode["name"].as<String>();
  if (s.name.length() == 0) s.name = "Slot " + String(idx + 1);
  s.turnsPerDose = parseTurnsPerDose(slotNode);
  loadTimesFromVariant(slotNode["times"], s);
  if (s.timesCount <= 0) loadTimesFromVariant(slotNode["scheduledTimes"], s);
  restoreDispenseHistory(s, old);
  if (s.timesCount <= 0) s.active = false;
}

void parseSchedulesFromDispenserConfigDoc(JsonDocument& doc, SlotSchedule prev[]) {
  for (int i = 0; i < SLOT_COUNT; i++) {
    String key = "slot_" + String(i + 1);
    applySlotNode(i, doc[key], prev[i]);
  }
}

void parseSchedulesFromMedicationsDoc(JsonDocument& doc, SlotSchedule prev[]) {
  JsonVariant root = doc.as<JsonVariant>();
  auto tryApply = [&](JsonVariant med) {
    if (med.isNull()) return;
    if (med["isActive"].is<bool>() && !med["isActive"].as<bool>()) return;
    int slot = med["slot"].as<int>();
    if (slot >= 1 && slot <= SLOT_COUNT && !gSchedules[slot-1].active)
      applySlotNode(slot-1, med, prev[slot-1]);
  };
  if (root.is<JsonArray>())
    for (JsonVariant med : root.as<JsonArray>()) tryApply(med);
  else if (root.is<JsonObject>())
    for (JsonPair kv : root.as<JsonObject>()) tryApply(kv.value());
}

void getNextDispenseInfo(int& outSlot, String& outName,
                         String& outTime, int& outSeconds) {
  outSlot = -1; outName = "No Schedule"; outTime = "--:--"; outSeconds = -1;
  struct tm nowTm;
  if (!getLocalTimeSafe(nowTm)) return;

  for (int i = 0; i < SLOT_COUNT; i++) {
    const SlotSchedule& s = gSchedules[i];
    if (!s.active || s.timesCount <= 0) continue;
    for (int t = 0; t < s.timesCount; t++) {
      int h = 0, m = 0;
      if (!parseHHMM(s.times[t], h, m)) continue;
      int sec = secondsUntilDailyTime(nowTm, h, m);
      if (outSeconds < 0 || sec < outSeconds) {
        outSeconds = sec;
        outSlot    = i + 1;
        outName    = s.name;
        outTime    = s.times[t];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 12. DASHBOARD UI
// ---------------------------------------------------------------------------
void drawCapsule(int x, int y, int w, int h, uint16_t color) {
  tft.fillRoundRect(x, y, w, h, h / 2, color);
}

void drawStatusFullscreen(const String& text, uint16_t color,
                          unsigned long holdMs = 0) {
  tft.fillScreen(C_RIGHT_PANEL);
  tft.setTextColor(color, C_RIGHT_PANEL);
  tft.setTextDatum(MC_DATUM);
  tft.setTextSize(1);
  tft.drawString(text, SCREEN_W / 2, SCREEN_H / 2, 4);
  if (holdMs > 0) gStatusHoldUntilMs = millis() + holdMs;
  lastRemainingMinutes = -999;
}

void drawDashboard(bool force) {
  if (millis() < gStatusHoldUntilMs) return;
  if (gDispensingInProgress) return;

  if (!force && !gForceRedraw &&
      (millis() - gLastDashboardDraw) < DASHBOARD_REFRESH_MS) return;

  int    nextSlot = -1;
  String nextName = "No Schedule";
  String nextTime = "--:--";
  int    nextSec  = -1;

  struct tm nowTm;
  bool hasTime = getLocalTimeSafe(nowTm);
  if (hasTime) getNextDispenseInfo(nextSlot, nextName, nextTime, nextSec);

  int currentRemainingMins = (nextSec >= 0) ? (nextSec / 60) : -1;

  if (!force && !gForceRedraw &&
      currentRemainingMins == lastRemainingMinutes) return;

  // Full repaint
  tft.fillRect(0,        0, PANEL_DIV,             SCREEN_H, C_LEFT_PANEL);
  tft.fillRect(PANEL_DIV, 0, SCREEN_W - PANEL_DIV, SCREEN_H, C_RIGHT_PANEL);

  // ==== LEFT PANEL ====
  if (nextSlot > 0) {
    int pillX = 30, pillY = 20, pillW = 30, pillH = 55;
    tft.fillRoundRect(pillX, pillY, pillW, pillH, pillW / 2, C_WHITE);
    tft.fillRoundRect(pillX, pillY, pillW, pillH / 2, pillW / 2, C_CYAN);

    tft.setTextColor(C_GRAY, C_LEFT_PANEL);
    tft.setTextDatum(MC_DATUM);
    tft.setTextSize(1);
    tft.drawString("SLOT", 45, 98, 2);

    tft.setTextColor(C_CYAN, C_LEFT_PANEL);
    tft.drawString(String(nextSlot), 45, 125, 6);
  } else {
    tft.setTextColor(C_GRAY, C_LEFT_PANEL);
    tft.setTextDatum(MC_DATUM);
    tft.drawString("--", 45, SCREEN_H / 2, 4);
  }

  // ==== RIGHT PANEL ====
  int rx = PANEL_DIV + 8;
  int rw = SCREEN_W - rx - 4;

  tft.setTextDatum(TL_DATUM);
  tft.setTextSize(1);

  tft.setTextColor(C_CYAN, C_RIGHT_PANEL);
  tft.drawString("NEXT MED", rx, 14, 2);

  String dispName = nextName;
  if (dispName.length() > 10) dispName = dispName.substring(0, 9) + ".";
  tft.setTextColor(C_WHITE, C_RIGHT_PANEL);
  tft.drawString(dispName, rx, 38, 2);

  tft.drawFastHLine(rx, 60, rw, C_BADGE_BG);

  tft.setTextColor(C_GRAY, C_RIGHT_PANEL);
  tft.drawString("AT", rx, 70, 2);

  // 12-hour time
  String formattedTime = nextTime;
  int h = 0, m = 0;
  if (parseHHMM(nextTime, h, m)) {
    String ampm = (h >= 12) ? "PM" : "AM";
    int h12 = (h % 12 == 0) ? 12 : (h % 12);
    char buf[12];
    snprintf(buf, sizeof(buf), "%02d:%02d %s", h12, m, ampm.c_str());
    formattedTime = String(buf);
  }
  tft.setTextColor(C_WHITE, C_RIGHT_PANEL);
  tft.drawString(formattedTime, rx, 90, 2);

  tft.drawFastHLine(rx, 120, rw, C_BADGE_BG);

  if (nextSec >= 0) {
    int hrsLeft  = nextSec / 3600;
    int minsLeft = (nextSec % 3600) / 60;

    String   timeStr = "";
    uint16_t bgColor = C_BADGE_BG;

    if (hrsLeft > 0) {
      timeStr = String(hrsLeft) + "h " + String(minsLeft) + "m";
    } else if (minsLeft > 0) {
      timeStr = "In " + String(minsLeft) + "m";
      if (minsLeft <= 15) bgColor = C_URGENT;
    } else {
      timeStr = "NOW!";
      bgColor  = C_URGENT;
    }

    tft.setTextDatum(TL_DATUM);
    tft.setTextColor(C_GRAY, C_RIGHT_PANEL);
    tft.drawString("COUNTDOWN", rx, 125, 1);

    int badgeX = rx, badgeY = 135, badgeW = rw, badgeH = 36;
    drawCapsule(badgeX, badgeY, badgeW, badgeH, bgColor);
    tft.setTextColor(C_WHITE, bgColor);
    tft.setTextDatum(MC_DATUM);
    tft.drawString(timeStr, badgeX + badgeW / 2, badgeY + badgeH / 2, 2);
  } else {
    tft.setTextColor(C_GRAY, C_RIGHT_PANEL);
    tft.setTextDatum(TL_DATUM);
    tft.drawString("Syncing...", rx, 135, 2);
  }

  // WiFi indicator dot
  uint16_t wifiColor = (WiFi.status() == WL_CONNECTED) ? C_CYAN : C_URGENT;
  tft.fillCircle(SCREEN_W - 8, SCREEN_H - 8, 4, wifiColor);

  gForceRedraw         = false;
  lastRemainingMinutes = currentRemainingMins;
  gLastDashboardDraw   = millis();
}

// ---------------------------------------------------------------------------
// 13. MOTOR CONTROL
// ---------------------------------------------------------------------------
void stopMotors() {
  for (int s = 0; s < SLOT_COUNT; s++)
    for (int p = 0; p < 4; p++)
      digitalWrite(MOTOR_PINS[s][p], LOW);
}

void rotateSlot(int slotIdx, float turns) {
  if (slotIdx < 0 || slotIdx >= SLOT_COUNT) return;
  if (turns < 0.25f) turns = 1.0f;

  gDispensingInProgress = true;
  long totalSteps = lroundf(turns * (float)STEPS_PER_REV);
  if (totalSteps < 1) totalSteps = STEPS_PER_REV;

  tft.fillScreen(C_RIGHT_PANEL);
  tft.setTextColor(C_CYAN, C_RIGHT_PANEL);
  tft.setTextDatum(MC_DATUM);
  tft.setTextSize(1);
  tft.drawString("DISPENSING", SCREEN_W / 2, SCREEN_H / 2 - 20, 4);
  tft.setTextColor(C_WHITE, C_RIGHT_PANEL);
  tft.drawString("SLOT " + String(slotIdx + 1), SCREEN_W / 2, SCREEN_H / 2 + 20, 4);

  // Half-step sequence (8-step) — smoother and stronger torque
  const int seq[8][4] = {
    {1, 0, 0, 0},
    {1, 1, 0, 0},
    {0, 1, 0, 0},
    {0, 1, 1, 0},
    {0, 0, 1, 0},
    {0, 0, 1, 1},
    {0, 0, 0, 1},
    {1, 0, 0, 1}
  };
  long halfSteps = totalSteps * 2;   // half-step needs 2× steps for same turns

  for (long i = 0; i < halfSteps; i++) {
    int step = i % 8;
    for (int pin = 0; pin < 4; pin++)
      digitalWrite(MOTOR_PINS[slotIdx][pin], seq[step][pin]);
    delayMicroseconds(1200);  // ~1.2ms per half-step
  }

  stopMotors();
  delay(500);

  gDispensingInProgress = false;
  gStatusHoldUntilMs    = 0;
  gForceRedraw          = true;
  drawDashboard(true);
}

// ---------------------------------------------------------------------------
// 14. FIREBASE & WIFI
// ---------------------------------------------------------------------------
bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) { configureClockOnce(); return true; }
  if (millis() - gLastWifiAttemptMs < WIFI_RETRY_INTERVAL_MS) return false;

  gLastWifiAttemptMs = millis();
  drawStatusFullscreen("CONNECTING...", C_WHITE, 500);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  unsigned long start = millis();

  while (WiFi.status() != WL_CONNECTED &&
         (millis() - start) < WIFI_CONNECT_TIMEOUT_MS) {
    handleButton();
    delay(50);
  }

  if (WiFi.status() == WL_CONNECTED) {
    configureClockOnce();
    drawStatusFullscreen("WIFI OK", C_CYAN, 1200);
    return true;
  }
  drawStatusFullscreen("NO WIFI", C_URGENT, 2000);
  return false;
}

bool signInFirebase() {
  drawStatusFullscreen("SIGNING IN...", C_WHITE, 500);
  HTTPClient http;
  String url = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key="
               + String(FIREBASE_API_KEY);
  String payload = "{\"email\":\"" + String(FIREBASE_EMAIL) +
                   "\",\"password\":\"" + String(FIREBASE_PASSWORD) +
                   "\",\"returnSecureToken\":true}";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  int    code     = http.POST(payload);
  String response = http.getString();
  http.end();

  if (code == 200) {
    DynamicJsonDocument doc(2048);
    if (!deserializeJson(doc, response)) {
      gIdToken     = doc["idToken"].as<String>();
      gUserUid     = doc["localId"].as<String>();
      gTokenExpiry = millis() +
                     (doc["expiresIn"].as<unsigned long>() - 90UL) * 1000UL;
      drawStatusFullscreen("CONNECTED", C_CYAN, 1200);
      return true;
    }
  }
  drawStatusFullscreen("AUTH FAILED", C_URGENT, 2000);
  return false;
}

bool checkAuth() {
  if (WiFi.status() != WL_CONNECTED && !connectWiFi()) return false;
  if (gIdToken.length() == 0 || millis() > gTokenExpiry) return signInFirebase();
  if (!gHasValidTime) ensureValidTime();
  return true;
}

void syncTimezoneOffsetFromProfile(bool force) {
  if (gUserUid.length() == 0 || gIdToken.length() == 0) return;
  if (!force && gLastTimezonePoll > 0 &&
      millis() - gLastTimezonePoll < TIMEZONE_POLL_INTERVAL_MS) return;
  gLastTimezonePoll = millis();

  HTTPClient http;
  http.begin("https://" + String(FIREBASE_DB_HOST) + "/users/" + gUserUid +
             "/userProfile/utcOffsetMinutes.json?auth=" + gIdToken);
  int    code    = http.GET();
  String payload = http.getString();
  http.end();

  if (code != 200 || payload == "null" || payload.length() == 0) return;

  DynamicJsonDocument doc(96);
  if (deserializeJson(doc, payload)) return;

  int offsetMinutes = 0;
  bool hasOffset = false;
  if (doc.is<int>() || doc.is<long>()) {
    offsetMinutes = doc.as<int>();
    hasOffset = true;
  } else if (doc.is<const char*>()) {
    String raw = doc.as<String>();
    raw.trim();
    if (raw.length() > 0) {
      offsetMinutes = raw.toInt();
      hasOffset = true;
    }
  }

  if (!hasOffset) return;
  if (offsetMinutes < -720 || offsetMinutes > 840) return;

  long newOffsetSec = (long)offsetMinutes * 60L;
  if (newOffsetSec == gGmtOffsetSec) return;

  gGmtOffsetSec      = newOffsetSec;
  gDaylightOffsetSec = 0;
  gHasValidTime      = false;
  configTime(gGmtOffsetSec, gDaylightOffsetSec, NTP_SERVER);
  ensureValidTime();
  gForceRedraw = true;
}

void syncDispenserConfig() {
  if (!checkAuth()) return;
  syncTimezoneOffsetFromProfile(false);

  SlotSchedule previous[SLOT_COUNT];
  for (int i = 0; i < SLOT_COUNT; i++) previous[i] = gSchedules[i];
  bool gotAnySource = false;

  HTTPClient http;
  http.begin("https://" + String(FIREBASE_DB_HOST) + "/users/" + gUserUid +
             "/dispenser_config.json?auth=" + gIdToken);
  int    code    = http.GET();
  String payload = http.getString();
  http.end();

  clearSchedules();
  if (code == 200 && payload.length() >= 2 && payload != "null") {
    DynamicJsonDocument doc(4096);
    if (!deserializeJson(doc, payload)) {
      parseSchedulesFromDispenserConfigDoc(doc, previous);
      gotAnySource = true;
    }
  }

  if (!hasAnyActiveSchedules()) {
    http.begin("https://" + String(FIREBASE_DB_HOST) + "/users/" + gUserUid +
               "/medications.json?auth=" + gIdToken);
    int    mc = http.GET();
    String mp = http.getString();
    http.end();

    if (mc == 200 && mp.length() >= 2 && mp != "null") {
      DynamicJsonDocument medsDoc(12288);
      if (!deserializeJson(medsDoc, mp)) {
        parseSchedulesFromMedicationsDoc(medsDoc, previous);
        gotAnySource = true;
      }
    }
  }

  if (!gotAnySource && !hasAnyActiveSchedules()) {
    for (int i = 0; i < SLOT_COUNT; i++) gSchedules[i] = previous[i];
    return;
  }

  gForceRedraw = true;
}

void checkCommand(bool manualOverride) {
  if (!checkAuth()) return;
  if (manualOverride) drawStatusFullscreen("SYNCING...", C_WHITE, 800);

  HTTPClient http;
  http.begin("https://" + String(FIREBASE_DB_HOST) + "/users/" + gUserUid +
             "/dispense_command.json?auth=" + gIdToken);
  int    code    = http.GET();
  String payload = http.getString();
  http.end();

  if (code == 200 && payload != "null" && payload.length() > 5) {
    DynamicJsonDocument doc(512);
    if (!deserializeJson(doc, payload)) {
      uint64_t timestamp = doc["timestamp"].as<uint64_t>();
      if (timestamp > gLastHandledTimestamp) {
        String action = doc["action"].as<String>();
        int    slot   = doc["slot"].as<int>();

        if (action == "DISPENSE" && slot >= 1 && slot <= SLOT_COUNT) {
          float turns = gSchedules[slot - 1].turnsPerDose;
          rotateSlot(slot - 1, turns);
        }
        gLastHandledTimestamp = timestamp;
        // NOTE: no Preferences.putString() — timestamp lives in RAM only
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 15. SETUP
// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);

  // Backlight ON
  pinMode(TFT_BL_PIN, OUTPUT);
  digitalWrite(TFT_BL_PIN, HIGH);

  // ---- Display init ----
  // IMPORTANT: In your TFT_eSPI User_Setup.h make sure you have:
  //   #define ST7789_DRIVER
  //   #define TFT_WIDTH  240
  //   #define TFT_HEIGHT 240
  //   #define TFT_RGB_ORDER TFT_RGB   (or TFT_BGR if colors look wrong)
  tft.init();
  tft.setSwapBytes(true);   // FIX: correct byte order for ST7789
  tft.setRotation(0);       // 0=normal, 2=180° flip — change if upside-down
  tft.fillScreen(C_BLACK);

  Serial.printf("[DISPLAY] w=%d h=%d\n", tft.width(), tft.height());

  // Motor pins
  for (int s = 0; s < SLOT_COUNT; s++)
    for (int p = 0; p < 4; p++) {
      pinMode(MOTOR_PINS[s][p], OUTPUT);
      digitalWrite(MOTOR_PINS[s][p], LOW);
    }

  // Button — INPUT only (external 10kΩ pull-up to 3V3 already wired)
  pinMode(BUTTON_PIN, INPUT);

  // Initial sync
  clearSchedules();
  if (checkAuth()) syncDispenserConfig();

  gForceRedraw = true;
  drawDashboard(true);
}

// ---------------------------------------------------------------------------
// 16. LOOP
// ---------------------------------------------------------------------------
void loop() {

  // 1. Button debounce
  handleButton();

  // 2. Button press action
  if (buttonTriggered) {
    buttonTriggered = false;

    int    nextSlot = -1;
    String nextName, nextTime;
    int    nextSec  = -1;
    getNextDispenseInfo(nextSlot, nextName, nextTime, nextSec);

    if (nextSlot >= 1 && nextSlot <= SLOT_COUNT) {
      float turns = gSchedules[nextSlot - 1].turnsPerDose;
      rotateSlot(nextSlot - 1, turns);
    } else {
      drawStatusFullscreen("NO SCHEDULE", C_URGENT, 1500);
    }

    checkCommand(false);
    syncDispenserConfig();
    gStatusHoldUntilMs = 0;
    gForceRedraw       = true;
    drawDashboard(true);
  }

  // 3. Periodic command polling
  if (millis() - gLastCommandPoll > COMMAND_POLL_INTERVAL_MS) {
    checkCommand(false);
    gLastCommandPoll = millis();
  }

  // 4. Periodic config sync
  if (millis() - gLastConfigPoll > CONFIG_POLL_INTERVAL_MS) {
    syncDispenserConfig();
    gLastConfigPoll = millis();
  }

  // 5. Dashboard refresh
  drawDashboard(false);
}
