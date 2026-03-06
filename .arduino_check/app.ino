/*
  PillCare ESP32 Firmware - LCD Countdown + Responsive UI + Reliable Button
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <TFT_eSPI.h>
#include <SPI.h>
#include <time.h>

// ---------------------------------------------------------------------------
// 1. CONFIGURATION
// ---------------------------------------------------------------------------
const char* ssid = "WE";
const char* password = "a.r&m.z.o.z*117";

const char* FIREBASE_API_KEY = "AIzaSyBImg8pi8XAvvBNBL3_163DUFxYd-LqIbY";
const char* FIREBASE_DB_HOST = "pillcaree-21f7b-default-rtdb.firebaseio.com";
const char* FIREBASE_EMAIL = "m0hamedabedd52@gmail.com";
const char* FIREBASE_PASSWORD = "01001085006";

const char* NTP_SERVER = "pool.ntp.org";
const long GMT_OFFSET_SEC = 7200;      // UTC+2
const int DAYLIGHT_OFFSET_SEC = 3600;  // Egypt DST (if active)

// ---------------------------------------------------------------------------
// 2. HARDWARE PINS
// ---------------------------------------------------------------------------
const int SLOT_COUNT = 3;
const int STEPS_PER_REV = 2048;
const int MAX_TIMES_PER_SLOT = 8;

const int MOTOR_PINS[SLOT_COUNT][4] = {
  {16, 19, 21, 22}, // Slot 1
  {17, 13, 33, 32}, // Slot 2
  {25, 26, 27, 14}  // Slot 3
};

const int BUTTON_PIN = 36; // Auto-detected polarity at boot
const int TFT_BL_PIN = 15; // LCD Backlight

// ---------------------------------------------------------------------------
// 3. UI COLORS & GLOBALS
// ---------------------------------------------------------------------------
TFT_eSPI tft = TFT_eSPI();

#define BG_COLOR      tft.color565(20, 20, 20)
#define CARD_COLOR    tft.color565(45, 45, 45)
#define ACCENT_COLOR  tft.color565(0, 173, 181)
#define SUCCESS_COLOR tft.color565(46, 204, 113)
#define TEXT_WHITE    tft.color565(240, 240, 240)
#define TEXT_GRAY     tft.color565(150, 150, 150)

const unsigned long COMMAND_POLL_INTERVAL_MS = 1200;
const unsigned long CONFIG_POLL_INTERVAL_MS = 6000;
const unsigned long LCD_REFRESH_MS = 1000;
const unsigned long BUTTON_DEBOUNCE_MS = 40;

String gIdToken = "";
String gUserUid = "";
unsigned long gTokenExpiry = 0;
unsigned long gLastCommandPoll = 0;
unsigned long gLastConfigPoll = 0;
unsigned long gLastLcdRefresh = 0;
uint64_t gLastHandledTimestamp = 0;
bool gClockConfigured = false;
bool gDispensingInProgress = false;
unsigned long gStatusHoldUntilMs = 0;
Preferences prefs;

// Button polling state (auto adapts to active-high or active-low wiring)
int gButtonIdleLevel = LOW;
int gButtonLastReading = LOW;
int gButtonStableLevel = LOW;
bool gButtonPressLatched = false;
unsigned long gButtonLastChangeMs = 0;

struct SlotSchedule {
  bool active = false;
  String name = "";
  int timesCount = 0;
  String times[MAX_TIMES_PER_SLOT];
};

SlotSchedule gSchedules[SLOT_COUNT];

// Dynamic UI layout (fits 320x240 and smaller TFTs)
int gPadX = 8;
int gPadY = 8;
int gHeaderH = 36;
int gCardX = 8;
int gCardY = 56;
int gCardW = 304;
int gCardH = 130;
int gCardRadius = 8;
int gCenterX = 160;

// ---------------------------------------------------------------------------
// 4. HELPERS
// ---------------------------------------------------------------------------

uint8_t mainFont() {
  return (tft.width() >= 300 && tft.height() >= 200) ? 4 : 2;
}

uint8_t subFont() {
  return (tft.width() >= 300 && tft.height() >= 200) ? 2 : 1;
}

void computeLayout() {
  const int w = tft.width();
  const int h = tft.height();

  gPadX = max(4, w / 32);
  gPadY = max(4, h / 24);
  gHeaderH = max(24, h / 6);

  gCardX = gPadX;
  gCardY = gPadY + gHeaderH + max(4, h / 24);
  gCardW = w - (2 * gPadX);

  const int footerReserve = max(16, h / 9);
  gCardH = h - gCardY - footerReserve - gPadY;
  if (gCardH < 70) gCardH = 70;

  gCardRadius = max(4, min(gCardW, gCardH) / 20);
  gCenterX = w / 2;
}

bool parseHHMM(const String& hhmm, int& outH, int& outM) {
  if (hhmm.length() != 5 || hhmm[2] != ':') return false;
  if (!isDigit(hhmm[0]) || !isDigit(hhmm[1]) || !isDigit(hhmm[3]) || !isDigit(hhmm[4])) return false;

  int h = (hhmm[0] - '0') * 10 + (hhmm[1] - '0');
  int m = (hhmm[3] - '0') * 10 + (hhmm[4] - '0');

  if (h < 0 || h > 23 || m < 0 || m > 59) return false;
  outH = h;
  outM = m;
  return true;
}

bool getLocalTimeSafe(struct tm& outTm) {
  return getLocalTime(&outTm, 10);
}

int secondsUntilDailyTime(const struct tm& nowTm, int targetH, int targetM) {
  int nowSec = nowTm.tm_hour * 3600 + nowTm.tm_min * 60 + nowTm.tm_sec;
  int targetSec = targetH * 3600 + targetM * 60;
  int delta = targetSec - nowSec;
  if (delta < 0) delta += 24 * 3600;
  return delta;
}

void formatCountdown(int totalSeconds, char* outBuf, size_t outBufSize) {
  if (totalSeconds < 0) totalSeconds = 0;
  int h = totalSeconds / 3600;
  int m = (totalSeconds % 3600) / 60;
  int s = totalSeconds % 60;
  snprintf(outBuf, outBufSize, "%02d:%02d:%02d", h, m, s);
}

void clearSchedules() {
  for (int i = 0; i < SLOT_COUNT; i++) {
    gSchedules[i].active = false;
    gSchedules[i].name = "";
    gSchedules[i].timesCount = 0;
  }
}

void loadTimesFromVariant(JsonVariant timesNode, SlotSchedule& slotSchedule) {
  if (timesNode.is<JsonArray>()) {
    for (JsonVariant v : timesNode.as<JsonArray>()) {
      if (slotSchedule.timesCount >= MAX_TIMES_PER_SLOT) break;
      String hhmm = v.as<String>();
      int h = 0, m = 0;
      if (parseHHMM(hhmm, h, m)) {
        slotSchedule.times[slotSchedule.timesCount++] = hhmm;
      }
    }
    return;
  }

  if (timesNode.is<JsonObject>()) {
    for (JsonPair kv : timesNode.as<JsonObject>()) {
      if (slotSchedule.timesCount >= MAX_TIMES_PER_SLOT) break;
      String hhmm = kv.value().as<String>();
      int h = 0, m = 0;
      if (parseHHMM(hhmm, h, m)) {
        slotSchedule.times[slotSchedule.timesCount++] = hhmm;
      }
    }
  }
}

void getNextDispenseInfo(int& outSlot, String& outName, String& outTime, int& outSeconds) {
  outSlot = -1;
  outName = "";
  outTime = "--:--";
  outSeconds = -1;

  struct tm nowTm;
  if (!getLocalTimeSafe(nowTm)) return;

  for (int slotIndex = 0; slotIndex < SLOT_COUNT; slotIndex++) {
    const SlotSchedule& s = gSchedules[slotIndex];
    if (!s.active || s.timesCount <= 0) continue;

    for (int i = 0; i < s.timesCount; i++) {
      int h = 0;
      int m = 0;
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

void configureClockOnce() {
  if (gClockConfigured) return;
  if (WiFi.status() != WL_CONNECTED) return;
  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
  gClockConfigured = true;
}

bool consumeButtonPress() {
  int reading = digitalRead(BUTTON_PIN);

  if (reading != gButtonLastReading) {
    gButtonLastReading = reading;
    gButtonLastChangeMs = millis();
  }

  if (millis() - gButtonLastChangeMs < BUTTON_DEBOUNCE_MS) return false;

  if (reading != gButtonStableLevel) {
    gButtonStableLevel = reading;

    bool pressedNow = (gButtonStableLevel != gButtonIdleLevel);
    if (pressedNow && !gButtonPressLatched) {
      gButtonPressLatched = true;
      return true;
    }

    if (!pressedNow) {
      gButtonPressLatched = false;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// 5. UI
// ---------------------------------------------------------------------------

void drawBaseUI() {
  computeLayout();
  tft.fillScreen(BG_COLOR);

  tft.fillRoundRect(gPadX, gPadY, tft.width() - (2 * gPadX), gHeaderH, gCardRadius, ACCENT_COLOR);
  tft.setTextColor(TFT_WHITE, ACCENT_COLOR);
  tft.setTextDatum(MC_DATUM);
  tft.drawString("PILLCARE SYSTEM", gCenterX, gPadY + (gHeaderH / 2), subFont());

  tft.setTextColor(TEXT_GRAY, BG_COLOR);
  tft.setTextDatum(BC_DATUM);
  tft.drawString("Press button to force sync", gCenterX, tft.height() - max(3, gPadY / 2), subFont());
}

void drawCardStatus(const String& mainText, const String& subText, uint16_t mainColor, unsigned long holdMs = 0) {
  tft.fillRoundRect(gCardX, gCardY, gCardW, gCardH, gCardRadius, CARD_COLOR);

  const int centerY = gCardY + (gCardH / 2);

  tft.setTextColor(mainColor, CARD_COLOR);
  tft.setTextDatum(MC_DATUM);
  tft.drawString(mainText, gCenterX, centerY - max(10, gCardH / 8), mainFont());

  if (subText.length() > 0) {
    tft.setTextColor(TEXT_WHITE, CARD_COLOR);
    tft.drawString(subText, gCenterX, centerY + max(16, gCardH / 6), subFont());
  }

  gStatusHoldUntilMs = millis() + holdMs;
}

void drawCountdownUI() {
  if (millis() < gStatusHoldUntilMs || gDispensingInProgress) return;

  tft.fillRoundRect(gCardX, gCardY, gCardW, gCardH, gCardRadius, CARD_COLOR);

  int y = gCardY + max(8, gCardH / 14);
  const int row = max(18, gCardH / 6);

  tft.setTextDatum(TC_DATUM);
  tft.setTextColor(TEXT_GRAY, CARD_COLOR);
  tft.drawString("NEXT PILL", gCenterX, y, subFont());

  y += row;
  int nextSlot = -1;
  String nextName;
  String nextTime;
  int nextSec = -1;
  getNextDispenseInfo(nextSlot, nextName, nextTime, nextSec);

  if (nextSlot < 0) {
    tft.setTextColor(TEXT_WHITE, CARD_COLOR);
    tft.drawString("No scheduled slots", gCenterX, y, subFont());
    y += row;
    tft.setTextColor(TEXT_GRAY, CARD_COLOR);
    tft.drawString("Sync from app to load times", gCenterX, y, subFont());
    return;
  }

  tft.setTextColor(ACCENT_COLOR, CARD_COLOR);
  tft.drawString("Slot " + String(nextSlot), gCenterX, y, mainFont());

  y += row;
  tft.setTextColor(TEXT_WHITE, CARD_COLOR);
  tft.drawString(nextName.length() > 0 ? nextName : "Medication", gCenterX, y, subFont());

  y += row;
  tft.setTextColor(TEXT_GRAY, CARD_COLOR);
  tft.drawString("At " + nextTime, gCenterX, y, subFont());

  y += row;
  char cdBuf[16] = "00:00:00";
  formatCountdown(nextSec, cdBuf, sizeof(cdBuf));
  tft.setTextColor(SUCCESS_COLOR, CARD_COLOR);
  tft.drawString(String(cdBuf), gCenterX, y, mainFont());
}

// ---------------------------------------------------------------------------
// 6. MOTOR CONTROL
// ---------------------------------------------------------------------------

void stopMotors() {
  for (int s = 0; s < SLOT_COUNT; s++) {
    for (int p = 0; p < 4; p++) {
      digitalWrite(MOTOR_PINS[s][p], LOW);
    }
  }
}

void rotateSlot(int slotIdx) {
  if (slotIdx < 0 || slotIdx >= SLOT_COUNT) return;

  gDispensingInProgress = true;

  Serial.printf("[MOTOR] Dispensing Slot %d\n", slotIdx + 1);
  drawCardStatus("DISPENSING", "Slot " + String(slotIdx + 1) + " is opening...", SUCCESS_COLOR);

  const int seq[4][4] = {
    {1, 0, 0, 0},
    {0, 1, 0, 0},
    {0, 0, 1, 0},
    {0, 0, 0, 1}
  };

  for (int i = 0; i < STEPS_PER_REV; i++) {
    for (int pin = 0; pin < 4; pin++) {
      digitalWrite(MOTOR_PINS[slotIdx][pin], seq[i % 4][pin]);
    }
    delayMicroseconds(2500);
  }

  stopMotors();
  delay(300);

  gDispensingInProgress = false;
  gStatusHoldUntilMs = 0;
  drawCountdownUI();
}

// ---------------------------------------------------------------------------
// 7. FIREBASE & WIFI
// ---------------------------------------------------------------------------

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.print("[WIFI] Connecting");
  drawCardStatus("CONNECTING", "Joining WiFi network...", TFT_ORANGE);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }

  Serial.println(" Connected");
  configureClockOnce();
  drawCardStatus("CONNECTED", "WiFi connected", SUCCESS_COLOR, 700);
}

bool signInFirebase() {
  drawCardStatus("AUTH", "Connecting to Firebase...", TFT_YELLOW);

  HTTPClient http;
  String url = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + String(FIREBASE_API_KEY);
  String payload = "{\"email\":\"" + String(FIREBASE_EMAIL) + "\",\"password\":\"" + String(FIREBASE_PASSWORD) + "\",\"returnSecureToken\":true}";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  int code = http.POST(payload);
  String response = http.getString();
  http.end();

  if (code == 200) {
    DynamicJsonDocument doc(2048);
    DeserializationError err = deserializeJson(doc, response);
    if (!err) {
      gIdToken = doc["idToken"].as<String>();
      gUserUid = doc["localId"].as<String>();
      gTokenExpiry = millis() + (doc["expiresIn"].as<unsigned long>() - 90UL) * 1000UL;
      drawCardStatus("SYSTEM READY", "Syncing schedule...", ACCENT_COLOR, 700);
      return true;
    }
  }

  drawCardStatus("AUTH ERROR", "Check Firebase config", TFT_RED, 2000);
  return false;
}

bool checkAuth() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (gIdToken.length() == 0 || millis() > gTokenExpiry) return signInFirebase();
  return true;
}

// ---------------------------------------------------------------------------
// 8. FIREBASE SYNC (COMMAND + CONFIG)
// ---------------------------------------------------------------------------

void syncDispenserConfig() {
  if (!checkAuth()) return;

  HTTPClient http;
  String url = "https://" + String(FIREBASE_DB_HOST) + "/users/" + gUserUid + "/dispenser_config.json?auth=" + gIdToken;
  http.begin(url);
  http.setTimeout(3000);

  int code = http.GET();
  String payload = http.getString();
  http.end();

  if (code != 200) return;

  payload.trim();
  if (payload == "null" || payload.length() < 2) {
    clearSchedules();
    return;
  }

  DynamicJsonDocument doc(4096);
  DeserializationError err = deserializeJson(doc, payload);
  if (err) {
    Serial.println("[CONFIG] JSON parse failed");
    return;
  }

  clearSchedules();

  for (int i = 0; i < SLOT_COUNT; i++) {
    String slotKey = "slot_" + String(i + 1);
    JsonVariant slotNode = doc[slotKey];
    if (slotNode.isNull()) continue;

    SlotSchedule& s = gSchedules[i];
    s.active = true;
    s.name = slotNode["name"].as<String>();
    if (s.name.length() == 0) s.name = "Slot " + String(i + 1);

    loadTimesFromVariant(slotNode["times"], s);

    if (s.timesCount <= 0) {
      s.active = false;
    }
  }
}

void checkCommand(bool manualOverride = false) {
  if (!checkAuth()) return;

  if (manualOverride) {
    drawCardStatus("MANUAL SYNC", "Checking commands...", TFT_ORANGE, 500);
  }

  HTTPClient http;
  String url = "https://" + String(FIREBASE_DB_HOST) + "/users/" + gUserUid + "/dispense_command.json?auth=" + gIdToken;

  http.begin(url);
  http.setTimeout(3000);

  int code = http.GET();
  String payload = http.getString();
  http.end();

  if (code == 200 && payload != "null" && payload.length() > 5) {
    DynamicJsonDocument doc(512);
    DeserializationError err = deserializeJson(doc, payload);

    if (!err) {
      uint64_t timestamp = doc["timestamp"].as<uint64_t>();

      if (timestamp > gLastHandledTimestamp) {
        String action = doc["action"].as<String>();
        int slot = doc["slot"].as<int>();

        if (action == "DISPENSE") {
          rotateSlot(slot - 1);
        }

        gLastHandledTimestamp = timestamp;
        char tsBuf[32];
        snprintf(tsBuf, sizeof(tsBuf), "%llu", (unsigned long long)timestamp);
        prefs.putString("last_ts", String(tsBuf));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 9. SETUP & LOOP
// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);

  pinMode(TFT_BL_PIN, OUTPUT);
  digitalWrite(TFT_BL_PIN, HIGH);

  tft.init();
  tft.setRotation(1);
  drawBaseUI();

  for (int s = 0; s < SLOT_COUNT; s++) {
    for (int p = 0; p < 4; p++) {
      pinMode(MOTOR_PINS[s][p], OUTPUT);
      digitalWrite(MOTOR_PINS[s][p], LOW);
    }
  }

  pinMode(BUTTON_PIN, INPUT);
  gButtonIdleLevel = digitalRead(BUTTON_PIN);
  gButtonLastReading = gButtonIdleLevel;
  gButtonStableLevel = gButtonIdleLevel;

  prefs.begin("pillcare", false);
  String savedTs = prefs.getString("last_ts", "0");
  gLastHandledTimestamp = strtoull(savedTs.c_str(), NULL, 10);

  if (checkAuth()) {
    syncDispenserConfig();
  }

  drawCountdownUI();
}

void loop() {
  if (consumeButtonPress()) {
    Serial.println("[BUTTON] Manual sync triggered");
    checkCommand(true);
    syncDispenserConfig();
    gStatusHoldUntilMs = 0;
    drawCountdownUI();
  }

  if (millis() - gLastCommandPoll > COMMAND_POLL_INTERVAL_MS) {
    checkCommand(false);
    gLastCommandPoll = millis();
  }

  if (millis() - gLastConfigPoll > CONFIG_POLL_INTERVAL_MS) {
    syncDispenserConfig();
    gLastConfigPoll = millis();
  }

  if (millis() - gLastLcdRefresh > LCD_REFRESH_MS) {
    drawCountdownUI();
    gLastLcdRefresh = millis();
  }
}
