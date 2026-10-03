# Shipping Mello

Android first. Work top to bottom; each part lists what's done in the repo and what you do in a console.

## 1. Backend (API)
1. **Supabase project.**
   - SQL editor: run `apps/api/sql/001_core.sql`, then `002_supabase.sql`, `003_self.sql` and `004_supabase_self.sql`, in that order, once.
   - Auth: turn on email confirmation and set the site URL.
   - Turn on daily backups (Pro plan) or schedule `pg_dump`.
2. **Host the API.** `apps/api/Dockerfile` builds it from the repo root:
   ```sh
   docker build -f apps/api/Dockerfile -t mello-api .
   docker run -p 8787:8787 --env-file .env mello-api
   ```
   Health check: `GET /health` (it also reports the Nemotron model map and whether Tavily is set up).

   **Current deployment: Google Cloud Run**, project `mello-hackathon-db2ac4`, region `asia-northeast1` (next to the Supabase database in Tokyo), at https://mello-api-69541089425.asia-northeast1.run.app.
   ```sh
   export CLOUDSDK_CORE_ACCOUNT=karrar90865@gmail.com P=mello-hackathon-db2ac4 R=asia-northeast1
   IMG=$R-docker.pkg.dev/$P/mello/api:$(git rev-parse --short HEAD)
   docker build --platform linux/amd64 -f apps/api/Dockerfile -t $IMG . && docker push $IMG
   gcloud run deploy mello-api --image $IMG --region $R --project $P
   ```
   Secrets (`NEBIUS_API_KEY`, `DATABASE_URL`, `TAVILY_API_KEY`) live in Secret Manager and are mounted with `gcloud run services update mello-api --update-secrets KEY=secret-name:latest`. `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are public values and are set as plain env vars.

   **Nebius Serverless Endpoint** (the planned home, once AI Cloud is active on the tenant): push the same image to a Nebius registry and run
   `nebius ai endpoint create --name mello-api --image <image> --platform cpu-d3 --preset 2vcpu-8gb --container-port 8787 --env-secret NEBIUS_API_KEY=<mysterybox secret> ...`.
3. **Environment** (see `.env.example`): `DATABASE_URL` (Supabase pooler), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `NEBIUS_API_KEY`, `TAVILY_API_KEY`, `PUBLIC_URL`, and optionally `EXPO_ACCESS_TOKEN`. Turn on **Zero Data Retention** in the Token Factory account settings.
4. **Before real users** (not built yet):
   - Move voice-message uploads from the container disk (`UPLOAD_DIR`) to Supabase Storage. Container disks are wiped on redeploy.
   - Rate-limit `/pair`, `/self/coach/chat`, `/self/reflect` and `/kid/challenges`. These cost LLM tokens or can be guessed.
   - Request logging and error reporting (Sentry).

## 2. Mobile app

**Test build for judges (no EAS needed):** a signed release APK built locally and attached to a GitHub Release.
```sh
cd apps/mobile && npx expo prebuild --platform android
cd android && EXPO_PUBLIC_API_URL=https://mello-api-69541089425.asia-northeast1.run.app NODE_ENV=production \
  ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
gh release create v1.0.0 app/build/outputs/apk/release/app-release.apk#mello.apk --title "Mello 1.0.0" --notes-file ../../../docs/SUBMISSION.md
```
Release signing comes from `plugins/withReleaseSigning.js` and the `MELLO_UPLOAD_*` properties in `~/.gradle/gradle.properties`; the keystore lives outside the repo (`~/.mello-keys/`). **Back it up**: updates must be signed with the same key.

### EAS (for the store)
1. `cd apps/mobile && npx eas-cli init` to link an EAS project. This writes the project id into `app.json` and turns on push notifications.
2. Set the build-time variables in EAS: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Use `eas env:create` or the `env` blocks in `eas.json`.
3. Builds (profiles in `eas.json`):
   - `eas build -p android --profile development`: dev client for testing on your phone.
   - `eas build -p android --profile preview`: an installable APK for testers.
   - `eas build -p android --profile production`: an AAB for Google Play; the version code bumps itself.
4. **Test on real phones first.** The Android-native parts have never been compiled in CI:
   - the focus lock (bounce back to ReadEra, idle pause, break-glass);
   - the guard-off reminder;
   - the floating bubble;
   - the usage totals.

   Test on at least one Samsung and one Pixel. Some brands kill background services, so also test with battery optimisation on.
5. **Crash reporting:** add `@sentry/react-native` before the first public release.

## 3. Google Play (the slow part: start early)
- **Accessibility API declaration** (Play Console → App content).
  - Mello uses an AccessibilityService for a non-accessibility purpose: digital wellbeing and parental controls. Google allows this only with a prominent in-app disclosure before the user turns it on (we have one, on the home and onboarding screens), plus a declaration form and a short video of the flow.
  - Review takes days to weeks.
- **Usage access** (`PACKAGE_USAGE_STATS`): explain why in the store listing and in-app (done in-app).
- **Data safety form**, matching the privacy table in `docs/SELF_MODE.md`:
  - Collected: app activity (aggregated), the email address, and messages to the companion.
  - Encrypted in transit.
  - Users can delete their data.
- **Privacy policy URL:** a public page saying the same as the data safety form.
- **Target audience and content:**
  - Parent mode involves children, so complete the Families questionnaire.
  - The app itself targets adults and parents; kids use it under a parent's account.
  - Content rating questionnaire.
- **Store listing:** icon (Tolo), feature graphic, 4–8 screenshots (use the design mockup screens), short and full description.
- Release to **internal testing**, then closed testing (required for new personal developer accounts: 12 testers for 14 days), then production.

## 4. Repo and CI
- `.github/workflows/ci.yml` runs on every push and pull request:
  - API tests;
  - typecheck;
  - an Android JS bundle (`expo export`), which catches broken imports.
- Keep secrets out of git: only `.env.example` is committed.

## 5. Next builds after the first release
- Android home-screen widgets (Streak 2×2, Today's goals 4×2), fed from the same on-device state as the bubble.
- Tolo 3D art in the bubble and widgets (see `docs/brand/tolo-3d-assets.md`).
- The new onboarding and dashboard from `docs/design/mello-tolo-design.html`.
- iOS: needs Apple's Family Controls entitlement. Request it early.
