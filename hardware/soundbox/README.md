# NGS Payment Soundbox — build guide

A small standalone box that **announces every counter payment out loud** — your
own Paytm/PhonePe-style soundbox, but it speaks *your* NGS payments. When a
customer pays a **Collect-payment QR** in the Admin app, this box says
*"Payment received, 250 rupees"* through its speaker within a few seconds.

It is fully independent of your phone: it has its own Wi-Fi, its own speaker,
and just needs a 5V USB charger for power.

---

## 1. Parts to buy (~₹700–1000 total)

| Part | What to search | Approx ₹ |
|---|---|---|
| **ESP32 dev board** | "ESP32 WROOM DevKit V1" | 350 |
| **I2S amplifier** | "MAX98357A I2S amplifier module" | 150 |
| **Speaker** | "3W 4 ohm speaker 40mm" | 80 |
| **Power** | any 5V phone charger + micro-USB/USB-C cable | 100 |
| Jumper wires (female-female), small box | — | 100 |

You also need a computer with a USB cable to program the ESP32 **once**. After
that, it just needs power.

---

## 2. Wiring (6 wires)

Connect the **MAX98357A amplifier** to the **ESP32**:

```
  MAX98357A        ESP32
  ---------        -----
  VIN  ─────────►  5V (VIN)
  GND  ─────────►  GND
  LRC  ─────────►  GPIO 25
  BCLK ─────────►  GPIO 26
  DIN  ─────────►  GPIO 22
  (GAIN, SD: leave unconnected)

  Speaker  ─────►  the amp's  +  and  −  screw terminals
```

That's it — no soldering needed if you use jumper wires and a speaker with wires.

---

## 3. Program it (one time)

1. Install the **Arduino IDE** (free) on a computer.
2. In Arduino IDE → **File → Preferences → Additional Boards URLs**, add:
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   then **Tools → Board → Boards Manager** → install **esp32 by Espressif**.
   Select board **"ESP32 Dev Module"**.
3. **Tools → Manage Libraries** → install:
   - **ESP32-audioI2S** (by schreibfaul1)
   - **ArduinoJson** (by Benoit Blanchon)
4. Open **`soundbox.ino`** (this folder). At the top, fill in:
   - `WIFI_SSID` and `WIFI_PASS` — your shop Wi-Fi.
   - `LANG` — `"en"` for English or `"hi"` for Hindi.
   - (`SERVER` and `KEY` are already filled in for your shop.)
5. Plug the ESP32 into the computer, pick its port under **Tools → Port**, and
   click **Upload** (→).

When it boots and connects, it will say **"Soundbox is ready."** — that's your
confirmation it's working.

---

## 4. Use it

- Leave the box plugged into power at the counter.
- Take a payment as usual: Admin → **Collect payment** → enter amount → show QR.
- The moment the customer pays, the box announces the amount out loud.

No phone needed at the counter — the box listens on its own.

---

## How it works (for reference)

- The box calls **`/soundbox-poll`** every 4 seconds; it returns the latest paid
  counter collection (id + amount).
- When it sees a *new* id, it plays **`/soundbox-tts?amt=…&lang=…`**, which
  streams a freshly-generated voice MP3 — so any amount works, in either
  language, with nothing stored on the device.
- Both endpoints are locked to your private device **KEY**.

## Security & notes

- The `KEY` is your device secret. Don't share the firmware with the key in it.
  If it leaks, regenerate `SOUNDBOX_KEY` on the server and re-flash the box.
- It announces **counter (QR) payments**. Online delivery orders are not
  announced here (they're not counter sales) — that can be added later.
- If the voice ever stops working, it's almost always Wi-Fi. The onboard LED
  blinks when it successfully reaches the server.
