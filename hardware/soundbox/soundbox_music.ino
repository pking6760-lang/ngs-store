/*
 * NGS Store — Soundbox: Bluetooth MUSIC + payment announcements (ALL-IN-ONE)
 * =========================================================================
 * ★ THIS IS THE ONLY FILE YOU NEED TO FLASH. ★  One flash = everything:
 *     • Bluetooth speaker (music with real bass through the TPA3116 2.1 amp)
 *     • Automatic payment announcements (speaks the amount on every Collect QR)
 *     • A spoken self-test on power-up — it says "ready" the moment it boots,
 *       so you instantly know the wiring is correct. No second file, no
 *       two-step flashing.
 *
 * The box appears in your phone's Bluetooth list as "NGS Soundbox". Pair it and
 * play music; when a payment lands it ducks the music, speaks the amount, then
 * the music resumes on its own.
 *
 * If it ever reboots or stutters, open Serial Monitor (115200) and send me the
 * output — everything below is software-only, so the fix is in here.
 *
 * HARDWARE (same as the guide)
 *   ESP32-WROOM-32  →  PCM5102A I2S DAC  →  TPA3116D2 2.1 amp  →  speakers
 *   DAC:  BCK=GPIO26  LCK=GPIO25  DIN=GPIO22  ·  SCK→GND  ·  XSMT→3V3
 *
 * ARDUINO IDE
 *   Board:  "ESP32 Dev Module"
 *   Tools → Partition Scheme:  "Huge APP (3MB No OTA/1MB SPIFFS)"   ← REQUIRED
 *   Libraries (Manage Libraries…):
 *     - "ESP32-A2DP"      by pschatzmann     (Bluetooth audio)
 *     - "ESP32-audioI2S"  by schreibfaul1    (streams the voice line)
 *     - "ArduinoJson"     by Benoit Blanchon
 *
 * How music + voice share one DAC:
 *   The ESP32 has one I2S output. Bluetooth music owns it by default. When a
 *   payment arrives we hand I2S over to the voice player for a couple of
 *   seconds, then hand it back to Bluetooth (which auto-reconnects to your
 *   phone, so music resumes on its own).
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "BluetoothA2DPSink.h"
#include "Audio.h"
#include "driver/i2s.h"

// ─────────────── CONFIG — fill these in ───────────────
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// Name your phone will see in its Bluetooth list:
const char* BT_NAME   = "NGS Soundbox";
// The store server (leave as-is):
const char* SERVER    = "https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1";
// Your device secret (already set for your shop):
const char* KEY       = "42954b016bb1f98a18710d406de4c6b8";
// Announcement language: "en" or "hi"
const char* LANG      = "en";
// Voice loudness 0..21
const int   VOICE_VOL = 21;
// How often to check for a new payment (ms)
const unsigned long POLL_MS = 4000;
// ──────────────────────────────────────────────────────

// I2S pins to the PCM5102A DAC
#define I2S_BCLK  26
#define I2S_LRC   25
#define I2S_DOUT  22

BluetoothA2DPSink a2dp;
Audio audio;

String lastId = "";
bool   primed = false;
unsigned long lastPoll = 0;

// ---- helpers -------------------------------------------------------------
String ttsUrl(const String& q) {
  return String(SERVER) + "/soundbox-tts?key=" + KEY + "&lang=" + LANG + "&" + q;
}

// Play one MP3 URL to the very end, blocking. I2S must be free (Bluetooth
// stopped) before calling this.
void playBlocking(const String& url) {
  Serial.println("VOICE " + url);
  audio.connecttohost(url.c_str());
  unsigned long t0 = millis();
  while (!audio.isRunning() && millis() - t0 < 5000) { audio.loop(); delay(1); }
  while (audio.isRunning()) { audio.loop(); }
  audio.stopSong();
}

// Hand I2S from Bluetooth → voice player, speak "<chime> <amount>", hand back.
void announce(long amount) {
  bool wasConnected = a2dp.is_connected();
  Serial.printf("PAYMENT Rs %ld — ducking music\n", amount);

  a2dp.end(false);               // stop BT audio, release I2S + BT stack (keep memory)
  delay(120);
  i2s_driver_uninstall(I2S_NUM_0); // make 100% sure I2S is free for the voice player

  audio.setPinout(I2S_BCLK, I2S_LRC, I2S_DOUT);
  audio.setVolume(VOICE_VOL);
  playBlocking(ttsUrl("say=chime"));
  playBlocking(ttsUrl("amt=" + String(amount)));

  i2s_driver_uninstall(I2S_NUM_0); // release again before Bluetooth takes it back
  delay(80);

  startBluetooth();              // reinstall BT + I2S; auto-reconnects the phone
  (void)wasConnected;
}

// ---- Bluetooth speaker ---------------------------------------------------
void startBluetooth() {
  i2s_pin_config_t pins = {
    .mck_io_num  = I2S_PIN_NO_CHANGE,
    .bck_io_num  = I2S_BCLK,
    .ws_io_num   = I2S_LRC,
    .data_out_num= I2S_DOUT,
    .data_in_num = I2S_PIN_NO_CHANGE
  };
  a2dp.set_pin_config(pins);
  a2dp.set_auto_reconnect(true); // reconnect the last phone so music resumes
  a2dp.start(BT_NAME);
  Serial.println("Bluetooth ready: " + String(BT_NAME));
}

// ---- Wi-Fi + poll --------------------------------------------------------
void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Wi-Fi connecting");
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) { delay(400); Serial.print("."); }
  Serial.println(WiFi.status() == WL_CONNECTED ? (" ok " + WiFi.localIP().toString()) : " (will retry)");
}

// Latest paid collection id ("" on error); amount written to outAmount.
String pollLatest(long& outAmount) {
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  String id = "";
  String url = String(SERVER) + "/soundbox-poll?key=" + KEY;
  if (http.begin(client, url)) {
    int code = http.GET();
    if (code == 200) {
      StaticJsonDocument<256> doc;
      if (deserializeJson(doc, http.getString()) == DeserializationError::Ok) {
        id = String((const char*)(doc["id"] | ""));
        outAmount = (long)(doc["amount"] | 0);
      }
    } else Serial.printf("poll HTTP %d\n", code);
    http.end();
  }
  return id;
}

// Spoken self-test, played BEFORE Bluetooth grabs I2S. If you hear "ready" on
// power-up, the DAC + amp + speaker wiring is all correct.
void announceReadyBoot() {
  audio.setPinout(I2S_BCLK, I2S_LRC, I2S_DOUT);
  audio.setVolume(VOICE_VOL);
  playBlocking(ttsUrl("say=chime"));
  playBlocking(ttsUrl("say=ready"));
  i2s_driver_uninstall(I2S_NUM_0);   // release I2S so Bluetooth can take it
  delay(80);
}

// ---- setup / loop --------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(300);
  connectWifi();       // Wi-Fi first, then Bluetooth (they coexist on the ESP32)
  announceReadyBoot(); // spoken "ready" self-test — proves the wiring works
  startBluetooth();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();

  if (millis() - lastPoll > POLL_MS) {
    lastPoll = millis();
    long amount = 0;
    String id = pollLatest(amount);
    if (id.length() > 0) {
      if (!primed) { lastId = id; primed = true; }   // ignore money paid before power-on
      else if (id != lastId) { lastId = id; announce(amount); }
    }
  }
}

// Serial log of Bluetooth/stream events (optional)
void audio_info(const char* info) { Serial.print("audio: "); Serial.println(info); }
