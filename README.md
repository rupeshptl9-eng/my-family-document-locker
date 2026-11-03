# My Family Document Locker

A secure, private, offline-first family document locker application built with React, TypeScript, Tailwind CSS, Capacitor Android, Web Crypto API (AES-256-GCM + PBKDF2), Firebase, and Google Drive API.

---

## Google Drive Backup & Restore Setup

This application integrates official Google Drive API support for zero-knowledge, client-side encrypted vault backups (`.mfdbackup`).

### 1. Google Cloud Project Setup
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Select your Google Cloud project (e.g., `gen-lang-client-0225943937`).
3. Ensure billing is enabled if using production quotas.

### 2. Enable Google Drive API
1. Navigate to **APIs & Services** > **Library**.
2. Search for **Google Drive API**.
3. Click **Enable**.

### 3. Configure OAuth Consent Screen
1. Go to **APIs & Services** > **OAuth consent screen**.
2. Select **User Type** (External or Internal).
3. Fill in App Information:
   - App Name: `My Family Document Locker`
   - User support email
   - Developer contact email
4. Add Scopes:
   - Add the minimum required Drive scope:
     `https://www.googleapis.com/auth/drive.file`
   *(Do NOT request full `drive` scope; `drive.file` restricts access only to files created by this application).*
5. Add test users if in "Testing" publishing status.

### 4. Configure OAuth Client
#### Web Application Client
1. Go to **APIs & Services** > **Credentials** > **Create Credentials** > **OAuth client ID**.
2. Select Application Type: **Web application**.
3. Add Authorized JavaScript Origins:
   - Development: `http://localhost:3000`
   - Production / Hosted URL: `https://<YOUR_APP_DOMAIN>`
4. Add Authorized Redirect URIs:
   - Development: `http://localhost:3000`
   - Firebase Auth domain: `https://<YOUR_FIREBASE_PROJECT_ID>.firebaseapp.com/__/auth/handler`

#### Android Client
1. In Credentials, click **Create Credentials** > **OAuth client ID**.
2. Select Application Type: **Android**.
3. Package Name: `com.rupesh.myfamilyvault` (from `android/app/build.gradle`).
4. SHA-1 Fingerprint: Retrieve via `./gradlew signingReport` in the `android/` directory.

### 5. Android Configuration (Capacitor)
1. Verify Android package name in `capacitor.config.ts`:
   ```ts
   appId: 'com.rupesh.myfamilyvault',
   appName: 'My Family Document Locker',
   ```
2. Run Capacitor Android sync:
   ```bash
   npm run build
   npx cap sync android
   ```
3. Open in Android Studio:
   ```bash
   npx cap open android
   ```

### 6. Required Scopes
- `https://www.googleapis.com/auth/drive.file`: Allows the app to create the `My Family Document Locker/Backups` folder and read/write `.mfdbackup` files created by this app.

### 7. Security Architecture
- **Zero Plaintext Cloud Upload**: All documents, family profiles, and notes are encrypted client-side using **AES-256-GCM** with keys derived using **PBKDF2-SHA256 (100,000 iterations)**.
- **In-Memory Token Cache**: Access tokens are kept in memory only and never stored in `localStorage`, `sessionStorage`, or logs.
- **Biometric Hardware Unlock**: Native Android fingerprint and facial recognition via `@aparajita/capacitor-biometric-auth` with fallback to PIN.

### 8. Testing Instructions
1. **Connect Google Drive**:
   - Go to **Settings** > **Cloud Backup • Google Drive**.
   - Click **Connect Google Drive**.
   - Grant permission for Google Drive file management.
   - Status updates to `Google Drive Connected`.
2. **Backup to Google Drive**:
   - Click **Backup Now**.
   - Enter your backup encryption password (minimum 6 characters).
   - Watch the progress steps: Preparing -> Encrypting -> Uploading -> Verifying.
   - Confirm file `MFDL-Backup-YYYY-MM-DD-HH-mm.mfdbackup` is uploaded to `My Family Document Locker/Backups/`.
3. **Restore from Google Drive**:
   - Click **Restore from Google Drive**.
   - Select your backup from the list.
   - Enter your password to decrypt & preview contents.
   - Choose restore mode: **Merge** (safe, non-destructive) or **Replace** (full overwrite with confirmation).
   - Confirm and verify vault data is loaded.
4. **Android Biometric Unlock**:
   - Lock vault or reopen app.
   - Tap fingerprint icon to invoke native Android Biometric prompt.
   - Confirm vault unlocks; or cancel to verify PIN keypad fallback.
