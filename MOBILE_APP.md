# NGS Store — two apps (Customer + Admin), Android & iOS

NGS Store is now **two separate native apps** that share one database:

| App | Who uses it | App ID | Folder |
|---|---|---|---|
| **NGS Store** | Customers — browse, cart, order, track | `com.ngsstore.app` | repo root |
| **NGS Store Admin** | You — orders, products, prices, customers, receipts | `com.ngsstore.admin` | `admin/` |

Both are built with [Capacitor](https://capacitorjs.com/) (the same React code runs
inside a native shell), so each ships to Android **and** iOS.

## How the two apps are connected

They talk to the **same Supabase database** through the shared module
`shared/core.js`. There is no separate server to run — the connection is the
database:

```
   Customer app  ─┐                        ┌─  Admin app
   (places order) ├──►  Supabase tables  ◄──┤  (sees order in seconds,
   (sees price/    │   orders, products,    │   changes price / status,
    store updates) ┘   customers, charges,  └   opens/closes store)
                       settings
```

- Customer places an order → it appears in the Admin **Orders** tab within ~4 seconds.
- Admin adds/edits a product, changes a price, adds a delivery charge, or flips
  **Store Open/Closed** → every customer's app reflects it on the next refresh.

Both apps poll the database every 4 seconds, so they stay in sync automatically.

## Project layout

```
shared/core.js          ← shared: Supabase db, UPI, formatting, search, styles
src/                    ← CUSTOMER app source (React)
index.html, vite.config.js, capacitor.config.json
android/  ios/          ← CUSTOMER native projects
admin/
  src/                  ← ADMIN app source (React)
  index.html, vite.config.js, capacitor.config.json
  android/  ios/        ← ADMIN native projects
package.json            ← one place for all build scripts (shared node_modules)
```

## Admin login

The admin app opens to a password screen. The password is **`Nkm@92056`**.
Only the SHA-256 hash of it is stored in the code — and it is no longer present
anywhere in the customer app. After 3 wrong tries the admin app shows a decoy
"nothing here" screen and locks out for 30 minutes. On phones/browsers that
support it, you can also enable fingerprint/face unlock from the dashboard.

## Everyday workflow

You edit `src/` (customer) or `admin/src/` (admin). To push changes into the apps:

```bash
npm install            # one time

# Customer app
npm run sync           # build + copy web assets into android/ & ios/
npm run android        # build, sync, open Android Studio
npm run ios            # build, sync, open Xcode (macOS only)

# Admin app
npm run sync:admin
npm run android:admin
npm run ios:admin
```

## Building installable Android APKs

You need the **Android SDK** (installed with Android Studio):

```bash
npm run build:apk         # customer  → android/app/build/outputs/apk/debug/app-debug.apk
npm run build:apk:admin   # admin     → admin/android/app/build/outputs/apk/debug/app-debug.apk
```

Copy an APK to a phone and tap to install (enable "install unknown apps" for your
file manager first). Because the two apps have **different App IDs**, they install
side by side — a customer's phone can have just NGS Store, and your phone can have
both. For the Play Store, build a signed **release bundle** in Android Studio
(*Build → Generate Signed Bundle / APK → Android App Bundle*).

> Ready-to-install debug APKs for **both** apps were delivered alongside this
> change, so you can test on an Android phone right away.

## Building the iOS apps

iOS builds **require a Mac with Xcode** (Apple's rule):

```bash
npm run ios         # customer — opens Xcode
npm run ios:admin   # admin — opens Xcode
```

In Xcode: set your Apple Developer team under *Signing & Capabilities*, pick a
device/simulator, Run. To publish, *Product → Archive* → upload to App Store
Connect / TestFlight. (Requires an Apple Developer account, $99/yr.)

## Native permissions configured

| Feature | Customer | Admin |
|---|---|---|
| Internet / Supabase sync | ✅ | ✅ |
| Location (delivery "use my location") | ✅ | — |
| Camera (barcode scanner) | — | ✅ |
| Bluetooth (thermal receipt printer) | — | ✅ |

UPI deep links (`upi://…`) open Google Pay / PhonePe / Paytm, and "Open in
Google Maps" links open the system maps app — both work natively.

## Known platform differences (graceful fallbacks)

- **Fingerprint/Face admin unlock (WebAuthn):** works in the browser/PWA but not
  inside the native WebView — the admin app falls back to password login there.
- **New-order notifications & Bluetooth printing** rely on web APIs that are
  limited inside the native shell. For fully reliable native behaviour, add
  `@capacitor/push-notifications` and a Bluetooth-printer plugin later.
- **Barcode scanner** uses the web `BarcodeDetector` API (most Android WebViews);
  on iOS it falls back to manual barcode entry.

Both apps also still run as plain websites / PWAs (`npm run dev`, `npm run dev:admin`).
