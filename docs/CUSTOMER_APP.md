# NGS Store — Customer app (Android + iOS)

The customer storefront (the same app served at ngsstore.in) is packaged as a
native app with **Capacitor**. It has its own app id — `com.ngsstore.customer`
— so it installs alongside the Admin (`com.ngsstore.admin`) and Partner
(`com.ngsstore.partner`) apps.

The web bundle is built by `vite.config.customer.js` into **`www-customer/`**
(relative asset paths, so it loads inside the native WebView).

---

## Build the web bundle

```bash
npm run build:customer      # → www-customer/ (index.html = customer storefront)
```

---

## Android

The Android project lives in **`android-customer/`** (cloned from the admin
shell, re-pointed to `com.ngsstore.customer`, green launcher icon).

Rebuild the APK after any code change:

```bash
npm run build:customer
# copy the fresh web bundle into the Android project
rm -rf android-customer/app/src/main/assets/public
cp -r www-customer/* android-customer/app/src/main/assets/public/
# build the debug APK
cd android-customer && gradle assembleDebug
# → android-customer/app/build/outputs/apk/debug/app-debug.apk
```

Bump `versionCode`/`versionName` in `android-customer/app/build.gradle` for each
release. The debug APK is installable directly (enable "install from unknown
sources"). For Play Store, wire a release keystore + `signingConfig` (see the
note on signing below).

> Push notifications: the customer project ships **without** a
> `google-services.json` (the admin one wouldn't match the new app id). To turn
> on FCM push, create a `com.ngsstore.customer` app in Firebase, drop its
> `google-services.json` into `android-customer/app/`, and the
> google-services plugin auto-activates.

---

## iOS  (must be built on a Mac with Xcode)

iOS apps can only be compiled on **macOS with Xcode + CocoaPods** — they cannot
be built on Linux/CI-without-macOS. Do this once on a Mac:

```bash
# 1. Point Capacitor at the customer bundle for the iOS add/sync.
#    (Temporarily, so it doesn't disturb the admin config.)
cp capacitor.config.json capacitor.config.admin.bak.json
cat > capacitor.config.json <<'JSON'
{ "appId": "com.ngsstore.customer", "appName": "NGS Store", "webDir": "www-customer" }
JSON

# 2. Build the web bundle and add + sync the iOS platform.
npm run build:customer
npx cap add ios
npx cap sync ios

# 3. Restore the admin config (so `npm run sync:android` keeps building admin).
mv capacitor.config.admin.bak.json capacitor.config.json

# 4. Open in Xcode, set your Team (signing), pick a device/simulator, Run/Archive.
npx cap open ios
```

In Xcode:
- **Signing & Capabilities** → select your Apple Developer **Team** (a paid
  Apple Developer account is required to run on a real device / submit to the
  App Store).
- Set the **Display Name** to `NGS Store` and confirm the **Bundle Identifier**
  is `com.ngsstore.customer`.
- Add the green app icon in **Assets.xcassets → AppIcon** (use
  `public/icon-1024.png` / the green NGS mark).
- **Product → Archive** → Distribute App → App Store Connect (or Ad Hoc for
  testing).

After the first setup, every code change is just:
`npm run build:customer && npx cap sync ios` (with the customer config active).

---

## App identities

| App      | app id                  | project           | icon   |
|----------|-------------------------|-------------------|--------|
| Customer | `com.ngsstore.customer` | `android-customer/` + `ios/` | green  |
| Admin    | `com.ngsstore.admin`    | `android/`        | indigo |
| Partner  | `com.ngsstore.partner`  | `android-partner/`| dark red |
