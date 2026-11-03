# Changelog — My Family Document Locker

## [Fix Release] — Upload reliability & Cloud AI fixes

Primary bug addressed: **"File upload nahi ho rahi"** — documents frequently failed to
save to the locker. Root cause was that every upload was blocked behind OCR/AI extraction,
which threw and aborted the whole flow when the OCR engine or cloud model failed. Several
secondary issues made cloud sync unreliable too. All items below are now fixed.

---

### Fix #1 — Plain upload decoupled from OCR  (PRIMARY)
**File:** `src/components/ScanModal.tsx`
- `handleProceed()` now runs OCR/AI extraction **only** when the user explicitly chose an
  AI scan (`isAiScan === true`).
- A plain "Add Document" upload skips OCR and goes straight to the verify screen with a
  minimal manual-entry object (docName from filename, docType `Other`, confidence 0).
- If AI extraction fails during an AI scan, the upload is **not** aborted — it falls back to
  manual entry and shows a non-blocking notice: *"AI could not read this file. Please fill
  in the details manually."*

### Fix #2 — OCR / preprocessing failures made non-fatal
**Files:** `src/services/aiRouter.ts`, `src/services/localAiPlugin.ts`
- `preprocessImageForOCR()` is now wrapped in try/catch; on failure the router continues
  with a no-op preprocessed object instead of throwing.
- `scanDocument()` is now guaranteed to **never throw** — a last-resort catch returns safe,
  low-confidence manual-entry fields.
- OCR and cloud paths run only when real image bytes are available.
- `localAiPlugin.runLocalDocumentAI()` web (Tesseract) branch now returns an empty result
  (`confidence: 0`) on failure instead of throwing.

### Fix #3 — Corrected invalid Gemini model name
**Files:** `server.ts`, `.env.example`
- Replaced the non-existent model `gemini-3.8-flash` (4 references) with a configurable
  `GEMINI_MODEL`, defaulting to `gemini-2.0-flash`.
- Documented the new `GEMINI_MODEL` env var in `.env.example`.

### Fix #4 — Fixed GoogleGenAI initialization
**File:** `server.ts`
- `new GoogleGenAI()` → `new GoogleGenAI({ apiKey: GEMINI_API_KEY })` (SDK requires an
  explicit apiKey; the empty constructor left the client unauthenticated).
- Added a placeholder guard: empty / `YOUR_...` / `changeme` / `<...>` keys disable Cloud AI
  gracefully and fall back to offline mode instead of crashing.

### Fix #5 — Clear cloud-vs-device save status
**Files:** `src/services/documentService.ts`, `src/services/storageService.ts`
- Local-vault users (not signed in with Google) no longer trigger a misleading "sync failed"
  message — device-only storage is now communicated as intended behaviour:
  *"Saved to this device. Sign in with Google to enable encrypted cloud backup."*
- Signed-in-but-offline users get: *"Saved on device. Cloud sync will resume automatically
  when you are back online."* and are queued for retry.
- `storageService` now skips the Firebase Storage attempt entirely for local-only users
  (it would always be permission-denied) and goes straight to the encrypted IndexedDB
  blob fallback, logging a single `console.info` instead of a warning.

### Fix #6 — Large images preserved across devices
**File:** `src/services/documentService.ts`
- Previously any data URL > 200 KB was discarded (`fileUrl = ''`), so large images never
  synced to other devices.
- Now the fileUrl is only stripped when it is a large inline `data:` URL **and** there is no
  Firebase Storage path. When the binary was uploaded to Storage, the short https download
  URL is stored in Firestore so it syncs correctly.

---

### Files changed
- `src/components/ScanModal.tsx`
- `src/services/aiRouter.ts`
- `src/services/localAiPlugin.ts`
- `src/services/documentService.ts`
- `src/services/storageService.ts`
- `server.ts`
- `.env.example`

### Build notes (APK)
1. `npm install` (or `bun install`)
2. `npm run build`
3. `npx cap sync android`
4. `npx cap open android` → Build > Build APK(s)  (or `cd android && ./gradlew assembleDebug`)

Before building:
- Copy `.env.example` → `.env` and set a real `GEMINI_API_KEY` (optional — app now runs
  safely offline without it).
- Fill Firebase config for cloud sync (optional — local encrypted vault works without it).
- Release APK requires an Android signing keystore.

---

## [Fix Release 2] — Security hardening + UI / Animation polish

