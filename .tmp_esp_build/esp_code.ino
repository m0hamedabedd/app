/*
  PillCare ESP32 Firmware (App-Controlled)
  - Reads dispense commands written by your app to:
      users/<uid>/dispense_command
  - Drives slot motors for slot 1..3
  - Publishes status to:
      users/<uid>/device_status

  Required libraries:
  - None beyond standard ESP32 + Stepper
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Stepper.h>
#include <Preferences.h>
#include <time.h>

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
const char* FIRMWARE_VERSION = "2.0.0";

// ---------------------------------------------------------------------------
// 2) HARDWARE CONFIG (Stepper-based 3-slot dispenser)
// ---------------------------------------------------------------------------
const int SLOT_COUNT = 3;
const int STEPS_PER_REVOLUTION = 2048;  // 28BYJ-48

// Slot 1 pins
Stepper motor1(STEPS_PER_REVOLUTION, 32, 25, 33, 26);
// Slot 2 pins
Stepper motor2(STEPS_PER_REVOLUTION, 27, 12, 14, 13);
// Slot 3 pins
Stepper motor3(STEPS_PER_REVOLUTION, 21, 17, 19, 16);

Stepper* motors[SLOT_COUNT] = {&motor1, &motor2, &motor3};

const int MOTOR_PINS[SLOT_COUNT][4] = {
  {32, 25, 33, 26},
  {27, 12, 14, 13},
  {21, 17, 19, 16}
};

// Set per-slot direction (1 or -1) and turns per command
int SLOT_DIRECTION[SLOT_COUNT] = {1, 1, 1};
int SLOT_TURNS_PER_COMMAND[SLOT_COUNT] = {1, 1, 1};
int SLOT_SPEED_RPM[SLOT_COUNT] = {12, 12, 12};

// ---------------------------------------------------------------------------
// 3) TIMING
// ---------------------------------------------------------------------------
const unsigned long WIFI_RETRY_MS = 5000;
const unsigned long COMMAND_POLL_MS = 1200;
const unsigned long HEARTBEAT_MS = 15000;

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

void connectWiFiIfNeeded() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - gLastWifiAttemptMs < WIFI_RETRY_MS) return;

  gLastWifiAttemptMs = millis();
  Serial.printf("[WIFI] Connecting to %s\n", ssid);  // Use 'ssid' here
  WiFi.begin(ssid, password);  // Use 'ssid' and 'password' here
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

bool dispenseSlot(int slotIndex) {
  if (slotIndex < 0 || slotIndex >= SLOT_COUNT) return false;

  const int turns = SLOT_TURNS_PER_COMMAND[slotIndex] < 1 ? 1 : SLOT_TURNS_PER_COMMAND[slotIndex];
  const int dir = SLOT_DIRECTION[slotIndex] >= 0 ? 1 : -1;

  Serial.printf("[MOTOR] Slot %d, turns=%d, dir=%d\n", slotIndex + 1, turns, dir);

  for (int i = 0; i < turns; i++) {
    motors[slotIndex]->step(dir * STEPS_PER_REVOLUTION);
    delay(250);
    yield();
  }

  stopMotorCoils();
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

  bool ok = dispenseSlot(cmd.slot - 1);
  publishDispenseResult(cmd, ok, ok ? "Dispensed successfully" : "Motor failed");
}

void setupMotors() {
  for (int i = 0; i < SLOT_COUNT; i++) {
    motors[i]->setSpeed(SLOT_SPEED_RPM[i]);
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

  setupMotors();

  prefs.begin("pillcare", false);
  String lastTsStr = prefs.getString("last_cmd_ts", "0");
  gLastHandledTimestamp = extractJsonUint64("{\"v\":" + lastTsStr + "}", "v");
  Serial.printf("[STATE] last_cmd_ts=%llu\n", gLastHandledTimestamp);

  WiFi.mode(WIFI_STA);
  connectWiFiIfNeeded();

  configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER);
}

void loop() {
  connectWiFiIfNeeded();
  if (WiFi.status() != WL_CONNECTED) {
    delay(150);
    return;
  }

  if (!ensureFirebaseAuth()) {
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

  delay(30);
}
