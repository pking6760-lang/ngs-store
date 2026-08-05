/*
 * NGS Store — DIY payment soundbox (ESP32)
 * ------------------------------------------------------------------
 * A standalone box that announces every counter payment out loud, like a
 * Paytm/PhonePe soundbox — but it announces YOUR NGS payments.
 *
 * It connects to Wi-Fi, checks the store server every few seconds, and the
 * moment a new Collect-payment QR is paid it speaks the amount through the
 * speaker (any amount, English or Hindi — the voice is generated on the
 * server, so nothing is stored on the device).
 *
 * HARDWARE
 *   - ESP32 dev board (ESP32-WROOM-32)
 *   - MAX98357A I2S amplifier module
 *   - 3W 4ohm speaker
 *   - 5V USB power
 *
 * WIRING (MAX98357A -> ESP32)
 *   VIN  -> 5V (VIN)          GND  -> GND
 *   LRC  -> GPIO 25           BCLK -> GPIO 26
 *   DIN  -> GPIO 22           GAIN -> (leave open = 9dB)  SD -> (leave open = on)
 *   Speaker + / -            -> the amp's + / - screw terminals
 *
 * ARDUINO IDE SETUP
 *   1. Boards Manager -> install "esp32 by Espressif".  Board: "ESP32 Dev Module".
 *   2. Library Manager -> install:
 *        "ESP32-audioI2S" by schreibfaul1
 *        "ArduinoJson"    by Benoit Blanchon
 *   3. Fill in the CONFIG below, then Upload.
 *
 * The KEY below is your device secret. Keep it private; anyone with it can
 * make the box talk. (Re-generate it on the server if it ever leaks.)
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "Audio.h"

// ─────────────── CONFIG — fill these in ───────────────
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// The store server (leave as-is unless the project changes):
const char* SERVER    = "https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1";
// Your device secret (from the shop's setup):
const char* KEY       = "42954b016bb1f98a18710d406de4c6b8";
// Announcement language: "en" or "hi"
const char* LANG      = "en";
// Volume 0..21
const int   VOLUME    = 21;
// How often to check for a new payment (milliseconds)
const unsigned long POLL_MS = 4000;
// ──────────────────────────────────────────────────────

// I2S pins to the MAX98357A
#define I2S_LRC   25
#define I2S_BCLK  26
#define I2S_DOUT  22

Audio audio;
String lastId = "";
bool   primed = false;          // ignore the payment that existed before power-on
unsigned long lastPoll = 0;

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Wi-Fi connecting");
  while (WiFi.status() != WL_CONNECTED) { delay(400); Serial.print("."); }
  Serial.println(" connected: " + WiFi.localIP().toString());
}

// Speak a URL (the server streams an MP3). Blocks the poll only in the sense
// that we don't start a new announcement while one is playing.
void play(const String& url) {
  Serial.println("PLAY " + url);
  audio.connecttohost(url.c_str());
}

void announceAmount(long amount) {
  play(String(SERVER) + "/soundbox-tts?key=" + KEY + "&lang=" + LANG + "&amt=" + String(amount));
}
void announceReady() {
  play(String(SERVER) + "/soundbox-tts?key=" + KEY + "&lang=" + LANG + "&say=ready");
}

// Ask the server for the latest paid collection. Returns its id ("" on error),
// and writes the amount into outAmount.
String pollLatest(long& outAmount) {
  WiFiClientSecure client;
  client.setInsecure();                       // skip cert pinning (fine for this)
  HTTPClient http;
  String id = "";
  String url = String(SERVER) + "/soundbox-poll?key=" + KEY;
  if (http.begin(client, url)) {
    int code = http.GET();
    if (code == 200) {
      String body = http.getString();
      StaticJsonDocument<256> doc;
      if (deserializeJson(doc, body) == DeserializationError::Ok) {
        id = String((const char*)(doc["id"] | ""));
        outAmount = (long)(doc["amount"] | 0);
      }
    } else {
      Serial.printf("poll HTTP %d\n", code);
    }
    http.end();
  }
  return id;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(LED_BUILTIN, OUTPUT);
  connectWifi();

  audio.setPinout(I2S_BCLK, I2S_LRC, I2S_DOUT);
  audio.setVolume(VOLUME);

  // Confirm it's alive.
  announceReady();
}

void loop() {
  audio.loop();  // must run continuously for smooth playback

  // Keep Wi-Fi up.
  if (WiFi.status() != WL_CONNECTED) { connectWifi(); }

  // Don't start a new check while a voice line is still playing.
  if (!audio.isRunning() && millis() - lastPoll > POLL_MS) {
    lastPoll = millis();
    long amount = 0;
    String id = pollLatest(amount);
    if (id.length() > 0) {
      digitalWrite(LED_BUILTIN, HIGH);
      if (!primed) {
        // First reading after power-on: remember it, but don't announce old money.
        lastId = id;
        primed = true;
      } else if (id != lastId) {
        lastId = id;
        Serial.printf("NEW PAYMENT: Rs %ld\n", amount);
        announceAmount(amount);
      }
      digitalWrite(LED_BUILTIN, LOW);
    }
  }
}

// Optional: log playback lifecycle to the Serial Monitor.
void audio_info(const char* info) { Serial.print("audio: "); Serial.println(info); }
