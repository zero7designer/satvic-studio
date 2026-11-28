# Satvic Studio — AI Dub QA

A local-first dubbing workflow for creating a target-language video with Sarvam and checking it when you do not understand the target language. Choose **Generate with Sarvam** to upload one source, wait for Sarvam to dub and export it, then run Saaras transcription and Gemini transcript and audio QA. Or choose **I already have a dub** to compare two existing files. Reports show suspected issues with source and dub time ranges; click a time to play that moment. Transcript comparison and audio review both contribute findings.

## Requirements

- Node.js 20.9+
- Sarvam API key with Dubbing and speech-to-text access
- Gemini API key for direct audio comparison (required for the AI listening report)
- Optional Gmail App Password for email notifications to the signed-in Google account

## Setup on Windows

In PowerShell, from this folder:

```powershell
npm install
Copy-Item .env.local.example .env.local
```

Add your keys to `.env.local`:

```text
SARVAM_API_KEY=your_key_here
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-3.8-flash
GEMINI_FALLBACK_MODEL=gemini-3.5-flash-lite
DEEPGRAM_API_KEY=your_deepgram_api_key
# Optional: set this to a full Flash model available to your key for the text-only transcript comparison.
# GEMINI_TRANSCRIPT_REVIEW_MODEL=your-supported-flash-model-id
GMAIL_USER=piyushkumaryadav2027@gmail.com
GMAIL_APP_PASSWORD=your_16_character_google_app_password
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
NEXT_PUBLIC_APP_URL=http://localhost:3000
WORKFLOW_INTERNAL_TOKEN=generate_a_long_random_secret
```

## Google sign-in and saved history

The dashboard requires Google sign-in. The verified Google account `piyushkumaryadav2027@gmail.com` is assigned the Video Manager role; other Google accounts are assigned Video Dubbing Manager. Video Manager submissions are stored as pending requests for the dubbing team. Supabase stores user and job metadata; background workflows use the server-only service role key. Keep that key out of browser code and never commit it.

1. Create a Supabase project. In the project dashboard, use **Connect** to copy the Project URL and Publishable key. For the server-only key, open **Settings → API Keys → Secret keys** and create/reveal the default secret key. Put them in `.env.local` using the names above. Never use a `NEXT_PUBLIC_` prefix for the Secret key.
2. In the Supabase SQL editor, run [`supabase/schema.sql`](supabase/schema.sql) to create the profile, dubbing-request, and QA tables with their access policies. For an existing deployment, also run [`supabase/migrations/20261128150000_video_manager_roles_and_requests.sql`](supabase/migrations/20261128150000_video_manager_roles_and_requests.sql) to migrate profiles and add the Video Manager request queue.
3. In **Authentication → Providers → Google**, enable Google. Create a Google OAuth web client in Google Cloud. Add your app origin (`http://localhost:3000` for local development) to the Google authorized JavaScript origins. Add the callback URL shown by Supabase (usually `https://<project-ref>.supabase.co/auth/v1/callback`) to Google authorized redirect URIs, then paste the Google client ID and secret into Supabase.
4. In Vercel, set `APP_BASE_URL` to the canonical production origin for the project (for example, `https://your-project.vercel.app`, without a trailing slash). In Supabase **Authentication → URL Configuration**, set the Site URL to that same origin and add `<APP_BASE_URL>/auth/callback` and (for local development) `http://localhost:3000/auth/callback` to allowed redirect URLs. If you use Vercel preview deployments, add an allowed redirect pattern matching your project's preview URLs.
5. Restart `npm run dev` after adding local environment values. **Signup** and **Login** both use Google. After setup, the designated Video Manager lands on `/video-manager`; other Google accounts land on `/dashboard/satvic-fluid`. Video Manager submissions appear in the existing dubbing dashboard's incoming request queue.
6. Set `WORKFLOW_INTERNAL_TOKEN` to a long random secret locally and in Vercel. The background workflow uses it to call the protected QA API after Sarvam finishes.

Supabase's Google provider setup and redirect allow-list must match the app callback URLs exactly. See the official [Google sign-in setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) and [redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).

## Application structure

- `app/` contains route entry points and API route handlers. Route groups `(auth)` and `(studio)` organize login, signup, onboarding, callback, and dashboard routes without changing their URLs.
- `features/` contains product UI and behavior, split by feature. The public website is in `features/website`; client components live in `client/`; server actions live in `server/`.
- `lib/` contains shared Supabase, storage, and email integrations used by server routes and actions.
- `services/` contains background workflow and worker code.
- `public/` contains static assets such as the Satvic Studio fonts.

## Routes

