# Bella Hair Studio — AI Voice Receptionist

Voice receptionist demo for a South African hair salon. You open the call page,
speak normally, and it books (or changes / cancels) appointments on **Cal.com**.

Built with **React + Vite** (UI), **Express** (API), and **OpenAI Realtime** over
WebRTC (voice). The OpenAI API key never goes to the browser.

## What it does

- Greets after a short delay, then waits for the caller
- Quotes services/prices from `backend/data/services.json`
- Checks **live Cal.com** open slots before confirming a time
- Explains clearly when a **day is closed / fully booked** or a **time is already taken**
- Books, reschedules, and cancels on Cal.com (with name + phone verification for changes)
- Speaks English by default; switches to Afrikaans if the caller speaks or asks for it
- Website UI stays English

## Architecture

```
Browser (/call)  →  POST /api/session  →  OpenAI (ephemeral token)
     │
     ├── WebRTC audio  ─────────────────►  OpenAI Realtime
     │
     └── tools  →  Express  →  Cal.com
         check_availability / save_booking / reschedule_booking / cancel_booking
```

## Run locally

Needs **Node.js 20+**, an OpenAI key, and (for calendar) Cal.com credentials.

```powershell
# Terminal 1 — API
cd J:\S-T-P-DEMO\backend
npm.cmd install
# Edit .env (see below) if you have not already
npm.cmd run dev

# Terminal 2 — UI
cd J:\S-T-P-DEMO\frontend
npm.cmd install
npm.cmd run dev
```

Open:

- Site: http://localhost:5173  
- Voice desk: http://localhost:5173/call  

Use `npm.cmd` on Windows if PowerShell blocks `npm`.

Mic access only works on `localhost` or HTTPS.

### One-process (production-shaped)

```powershell
cd J:\S-T-P-DEMO\backend
npm.cmd run build:frontend
npm.cmd start
```

Then open http://localhost:3000/call

## Environment (`backend/.env`)

Copy from `backend/.env.example`. Important variables:

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | Yes | Realtime sessions |
| `CALCOM_API_KEY` | For calendar | Cal.com API key |
| `CALCOM_EVENT_TYPE_ID` | For calendar | Event type numeric id |
| `CALCOM_TIMEZONE` | No | Default `Africa/Johannesburg` |
| `CALCOM_DEFAULT_ATTENDEE_EMAIL` | No | Fallback attendee email when caller gives none |
| `OPENAI_REALTIME_MODEL` | No | e.g. `gpt-realtime-2.1-mini` |
| `OPENAI_REALTIME_VOICE` | No | e.g. `marin` |
| `RECEPTIONIST_LOCALE` | No | `en` (default). `af` forces Afrikaans-only voice for lab tests |
| `PORT` | No | Default `3000` |

## Project layout

```
backend/
  server.js                 Express API + serves frontend build
  routes/                   session, services, bookings, availability
  services/                 Realtime session, prompt, Cal.com, bookings
  data/services.json        Price list (single source of truth)
  data/bookings.json        Local booking audit trail
frontend/
  src/pages/                Home + Call desk
  src/lib/realtime.js       WebRTC + tool calls
```

## Booking behaviour

1. Agent calls `check_availability` before offering times  
2. If a day has **no slots** → explains closed or fully booked; ask for another day  
3. If a **time is taken** → explains it is already booked; offers other open times  
4. After confirm → `save_booking` writes local JSON + Cal.com  
5. Reschedule / cancel require verified **name + phone** (reference optional)  
6. Email is **optional**; if given, spell it back before saving  

## Deploy (e.g. Render)

Root directory: `backend`

| Setting | Value |
|---|---|
| Build | `npm run build:frontend && npm install` |
| Start | `npm start` |

Add the same env vars in the host dashboard. Free hosts wipe local `bookings.json` on restart — Cal.com is the durable diary.
