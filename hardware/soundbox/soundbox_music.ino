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
 * ─── SETTING / CHANGING WI-FI (from your phone — no computer, no re-flashing) ──
 *   • First time: the box makes its OWN Wi-Fi hotspot called "NGS Soundbox
 *     Setup". On your phone, connect to it (password 12345678). A page opens by
 *     itself — pick your Wi-Fi (or hotspot) and type its password. Done. It's
 *     saved permanently, even after power-off.
 *   • Using a phone hotspot? Just make sure your hotspot's name & password stay
 *     the same each time — the box reconnects on its own, nothing to redo.
 *   • Moving to a NEW network later? Two easy ways, both WITHOUT opening the box:
 *       (a) turn off the old network, power-cycle the box → the setup hotspot
 *           re-opens by itself, pick the new Wi-Fi; or
 *       (b) hold the BOOT button while switching the box on → setup re-opens.
 *   You never edit code or re-flash to change Wi-Fi again.
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
 *     - "WiFiManager"     by tzapu           (set Wi-Fi from your phone)
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
#include <WiFiManager.h>          // phone-based Wi-Fi setup (no re-flashing)
#include "BluetoothA2DPSink.h"
#include "Audio.h"
#include "driver/i2s.h"

// ─────────────── CONFIG ───────────────
// Wi-Fi is NOT typed here — you set it from your phone (see SETUP notes at the
// top), so you never open the box or re-flash to change networks.

// Name your phone will see in its Bluetooth list (for playing music):
const char* BT_NAME       = "NGS Soundbox";
// The Wi-Fi SETUP hotspot: connect your phone to this to choose your Wi-Fi.
const char* SETUP_AP_NAME = "NGS Soundbox Setup";
const char* SETUP_AP_PASS = "12345678";   // password to open the setup page
// The store server (leave as-is):
const char* SERVER    = "https://wvlkhvqohkkxlatwotvy.supabase.co/functions/v1";
// Your device secret (already set for your shop):
const char* KEY       = "42954b016bb1f98a18710d406de4c6b8";
// Announcement language: "en" or "hi"
const char* LANG      = "en";
// Voice loudness 0..21
const int   VOICE_VOL = 21;
// How often to check for a new payment (ms). Lower = the box speaks sooner
// after a payment; 2s keeps it snappy without hammering the server.
const unsigned long POLL_MS = 2000;
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

// ---- Wi-Fi (set from your phone, never re-flashed) + poll ----------------
// First boot, or whenever it can't find a saved network, the box makes its own
// hotspot "NGS Soundbox Setup". Connect your phone to it, a page opens, pick
// your Wi-Fi and type the password — saved forever. Hold BOOT at power-on to
// re-open setup and switch to a different network.
void setupWifi() {
  pinMode(0, INPUT_PULLUP);            // BOOT button on the ESP32 board
  WiFiManager wm;
  wm.setConfigPortalTimeout(180);      // give up after 3 min so music still works
  bool held = (digitalRead(0) == LOW); // BOOT held at power-on = "change my Wi-Fi"
  if (held) {
    Serial.println("BOOT held — opening Wi-Fi setup hotspot");
    wm.startConfigPortal(SETUP_AP_NAME, SETUP_AP_PASS);
  } else {
    wm.autoConnect(SETUP_AP_NAME, SETUP_AP_PASS);
  }
  Serial.println(WiFi.status() == WL_CONNECTED
                 ? ("Wi-Fi ok " + WiFi.localIP().toString())
                 : "Wi-Fi not set yet (music still works)");
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
  setupWifi();         // set Wi-Fi from your phone (no re-flashing, ever)
  announceReadyBoot(); // spoken "ready" self-test — proves the wiring works
  startBluetooth();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) WiFi.reconnect();  // quiet retry; won't stop music

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