| URL | Purpose | Access |
| --- | --- | --- |
| `/` | Satvic Studio home page | Public |
| `/signup` | Create an account with Google | Public |
| `/login` | Sign in with Google | Public |
| `/auth/callback` | Complete the Supabase OAuth exchange and send the user to the dashboard | Auth callback |
| `/dashboard` | Redirects to the Dubbing QA workspace | Signed in |
| `/onboarding` | Complete a missing profile for legacy accounts | Signed in |

Start Next.js:

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sarvam Saaras handles speech recognition; no separate Whisper worker is required.

## Review flow

1. Click **New QA project** and choose whether to generate a dub or review an existing one, then select the source and target languages.
2. Upload the original video and, when using an existing dub, the finished dub.
3. In **Generate with Sarvam** mode, the source is uploaded privately and Gemini labels timestamped speech turns by voice; the app derives the count from the distinct labels. Review or edit the count because diarization can still merge similar voices or split one voice. The confirmed value is sent to Sarvam as `num_speakers` for voice cloning, as described in the official [Sarvam Dubbing API reference](https://docs.sarvam.ai/api-reference/creative-agents-dubbing/create-dub). This uses Gemini quota. Sarvam then creates a dubbed video in the selected target language, and the app downloads that export locally. Dubbing is billed according to your Sarvam account and plan. The existing-dub mode skips this step.
4. For a Sarvam-generated dub, Sarvam Saaras v4 transcribes both the original and finished dub with timestamps. Gemini translates the Saaras dubbed transcript into the source language and compares it with the original Saaras transcript. Separately, Gemini listens to both complete audio tracks together for spoken-content issues, matching dialogue by meaning and allowing source and dub timestamps to differ. A local FFmpeg scan flags long frozen sections and black screens in the dub. Sarvam's downloaded SRT is supporting evidence only.
5. For an existing dub, Sarvam Saaras transcribes both tracks with timestamps. Gemini translates the dubbed transcript into the source language and compares the transcripts, then reviews the actual audio tracks. The same local scan checks the dubbed video for long freezes and black screens. Findings show whether the audio and transcript checks agree; times are anchored to transcript segments when available.
6. While processing, the analysis dialog shows elapsed time, provider stage and progress. The report lists suspected findings with categories and source/dub time ranges. It avoids model-reported confidence percentages; matching audio and text evidence is shown as corroboration, not proof. A result with no findings means no issue was flagged, not that the dub is verified error-free; listen to both tracks before approval. Click a time button to jump to that moment. Generated Sarvam dubs can also be downloaded from the report. The transcript evidence can be expanded, and the JSON export includes findings and timestamps. On a completed Sarvam-generated report, choose **Run QA again** beside **Done** to repeat the transcript and audio QA with the saved Saaras transcripts and dub; this does not start another dub or Sarvam transcription.

## Preflight, storage and provider checks

The upload dialog first performs preflight before any video is uploaded or Sarvam dubbing starts. For a generated dub, the next step uploads the source privately and runs Gemini speaker detection; review or edit the suggested count before the final confirmation starts Sarvam.

1. The server checks that the signed-in user, Blob store, Sarvam key, Gemini key and background-job configuration (for generated dubs) are present.
2. Gemini receives a tiny “reply READY” request using the configured model. This confirms that the key/model responds at that moment. It uses a small amount of Gemini quota; it does not reserve future capacity or guarantee the later audio-review request will fit quota or avoid a 429/503.
3. The browser reads media duration and the server rejects uploads over the current 450 MiB/file limit or clips likely to exceed Gemini’s 18 MiB two-audio request limit (roughly 15–20 minutes at the app’s current audio encoding; generated dubbing uses a more conservative estimate). This protects generated jobs from spending Sarvam dubbing usage on media the existing QA endpoint cannot review in one request.
4. The server lists this app’s `satvic-jobs/` Blob objects, reads their sizes, and estimates whether the selected upload fits. For Sarvam generation it budgets two copies of the source size plus a 50 MiB reserve; for an existing dub it budgets both selected file sizes plus that reserve. `BLOB_STORAGE_LIMIT_BYTES` controls the soft limit and defaults to 1 GiB. Adjust this env var to reflect the storage capacity you want this app to enforce.
5. The dialog shows the estimate and the limits of the check. Review it, and check the Sarvam dashboard’s **Settings → Billing** for available credits. There is no Sarvam balance/reservation check in this app.
6. The second click rechecks storage immediately before upload. If free space is short, the app deletes the oldest inactive media files under `satvic-jobs/` until the estimated job fits. It skips blobs attached to active jobs and media uploaded in the last 10 minutes, and keeps `*-qa-report*.json` reports. Deleted videos can no longer be played or downloaded from history. The existing daily retention job continues to remove expired media automatically.
7. Only after preparation succeeds does the browser upload the source (and, in existing-dub mode, both tracks) to private Blob storage. Generated mode runs Gemini speaker diarization and asks you to review or edit the count before starting Sarvam. Existing-dub mode starts transcription and QA without speaker detection.

This is an estimate of the current objects in this app’s Blob store. It cannot read Vercel’s account-level monthly-average storage or data-transfer budget, and deleting blobs does not immediately reset those billing/usage meters. Actual output size may differ from the estimate. Gemini’s successful ping does not guarantee later capacity; Sarvam credits and provider availability can also change between preflight and the real request. The app retries a Gemini 503/429 once, then checks `GEMINI_FALLBACK_MODEL` (default `gemini-3.5-flash-lite`), which supports audio input and structured output. If the fallback succeeds, actual analysis requests also fail over to it and the report names the model used. Optionally set `GEMINI_TRANSCRIPT_REVIEW_MODEL` to a stronger full Flash model available to your key; it handles only the text transcript comparison, which uses far fewer tokens than audio. If that text comparison falls back to a Lite model and finds no issues, the report is marked **Review incomplete** rather than presenting the result as a clean verdict. If both models are unavailable, the app stops before video upload/dubbing. Keep the logic in `app/api/jobs/preflight/route.ts`, `app/api/analyze/route.ts`, and this section in sync when replacing storage or AI providers.

### Editing the workflow later

- Change provider readiness checks, storage estimates, safe-cleanup rules, or the soft storage limit in `app/api/jobs/preflight/route.ts`.
- Change which stage runs first or the confirmation copy in `app/dashboard/DashboardClient.tsx`.
- Change the automatic 24-hour cleanup cadence in `vercel.json` and the retention implementation in `app/api/cron/blob-cleanup/route.ts`.
- Keep this README flow and `.env.local.example` updated whenever providers, limits, or retention rules change.

### Transcript timing and clip playback

Sarvam Batch Speech-to-Text provides sentence/phrase timestamps, not word-level timestamps. The QA parser accepts the timestamp field variants returned by Sarvam and normalizes them to timed transcript rows. If a provider response has transcript text but no timing data, the report marks timing coverage incomplete instead of inventing timestamps. Finding and transcript playback waits for the media seek to finish, supports pause/resume, and stops at the selected clip end. Gemini transcript/audio reviews request schema-constrained JSON; transcript findings are accepted only when their quoted text can be located in the reviewed Saaras passage. Omission/addition findings quote only the side where speech exists. Invalid or unsupported findings make the comparison incomplete instead of silently producing a clean report.

Research references: [Sarvam Saaras transcription](https://docs.sarvam.ai/api-reference/speech-to-text/transcribe) documents v4 transcription modes and phrase timestamps; [Sarvam Batch Speech-to-Text](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/batch-api) documents long-audio processing. [Gemini audio understanding](https://ai.google.dev/gemini-api/docs/audio) documents audio input, and [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output) documents schema-constrained JSON. [WhisperX (INTERSPEECH 2023)](https://arxiv.org/abs/2303.00747) describes VAD plus forced phoneme alignment for word-level timing; it is a possible local enhancement, but requires a suitable alignment model for each target language.

## Background jobs on Vercel

In **Generate with Sarvam** mode, the browser uploads the source to private Vercel Blob storage and starts a Vercel Workflow. Sarvam creates the dub, then the workflow calls the QA API on Vercel. Supabase stores the job history, and Blob stores the media and QA report. The browser can close while the generated dubbing workflow runs; email alerts are sent when it starts and when it completes or fails.

Before Sarvam starts, the app sends extracted source audio to Gemini and Deepgram Nova-3 for independent speaker diarization. The Deepgram request follows its recommended batch configuration: `diarize_model=latest` (currently resolves to diarizer v2) and `utterances=true`; the parser uses word-level speaker labels when available, rather than relying only on an utterance's summary label. The app makes one Deepgram request per speaker check and does not retry with extra models, to avoid duplicate usage. Nova-3 is Deepgram's highest-performing general-purpose model and is recommended for multi-speaker audio; cheaper model options should not be assumed to provide equivalent diarization quality. Check the current [Deepgram pricing](https://deepgram.com/pricing) and per-request cost in the [Deepgram usage console](https://developers.deepgram.com/docs/using-logs-usage). The user must choose one provider's result or enter a count manually; the chosen count is passed to Sarvam. Provider estimates are not guaranteed to match the actual speakers, since diarization labels acoustic voices, not characters or identities. Both providers receive the extracted audio. Canceling the speaker check aborts the browser request and deletes the temporary source from Vercel Blob; if deletion fails, the app keeps the modal open and reports the error so deletion can be retried. A provider request already received by Gemini or Deepgram may continue processing after cancellation.

For the deployed app, connect a Vercel Blob store and configure `BLOB_READ_WRITE_TOKEN`, `SARVAM_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `DEEPGRAM_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `WORKFLOW_INTERNAL_TOKEN`. Production workflow callbacks, Google sign-in, and email links use `https://satvic-studio.vercel.app`. Keep secret values server-side. If deployment protection is enabled, configure `VERCEL_AUTOMATION_BYPASS_SECRET` for the workflow callback.

For Gmail email alerts, configure `GMAIL_USER=piyushkumaryadav2027@gmail.com` and `GMAIL_APP_PASSWORD` in Vercel. The sender is this Gmail account, and each job's start, completion, or failure notices go to the email address of the user signed into Satvic Studio. To create the app password, first enable 2-Step Verification on that Google account, then create an App Password in its Google Account security settings. Use that generated app password, not the regular Google password. Google may not offer App Passwords for some account configurations; see [Google's App Password requirements](https://support.google.com/mail/answer/185833). Add the same two values in `.env.local` for local testing. Keep the app password private and redeploy Vercel after adding it. Standard Gmail accounts have a daily sending limit, so this is suitable for low-volume job notifications rather than bulk email; see [Gmail sending limits](https://support.google.com/mail/answer/22839).

Vercel Hobby functions can run for up to five minutes. The QA analysis still runs inside a Vercel function, so a long video can hit that limit. If QA times out, try a shorter clip. Generated dubbing waits run durably in the Vercel Workflow, but this does not extend the QA function's time limit. Local background testing needs a Blob token and the local computer/server must stay on. Protect the deployed app with authentication or Vercel Deployment Protection before sharing it.

### Blob media retention

The production Vercel Cron Job calls `/api/cron/blob-cleanup` daily. It deletes original and dubbed media in `satvic-jobs/` only after they are at least 24 hours old, skips media used by queued or running jobs, and keeps the small QA report JSON and Supabase history. On Hobby, actual deletion can happen between 24 and roughly 49 hours after upload because scheduled jobs run once a day with up to 59 minutes of timing variation. After media expires, transcripts and QA findings remain in history, but the videos can no longer be played or downloaded. Vercel storage usage is averaged over time, so the displayed monthly average decreases gradually after deletion. Set `CRON_SECRET` in Vercel to authorize the cleanup route.

### Archive the full QA report and videos to Backblaze B2

When a report is ready, use the **three-dot menu → Archive full report to Backblaze B2** (or the archive button at the bottom). Satvic Studio copies three assets to a private B2 bucket: the complete QA report JSON (findings, transcripts, timings, and metadata), the source video, and the dubbed video. It saves all three B2 object keys to Supabase, then removes the matching Vercel Blob objects. The report still opens in Satvic Studio: its JSON loads from B2 and both videos stream through authenticated, byte-range-aware routes, keeping seeking and transcript playback available. If an upload or database update fails, the Vercel copies remain; if cleanup fails, the B2 archive still works and cleanup can be retried.

To set up B2:

1. Create a Backblaze account. Open **B2 Cloud Storage → Buckets**, create a private bucket, and note its region and S3 endpoint (for example `https://s3.us-west-004.backblazeb2.com`).
2. Open **Application Keys → Add a New Application Key**. Restrict it to that bucket and select **Read and Write**. Copy the key ID and application key; the application key is shown only once.
3. Add these server-only values to local `.env.local` and Vercel:

   ```env
   B2_S3_ENDPOINT=https://s3.<your-region>.backblazeb2.com
   B2_BUCKET_NAME=<your-private-bucket-name>
   B2_APPLICATION_KEY_ID=<your-application-key-id>
   B2_APPLICATION_KEY=<your-application-key>
   ```

   Use the exact endpoint and region shown on the bucket details page. Keep these credentials server-side; never add a `NEXT_PUBLIC_` prefix.

4. Run the updated [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor to add the three B2 object-key columns.
5. Restart local Next.js or redeploy Vercel after setting the environment variables.
6. Open a completed report and choose **Archive full report to Backblaze B2** from its three-dot menu.

Backblaze states that the first 10 GB of B2 storage is free and account signup does not require a payment card. Free egress covers up to three times your average monthly stored data; additional egress may be billed. Existing R2 or Google Drive archives are not migrated. See [B2 pricing](https://www.backblaze.com/cloud-storage/pricing) and the [S3-compatible API guide](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api).
AI audio review can miss errors or mishear speech. Findings are model estimates, not a guarantee that a dub is correct. Inline audio comparison is limited to requests under 18 MB; for longer videos, split them into shorter clips and analyze each part.

## Local data and keys

Video and report history is tied to the signed-in Supabase account. The server temporarily extracts compressed audio for Gemini and deletes the temporary files after analysis. Source and dub audio are sent to the configured Sarvam and Gemini APIs. Check those providers' account terms and quotas. `.env.local` is ignored by Git; never commit or share API keys.
