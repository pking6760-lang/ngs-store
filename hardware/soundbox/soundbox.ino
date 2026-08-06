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
 * HARDWARE (the 2.1 music-grade build)
 *   - ESP32 dev board (ESP32-WROOM-32)
 *   - PCM5102A I2S DAC  (clean line-level audio out)
 *   - TPA3116D2 2.1 amplifier  (2x satellites + 1 subwoofer)
 *   - 2x 3" + 1x 4" 4ohm speakers
 *   - 3S 18650 battery + BMS + USB-C boost charger + fixed-5V USB buck
 *
 * WIRING (ESP32 -> PCM5102A DAC)
 *   VIN  -> 5V (VIN)          GND  -> GND
 *   LCK  -> GPIO 25           BCK  -> GPIO 26
 *   DIN  -> GPIO 22
 *   SCK  -> GND   <-- IMPORTANT: tie the DAC's SCK pin to GND (internal PLL)
 *   XSMT -> 3.3V  <-- IMPORTANT: hold high or the DAC stays muted (no sound)
 *   FLT / DEMP / FMT -> GND
 *   DAC  LOUT/ROUT/AGND  -> TPA3116 audio-in  L / R / GND
 *   TPA3116 speaker outs -> L 3", R 3", SUB 4"  (keep +/- polarity)
 *
 * Same GPIO 25/26/22 pins as a MAX98357A, so this firmware drives either.
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
// How often to check for a new payment (milliseconds). Lower = the box speaks
// sooner after a payment; 2s keeps it snappy without hammering the server.
const unsigned long POLL_MS = 2000;
// ──────────────────────────────────────────────────────

// I2S pins to the MAX98357A
#define I2S_LRC   25
#define I2S_BCLK  26
#define I2S_DOUT  22

Audio audio;
String lastId = "";
bool   primed = false;          // ignore the payment that existed before power-on
unsigned long lastPoll = 0;
String pendingVoice = "";       // played right after the chime finishes

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

String ttsUrl(const String& q) {
  return String(SERVER) + "/soundbox-tts?key=" + KEY + "&lang=" + LANG + "&" + q;
}
// Play the chime first, then the voice line once the chime stream ends.
void chimeThen(const String& voiceUrl) {
  pendingVoice = voiceUrl;
  play(ttsUrl("say=chime"));
}
void announceAmount(long amount) { chimeThen(ttsUrl("amt=" + String(amount))); }
void announceReady()            { chimeThen(ttsUrl("say=ready")); }

// The audio library calls this when a stream finishes — chain the voice after
// the chime.
void audio_eof_stream(const char* info) {
  (void)info;
  if (pendingVoice.length() > 0) {
    String u = pendingVoice;
    pendingVoice = "";
    play(u);
  }
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
