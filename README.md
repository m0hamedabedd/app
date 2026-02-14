<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1DQvV2cknIdSlojztkDxozCEbWiDwwrPw

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Set `VITE_FIREBASE_VAPID_KEY` in `.env.local` (for web push)
4. Run the app:
   `npm run dev`

## Deploy To Vercel

1. Import this repo in Vercel.
2. In **Project Settings > Environment Variables**, add:
   - `GEMINI_API_KEY` (required for Gemini features)
   - `VITE_FIREBASE_VAPID_KEY` (required for FCM web push)
3. Deploy.

This project includes `vercel.json` configured for Vite static output (`dist`).

## PWA Install (Save As App)

After deploy on HTTPS (Vercel), open the app once to let the service worker register.

- Android (Chrome): menu -> `Install app` / `Add to Home screen`
- iOS (Safari): Share -> `Add to Home Screen`
- Desktop (Chrome/Edge): click the install icon in the address bar

## FCM Push For Closed App Reminders

This repo now includes:
- client FCM token registration (`services/firebase.ts`)
- background service worker notification handling (`public/sw.js`)
- scheduled Firebase Cloud Function to send due-medication push every minute (`functions/index.js`)

Setup steps:

1. In Firebase Console -> Cloud Messaging:
   - Generate a **Web Push certificate key pair**
   - Copy the **Public key** to:
     - local `.env.local` as `VITE_FIREBASE_VAPID_KEY`
     - Vercel Environment Variables as `VITE_FIREBASE_VAPID_KEY`

2. Deploy Cloud Functions:
   - `cd functions`
   - `npm install`
   - `cd ..`
   - `firebase login`
   - `firebase deploy --only functions`

3. In app Profile, enable notifications (browser permission must be granted).

Notes:
- Scheduled functions require a Firebase project with billing enabled.
- Push reminders use each user's `userProfile.timezone` (auto-synced from browser).
