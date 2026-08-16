# AI Voice Receptionist

A voice receptionist for a hair salon. You click one button, speak normally, and
it takes your booking — asking what you want done, quoting a price, agreeing a
time, then reading back a reference number. No forms, no keypad menus, no
waiting on hold.

Built on the OpenAI Realtime API over WebRTC, so speech goes straight from the
browser to the model. There is no speech-to-text step, no text-to-speech step,
and no server relaying audio, which is what makes it fast enough to interrupt
mid-sentence and be understood.

## What it does

- Greets the caller and waits, rather than immediately interrogating them
- Answers questions about services and quotes prices from the salon's real menu
- Collects name, phone number, service, date and time through normal conversation
- Handles interruptions, corrections and vague answers like "sometime Friday"
- Confirms the booking back to the caller with a spoken reference number
- Stores the booking and emails the studio through an n8n workflow

## Architecture

```
Browser                    Backend                  External
───────                    ───────                  ────────
/call (React)              POST /api/session   ──►  OpenAI (mint token)
  │                          returns ephemeral token
  ├── WebRTC audio  ────────────────────────────►  OpenAI Realtime
  │     (direct, never through the backend)
  │
  └── save_booking tool ──► POST /api/bookings ──►  n8n webhook ──► email
                              writes bookings.json
```

Three decisions shape the whole thing.

**The API key never reaches the browser.** The backend exchanges it for an
ephemeral token that expires in minutes, and only that token is sent to the
client. A key in frontend JavaScript is a key anyone can read and spend.

**Audio bypasses the backend entirely.** Once WebRTC is negotiated, the browser
talks directly to OpenAI. The server handles two small JSON requests per call —
minting a token at the start and saving a booking at the end — so it stays cheap
to host and adds no latency to the conversation.

**Prices come from one source.** `backend/data/services.json` feeds both the
website menu and the model's instructions. The receptionist cannot quote a price
the website does not show, because there is only one place a price exists.

## Tech stack

Kept intentionally lean: Express for the API, React for the UI, and the same
WebRTC voice engine that was written before the React port.

| Layer | Choice |
|---|---|
| Backend | Node.js 20+, Express 5 |
| Frontend | React 19, Vite, React Router, Tailwind CSS v4 |
| Voice | OpenAI Realtime API over WebRTC |
| Automation | n8n webhook to SMTP email |

The WebRTC lifecycle still lives in a DOM-free module (`src/lib/realtime.js`).
React only wraps it in a hook and renders state — so the voice path did not have
to be rewritten to change the UI framework.

## Project structure

```
backend/
  server.js                      Express app: API + serves the React build
  routes/                        HTTP layer, one file per resource
  services/
    realtimeSessionService.js    Mints ephemeral tokens, defines the tool schema
    receptionistPrompt.js        The receptionist's persona and conversation rules
    servicesCatalog.js           Loads the menu, formats prices and prompt text
    bookingService.js            Validates, stores and forwards bookings
  data/services.json             The salon menu: the single source of prices
  scripts/test-smtp.js           Checks SMTP credentials before trusting n8n
frontend/
  src/
    pages/                       HomePage and CallPage
    components/                  Header, service menu
    hooks/useRealtimeCall.js     React wrapper around the voice controller
    lib/realtime.js              WebRTC lifecycle, microphone, tool calls
n8n/
  booking-to-email.workflow.json Importable workflow: webhook to email
```

## Running it locally

Requires Node.js 20 or newer and an OpenAI account with credit. Realtime audio
is billed per minute, so set a spending limit before you start.

```bash
# Terminal 1 — API
cd backend
npm install
cp .env.example .env      # then add your OpenAI API key
npm run dev

# Terminal 2 — React UI (Vite proxies /api to :3000)
cd frontend
npm install
npm run dev
```

Open the Vite URL (usually `http://localhost:5173`). For a production-shaped
local run, build the frontend and let Express serve it:

```bash
cd backend
npm run build:frontend
npm start
```

Then open `http://localhost:3000` for the site, or `http://localhost:3000/call`
for the voice desk.

`getUserMedia` only exists in a secure context, so always use localhost or HTTPS
rather than opening built files as `file://`.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | Yes | Mints ephemeral Realtime tokens |
| `PORT` | No | Defaults to 3000 |
| `OPENAI_REALTIME_MODEL` | No | `gpt-realtime-2.1-mini` is roughly 3x cheaper on audio; the full model sounds better |
| `OPENAI_REALTIME_VOICE` | No | `marin` and `cedar` are the highest quality |
| `N8N_WEBHOOK_URL` | No | Where confirmed bookings are sent. Without it, bookings are still stored locally |

## Email notifications

`n8n/booking-to-email.workflow.json` imports into n8n as a webhook that emails
each confirmed booking to the studio.

1. Import the file into n8n
2. Attach an SMTP credential to the email node, and set the From and To addresses
3. Publish the workflow — the production URL returns 404 until you do
4. Copy the webhook node's production URL into `N8N_WEBHOOK_URL`

For Gmail, SMTP needs a 16-character [App Password](https://myaccount.google.com/apppasswords),
not your account password, and the From address must be that same account.
`node scripts/test-smtp.js` verifies credentials against the mail server before
you put them into n8n, which separates a bad password from a bad workflow.

## Deploying

Any host that runs a Node process works. Render's free tier is the shortest
path. With **Root Directory** set to `backend`:

| Setting | Value |
|---|---|
| Build Command | `npm run build:frontend && npm install` |
| Start Command | `npm start` |

That builds the React app into `frontend/dist`, then starts Express, which
serves the build and the API from one origin. Add the environment variables in
the dashboard. HTTPS comes free and is required for microphone access.

If you already deployed before the React port, update the Build Command — a
plain `npm install` no longer produces the UI.

Two things to know before making it public.

**Bookings do not survive a restart.** Every free host has an ephemeral
filesystem, so `data/bookings.json` is wiped when the service sleeps or
redeploys. The n8n email is the durable record. Swap in a database if you need
real persistence.

**A public URL means public spend.** Anyone who finds it can start a voice call
billed to your OpenAI account. Set a spending limit, and add rate limiting or an
access code before sharing the link widely.

## Known limitations

Booking storage is a JSON file with read-modify-write, which is fine for one
process and wrong for several. There is no availability checking, so the
receptionist accepts any time the caller asks for. Nothing authenticates the
booking endpoint. All three are deliberate — this demonstrates the voice
pipeline, and a real deployment would add a database, a calendar integration and
auth.
