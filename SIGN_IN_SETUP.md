# Google Sign-In Setup (Native APK + Web)

The app now uses a **platform-aware** Google Sign-In (`src/services/authService.ts`):

- **Web** → `signInWithPopup`, with automatic `signInWithRedirect` fallback when the
  popup is blocked. The redirect result is completed on next load in `onAuthStateChanged`.
- **Native (Android APK)** → native Google sign-in via
  `@capacitor-firebase/authentication`, then the returned Google credential is exchanged
  for a Firebase JS-SDK session with `signInWithCredential` — so Firestore/Storage rules
  and auth state behave exactly like web.

`signInWithPopup` does **not** work reliably inside a Capacitor WebView, which is why the
native path is required for the APK.

---

## One-time steps to finish native setup

### 1. Install the plugin (already added to package.json)
```bash
npm install
npx cap sync android
```

### 2. Add your SHA-1 fingerprint to Firebase (REQUIRED for native sign-in)
Without this, native Google Sign-In fails with `DEVELOPER_ERROR` (code 10).

```bash
cd android
./gradlew signingReport      # Windows: gradlew signingReport
```
Copy the `SHA1:` value under `Variant: debug` → Firebase Console → Project settings →
your Android app (`com.rptechhub.myfamilydocumentlocker`) → **Add fingerprint** → paste.

Then **re-download `google-services.json`** and replace `android/app/google-services.json`.

> For a Play Store release build, also add the **release keystore** SHA-1 (and, if using
> Play App Signing, the SHA-1 Google shows under Play Console → App integrity).

### 3. Native dependencies (Gradle)
`npx cap sync android` wires the plugin automatically. The web OAuth client ID is already
exposed to native as `server_client_id` in
`android/app/src/main/res/values/strings.xml` (value taken from google-services.json).

### 4. Build the APK
```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
# APK → android/app/build/outputs/apk/debug/app-debug.apk
```

---

## Notes
- If you prefer NOT to use the native plugin, the web popup/redirect path still works in a
  browser; only the packaged APK needs the native plugin.
- Local Encrypted Vault mode works with no Google sign-in at all (offline, device-only).
