# PillCare

PillCare is a React + Vite medication management app with:
- smart daily reminders and snooze
- AI assistant chat and interaction safety checks (Gemini)
- AI bottle scan for auto-filling medication details
- adherence analytics and PDF report export
- Firebase Auth + Realtime Database sync
- PWA install support and web push notifications (FCM)

## Tech Stack

- React 19 + TypeScript + Vite
- Firebase (Auth, Realtime Database, Cloud Messaging)
- Firebase Cloud Functions (scheduled reminder push)
- Gemini (`@google/genai`) for AI features
- jsPDF + jspdf-autotable for reports

## Prerequisites

- Node.js 20+
- npm
- Firebase CLI (for deploying cloud functions)

## Local Setup

1. Install dependencies:
```bash
npm install
```

2. Create local env file:
```bash
copy .env.example .env.local
```

3. Set environment variables in `.env.local`:
- `GEMINI_API_KEY` (or `VITE_GEMINI_API_KEY`) for Gemini features
- `VITE_FIREBASE_VAPID_KEY` for web push token registration

4. Start dev server:
```bash
npm run dev
```

5. Open `http://localhost:3000`

## Build and Preview

```bash
npm run build
npm run preview
```

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Yes (for AI) | Main Gemini API key used at build time |
| `VITE_GEMINI_API_KEY` | Optional | Alternative Gemini key variable |
| `VITE_FIREBASE_VAPID_KEY` | Yes (for push) | FCM web push public VAPID key |

## Firebase Notes

- Frontend Firebase config is currently in:
  - `services/firebase.ts`
  - `public/sw.js`
- If you change Firebase projects, update both files.

## Push Reminders (FCM + Scheduled Function)

Client-side pieces:
- token registration: `services/firebase.ts`
- background notification handling: `public/sw.js`

Server-side piece:
- scheduled reminder sender: `functions/index.js`

### Deploy Functions

1. Install function dependencies:
```bash
npm --prefix functions install
```

2. Authenticate and deploy:
```bash
firebase login
firebase deploy --only functions
```

Notes:
- the scheduler runs every minute
- billing must be enabled on the Firebase project for scheduled functions
- reminders use each user's stored timezone (`userProfile.timezone`)

## Deploy to Vercel

1. Import repo into Vercel.
2. Add environment variables:
- `GEMINI_API_KEY`
- `VITE_FIREBASE_VAPID_KEY`
3. Deploy.

`vercel.json` is already configured for Vite static output (`dist`).

## PWA Install

After deploying on HTTPS:
- Android (Chrome): `Install app` / `Add to Home screen`
- iOS (Safari): `Share -> Add to Home Screen`
- Desktop (Chrome/Edge): use the install icon in the address bar