### Fix #7 — Removed weak hardcoded default vault key  (SECURITY, HIGH)
**File:** `src/services/vaultKeyManager.ts`
- `ensureUnlocked()` previously derived the fallback encryption key from a hardcoded
  PIN `'0000'` and a fixed public salt — effectively reversible by anyone.
- Now derives the device-fallback key from a per-device **cryptographically-random**
  secret + random salt (generated once, persisted locally). No longer predictable.
  A real user PIN still replaces this via `setVaultKey()`.

### Fix #8 — Stronger key derivation  (SECURITY)
**File:** `src/services/vaultKeyManager.ts`
- PBKDF2-SHA256 iterations raised from 100,000 → **600,000** (current OWASP guidance),
  applied to both key derivation and the PIN verifier. Added `PBKDF2_ITERATIONS` constant.

### Fix #9 — Animation system completed & polished  (UI)
**File:** `src/index.css`
- `animate-fadeIn` and `animate-slideUp` were used across every modal / bottom sheet but
  were **never defined** (not Tailwind built-ins) — modals popped in with no transition.
  Both are now defined with smooth easing.
- Added a full animation toolkit: `animate-scaleIn`, `animate-slideDown`, `animate-popIn`,
  `animate-floaty`, `animate-celebrate`, `.skeleton` shimmer, `.press-scale`, `.focus-ring`.
- All respect the existing `prefers-reduced-motion` block.

### Fix #10 — Smooth modal entrances  (UI)
**Files:** `ScanModal.tsx`, `AIScanVerifyModal.tsx`, `PinLockModal.tsx`, `EditDocumentModal.tsx`
- Centered modal panels now use `animate-scaleIn` so the content springs in gently instead
  of appearing instantly on top of the faded overlay. Bottom sheets (AddBottomSheet,
  NotificationDrawer) already use the now-defined `animate-slideUp`.

### Files changed (Release 2)
- `src/services/vaultKeyManager.ts`
- `src/index.css`
- `src/components/ScanModal.tsx`
- `src/components/AIScanVerifyModal.tsx`
- `src/components/PinLockModal.tsx`
- `src/components/EditDocumentModal.tsx`

---

## [Fix Release 3] — Sync & storage reliability

### Fix #11 — Sync queue retry/backoff + dead-letter  (RELIABILITY)
**Files:** `src/services/documentService.ts`, `src/services/encryptedIndexedDBService.ts`
- `processOfflineSyncQueue()` previously retried every failed item on every pass forever,
  never incrementing `retryCount` — a permanently failing item looped indefinitely.
- Added **exponential backoff with jitter** (2^retry seconds, capped at 1 hour) via a new
  `nextAttemptAt` field; items are skipped until their backoff window elapses.
- Added a **max-retry budget** (6 attempts); exhausted items are dropped from the queue
  (dead-letter) instead of looping. Unknown entity types are also removed so they can't
  block the queue.
- New `encryptedIndexedDBService.updateSyncItemRetry()` persists retry metadata.

### Fix #12 — IndexedDB storage-quota handling  (RELIABILITY / UX)
**Files:** `src/services/encryptedIndexedDBService.ts`, `src/components/AIScanVerifyModal.tsx`
- `putEncryptedItem()` now detects `QuotaExceededError` and throws a clear, actionable
  error instead of failing silently, so a full device vault is surfaced to the user.
- Added `getStorageUsageRatio()` (uses the StorageManager API) to estimate vault usage.
- The verify modal cleans the internal `STORAGE_QUOTA_EXCEEDED:` marker into a friendly
  message: *"Your device vault storage is full. Free up space or enable cloud backup…"*

### Files changed (Release 3)
- `src/services/documentService.ts`
- `src/services/encryptedIndexedDBService.ts`
- `src/components/AIScanVerifyModal.tsx`

---

## [Fix Release 4] — Automated tests

### Fix #13 — Unit tests for document classifier & file validation  (QUALITY)
**New files:** `src/services/documentClassifier.test.ts`, `src/utils/imageUtils.test.ts`,
`vitest.config.ts`
- Added Vitest. `npm run test` (CI/one-shot) and `npm run test:watch` (dev).
- `documentClassifier.test.ts` locks in Indian-ID detection: PAN, Aadhaar (spaced),
  Passport, Voter ID, Driving Licence; plus extractFields shape, low-confidence flags,
  confidence tiers, `safeMatchAll` safety, and `validateAiResult` normalisation.
- `imageUtils.test.ts` covers `validateDocumentFile`: accepted formats, extension-only
  fallback, unsupported type rejection, and the 25 MB size boundary.
- Dev deps added: `vitest`, `jsdom`. Tests run under jsdom for File/Blob/FileReader.

### Files added (Release 4)
- `src/services/documentClassifier.test.ts`
- `src/utils/imageUtils.test.ts`
- `vitest.config.ts`
- `package.json` (test scripts + devDependencies)

---

## [Fix Release 5] — UI polish: stagger + skeleton loaders

### Fix #14 — Staggered card entrance  (UI)
**File:** `src/components/DocumentsScreen.tsx`
- Document cards (both grid and list views) now animate in with `animate-popIn` and a
  staggered `animationDelay` (index * 40ms, capped 400ms) for a smooth cascade instead of
  appearing all at once. Added `press-scale` for tactile touch feedback.

### Fix #15 — Skeleton loaders while the vault decrypts  (UI / UX)
**Files:** `src/App.tsx`, `src/components/DocumentsScreen.tsx`
- Added an `isVaultLoading` state in `App` (true while `loadVaultData` decrypts the vault),
  passed to `DocumentsScreen` as `isLoading`.
- `DocumentsScreen` now shows a 6-card shimmer skeleton grid (using the `.skeleton` class)
  while the encrypted vault loads, instead of a blank screen / flash of empty state.
- Added `aria-busy` / `aria-label` for accessibility.
- Empty-state icon now gently floats (`animate-floaty`).

### Files changed (Release 5)
- `src/App.tsx`
- `src/components/DocumentsScreen.tsx`

---

## [Fix Release 6] — Native-safe Google Sign-In

### Fix #16 — Platform-aware Google Sign-In  (APK AUTH)
**Files:** `src/services/authService.ts`, `capacitor.config.ts`, `package.json`,
`android/app/src/main/res/values/strings.xml`, `SIGN_IN_SETUP.md`
- `signInWithPopup` does not work reliably inside a Capacitor WebView, so native APK
  sign-in used to fail. `signInWithGoogle()` is now platform-aware:
  - **Native** → `@capacitor-firebase/authentication` native flow, then
    `signInWithCredential` to establish the Firebase JS-SDK session.
  - **Web** → `signInWithPopup` with automatic `signInWithRedirect` fallback when the
    popup is blocked; redirect result completed via `getRedirectResult` in
    `onAuthStateChanged`.
- Extracted shared `buildAndSyncProfile()` (de-duplicated the profile/Firestore-sync code
  that was copied between the auth listener and signInWithGoogle).
- Added `@capacitor-firebase/authentication` dependency + Capacitor plugin config
  (`providers: ['google.com']`).
- Added `server_client_id` (web OAuth client ID from google-services.json) to Android
  strings.xml for the native plugin.
- New `SIGN_IN_SETUP.md` documents install, SHA-1, and build steps.

### google-services.json
- Added at `android/app/google-services.json` (project gen-lang-client-0225943937,
  package com.rptechhub.myfamilydocumentlocker — verified match).

### Files changed (Release 6)
- `src/services/authService.ts`
- `capacitor.config.ts`
- `package.json`
- `android/app/src/main/res/values/strings.xml`
- `android/app/google-services.json` (new)
- `SIGN_IN_SETUP.md` (new)

---

## [Fix Release 7] — Crash resilience & bundle size

### Fix #17 — App-wide React Error Boundary  (RELIABILITY)
**Files:** `src/components/ErrorBoundary.tsx` (new), `src/main.tsx`
- A single render/runtime error previously white-screened the whole app. Added an
  `ErrorBoundary` wrapping `<App/>` that catches crashes and shows a friendly glassmorphism
  recovery card ("Something went wrong … your encrypted documents are safe") with a Reload
  button. The encrypted IndexedDB vault is untouched by a UI crash.

### Fix #18 — Lazy-load Tesseract.js  (PERFORMANCE / BUNDLE SIZE)
**File:** `src/services/localAiPlugin.ts`
- `tesseract.js` (large, plus WASM/worker assets) was a static top-level import, pulling it
  into the main bundle even for users who never scan. Converted to a dynamic
  `import('tesseract.js')` loaded only on first OCR use — smaller, faster initial load.

### Files changed (Release 7)
- `src/components/ErrorBoundary.tsx` (new)
- `src/main.tsx`
- `src/services/localAiPlugin.ts`
