# Nexofy Voice Agent 1.0 — Detailed System Architecture & Data Schema

Phone-first production design.  
**Retell talks. Express decides. PostgreSQL remembers. n8n notifies.**

---

## 1. System overview

Nexofy v1 answers inbound phone calls for many client businesses from one platform.

Each client gets:

- one phone number
- one AI receptionist configured for their business
- their own services, FAQs, bookings, and call history

The platform must:

1. answer calls quickly
2. speak naturally
3. use only that client’s real information
4. book / cancel against a live calendar
5. transfer to a human when asked
6. email a summary after every call
7. keep each client’s data isolated

---

## 2. High-level architecture

```text
┌────────────────────────────────────────────────────────────────────┐
│                        OUTSIDE WORLD                               │
│  Phone caller          Human staff phone         Client inbox      │
└───────────┬─────────────────────┬────────────────────┬─────────────┘
            │                     │                    │
            ▼                     ▲                    ▲
┌───────────────────┐    transfer │                    │
│      Twilio       │             │                    │
│  phone numbers +  │             │                    │
│  call routing     │             │                    │
└─────────┬─────────┘             │                    │
          │ inbound call          │                    │
          ▼                       │                    │
┌───────────────────┐             │                    │
│      Retell       │─────────────┘                    │
│  voice agent      │                                  │
│  OpenAI Realtime  │                                  │
│  transcripts      │                                  │
│  transfer tools   │                                  │
└─────────┬─────────┘                                  │
          │ HTTPS tools + webhooks                     │
          ▼                                            │
┌───────────────────┐     ┌─────────────┐     ┌────────┴────────┐
│  Express API      │────►│  Cal.com    │     │      n8n        │
│  (business brain) │     │  diary /    │     │  email / SMS /  │
│  hosted on Render │     │  free-busy  │     │  CRM row        │
└─────────┬─────────┘     └─────────────┘     └─────────────────┘
          │ SQL
          ▼
┌───────────────────┐
│   PostgreSQL      │
│  system of record │
│  tenants/services │
│  faqs/bookings/   │
│  calls            │
└───────────────────┘
```

---

## 3. Layer-by-layer detail

### 3.1 Twilio — the phone door

**Job**

- own the public phone number
- receive the inbound call from the mobile network
- route that call to the correct Retell agent

**Stores**

- phone number configuration
- basic call transport metadata

**Does not store**

- company FAQs
- bookings
- conversation meaning

**v1 rule**

One Twilio number → exactly one Nexofy client (tenant).

---

### 3.2 Retell — the talking receptionist

**Job**

- answer the call
- run the voice conversation (OpenAI Realtime)
- handle interruptions and turn-taking
- call your Express tools when it needs facts or actions
- transfer to a human number when asked
- keep call transcript / recording / tool logs
- fire a “call ended” webhook

**Configured per client**

- greeting text
- voice
- system prompt / persona
- knowledge base copy (optional sync from your FAQs)
- custom functions pointing at Express
- transfer target number
- language mode (standard English first)

**Does not own**

- canonical price list
- final booking ledger
- multi-client reporting database

---

### 3.3 Express API — the business brain

**Job**

- identify which tenant a request belongs to
- validate every tool call
- read/write PostgreSQL
- talk to Cal.com for availability and booking writes
- trigger n8n after bookings / call end
- enforce “never invent” by only returning stored facts

**Hosted**

- cloud server (Render or equivalent)
- public HTTPS URL so Retell can reach it

**Core modules (logical)**

| Module | Responsibility |
|---|---|
| Tenant resolver | Map Twilio number / tenant id → company config |
| Catalogue service | Services + prices |
| Knowledge service | Approved FAQs only |
| Availability service | Ask Cal.com for free slots |
| Booking service | Create / cancel / reschedule |
| Call intake service | Save call-ended payload |
| Notification service | Push events to n8n |

---

### 3.4 PostgreSQL — the filing cabinet

**Job**

- be the single source of truth for all clients
- store durable business and booking data
- support reporting and the future Nexofy dashboard

**Hosted**

- managed Postgres (Supabase / Neon / Render Postgres)

**Not for**

- live audio
- temporary call sockets

---

### 3.5 Cal.com — the diary

**Job**

- live free/busy checks
- create calendar events
- support cancel / reschedule

**Why it exists separately**

Bookings must be real calendar facts, not only rows in your DB.

**v1 sync rule**

Express writes both:

1. Cal.com event  
2. `bookings` row in Postgres  

If calendar write fails, booking is not confirmed to the caller.

---

### 3.6 n8n — the messenger

**Job**

- send studio email after booking / call end
- later: SMS / WhatsApp confirmation
- later: HubSpot / Google Sheets row

**Rule**

Notifications are best-effort after the durable write.  
A failed email must not erase a successful booking.

---

## 4. Runtime data flows

### 4.1 Inbound call connect

```text
Caller dials +27...
  → Twilio receives call
  → Twilio sends call to mapped Retell agent
  → Retell answers (<1s target)
  → waits 1.5–2s
  → speaks greeting
```

### 4.2 Fact lookup mid-call

```text
Caller: "How much is a fade?"
  → Retell decides it needs facts
  → Retell GET /api/tenants/{id}/services
  → Express loads services for that tenant only
  → returns ZAR prices
  → Retell speaks only returned prices
```

### 4.3 Booking mid-call

```text
Caller confirms slot
  → Retell POST /api/tenants/{id}/bookings
  → Express validates fields
  → Express checks Cal.com availability again
  → Express creates Cal.com event
  → Express inserts bookings row
  → returns reference
  → Retell reads reference aloud
  → Express/n8n emails studio
```

### 4.4 Human transfer

```text
Caller: "I want to speak to a person"
  → Retell transfer tool
  → live call connected to tenant.transfer_number
  → call outcome later marked escalated
```

### 4.5 Call ended

```text
Call hangs up / drops / transfers complete
  → Retell webhook to Express
  → Express upserts calls row
  → links booking_id if one was created
  → n8n sends post-call summary email
```

---

## 5. Security & isolation (architecture level)

| Concern | v1 approach |
|---|---|
| Client isolation | Every row keyed by `tenant_id` |
| Number mapping | Unique `twilio_number` per tenant |
| Tool auth | Shared secret header from Retell → Express |
| Secrets | Env vars only (`DATABASE_URL`, Retell/Twilio/Cal.com keys) |
| PII | Stored in Postgres; Retell retention configured per agent |
| POPIA posture | Cloud storage, retention policy, no local client data on laptops for production |

---

## 6. Detailed data schema

### 6.1 Schema map

```text
tenants
  ├── services          (what they sell)
  ├── faqs              (approved answers only)
  ├── working_hours     (optional v1.1; can start in tenant JSON)
  ├── bookings          (appointments)
  └── calls             (every inbound interaction)

bookings
  ├── optional service_id
  └── optional originating call_id / retell_call_id

calls
  └── optional booking_id when call produced a booking
```

---

### 6.2 `tenants` — one row per client business

This is the root record for a company on the platform.

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | UUID | yes | Internal primary key |
| `slug` | TEXT | yes | Stable short code, e.g. `bella-hair` |
| `business_name` | TEXT | yes | Spoken name + email branding |
| `twilio_number` | TEXT | yes | E.164 number, unique |
| `retell_agent_id` | TEXT | no* | Linked Retell agent id |
| `calcom_event_type_id` | TEXT | no* | Calendar event type for bookings |
| `calcom_api_key_ref` | TEXT | no | Reference/secret name, not raw key in row if avoidable |
| `transfer_number` | TEXT | yes | Human escalation target |
| `timezone` | TEXT | yes | Default `Africa/Johannesburg` |
| `locale` | TEXT | yes | Default `en-ZA` |
| `language_mode` | TEXT | yes | `standard` or `dynamic` |
| `default_language` | TEXT | yes | `en` for v1 base |
| `voice_name` | TEXT | no | Preferred voice label |
| `greeting_text` | TEXT | yes | Exact opening line |
| `greeting_delay_ms` | INT | yes | Target 1500–2000 |
| `prompt_version` | TEXT | no | Track prompt revisions |
| `notify_email` | TEXT | yes | Studio inbox |
| `notify_webhook_url` | TEXT | no | Optional per-tenant n8n override |
| `sms_confirm_enabled` | BOOL | yes | Default false in v1 launch |
| `status` | TEXT | yes | `active`, `paused`, `churned` |
| `created_at` | TIMESTAMPTZ | yes | |
| `updated_at` | TIMESTAMPTZ | yes | |

\*Required before go-live for that tenant, nullable while drafting.

**Constraints**

- unique(`slug`)
- unique(`twilio_number`)
- `status` in allowed set
- `language_mode` in (`standard`, `dynamic`)

**Example row**

| Field | Value |
|---|---|
| slug | `bella-hair` |
| business_name | `Bella Hair Studio` |
| twilio_number | `+27821111111` |
| transfer_number | `+27821234567` |
| greeting_text | `Hello, welcome to Bella Hair Studio. How may I help you today?` |
| greeting_delay_ms | `1800` |
| notify_email | `studio@bellahair.example` |
| status | `active` |

---

### 6.3 `services` — sellable catalogue

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | UUID | yes | Primary key |
| `tenant_id` | UUID | yes | FK → tenants.id |
| `code` | TEXT | no | Stable internal code, e.g. `fade-lineup` |
| `name` | TEXT | yes | Customer-facing name |
| `description` | TEXT | no | Short explanation for agent/menu |
| `category` | TEXT | no | Cutting / Colour / Braids |
| `price_cents` | INT | yes | Minor units; R150 = 15000 |
| `currency` | CHAR(3) | yes | `ZAR` |
| `duration_minutes` | INT | yes | Used for calendar block |
| `buffer_minutes` | INT | yes | Default 0 or 10 between appointments |
| `active` | BOOL | yes | Soft hide |
| `sort_order` | INT | yes | Display/prompt order |
| `created_at` | TIMESTAMPTZ | yes | |
| `updated_at` | TIMESTAMPTZ | yes | |

**Constraints**

- FK `tenant_id` → tenants
- `price_cents >= 0`
- `duration_minutes > 0`
- unique(`tenant_id`, `code`) when code present

**Why price_cents**

Avoid floating-point money bugs. Format as `R150` only at the API/speech layer.

---

### 6.4 `faqs` — approved answers only

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | UUID | yes | Primary key |
| `tenant_id` | UUID | yes | FK → tenants.id |
| `question` | TEXT | yes | Canonical question |
| `answer` | TEXT | yes | Only allowed answer |
| `tags` | TEXT[] | no | e.g. `{parking,hours}` |
| `priority` | INT | yes | Retrieval ranking help |
| `active` | BOOL | yes | Editable without redeploy |
| `created_at` | TIMESTAMPTZ | yes | |
| `updated_at` | TIMESTAMPTZ | yes | |

**Business rule**

If no FAQ/service matches, agent must say it does not know and offer escalation.  
No generative guessing from outside this set + services catalogue.

---

### 6.5 `bookings` — appointments

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | UUID | yes | Primary key |
| `tenant_id` | UUID | yes | FK → tenants.id |
| `service_id` | UUID | no | FK → services.id |
| `reference` | TEXT | yes | Spoken code, unique per tenant |
| `customer_name` | TEXT | yes | |
| `phone` | TEXT | yes | Normalised digits/E.164 where possible |
| `service_name_snapshot` | TEXT | yes | Name at booking time (history safe) |
| `quoted_price_snapshot` | TEXT | no | e.g. `R150` |
| `starts_at` | TIMESTAMPTZ | yes* | Normalised start |
| `ends_at` | TIMESTAMPTZ | yes* | starts_at + duration (+ buffer policy) |
| `date_text` | TEXT | no | Exact words caller used |
| `time_text` | TEXT | no | Exact words caller used |
| `notes` | TEXT | no | Extra caller context |
| `status` | TEXT | yes | `booked`, `cancelled`, `rescheduled`, `no_show` |
| `source` | TEXT | yes | `twilio`, `web`, `admin` |
| `retell_call_id` | TEXT | no | Originating call |
| `calcom_booking_id` | TEXT | no | External diary id |
| `cancelled_at` | TIMESTAMPTZ | no | |
| `cancel_reason` | TEXT | no | |
| `created_at` | TIMESTAMPTZ | yes | |
| `updated_at` | TIMESTAMPTZ | yes | |

\*Required for confirmed calendar-backed bookings.

**Constraints**

- unique(`tenant_id`, `reference`)
- `status` in allowed set
- FK tenant/service

**Indexes**

- (`tenant_id`, `starts_at`)
- (`tenant_id`, `phone`)
- (`retell_call_id`)

**Snapshot fields matter**

If a service price changes next month, old bookings still show what was quoted on the call.

---

### 6.6 `calls` — every inbound interaction

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | UUID | yes | Primary key |
| `tenant_id` | UUID | yes | FK → tenants.id |
| `retell_call_id` | TEXT | yes | Unique external id |
| `twilio_call_sid` | TEXT | no | Carrier call id if available |
| `from_number` | TEXT | no | Caller ID |
| `to_number` | TEXT | yes | Twilio number dialled |
| `started_at` | TIMESTAMPTZ | no | |
| `ended_at` | TIMESTAMPTZ | no | |
| `duration_seconds` | INT | no | |
| `outcome` | TEXT | yes | See enum below |
| `summary` | TEXT | no | Short post-call summary |
| `transcript_url` | TEXT | no | Link/export reference |
| `recording_url` | TEXT | no | If retention allows |
| `booking_id` | UUID | no | FK → bookings.id |
| `escalated_to` | TEXT | no | Number transferred to |
| `drop_off_reason` | TEXT | no | `caller_hangup`, `network`, `agent_error` |
| `raw_webhook_json` | JSONB | no | Debug/audit payload |
| `created_at` | TIMESTAMPTZ | yes | |

**Outcome enum (v1)**

| Value | Meaning |
|---|---|
| `booked` | Appointment created |
| `cancelled_existing` | Existing booking cancelled |
| `rescheduled` | Old cancelled + new booked |
| `enquiry` | Questions only |
| `escalated` | Transferred to human |
| `unresolved` | Ended without clear result |
| `failed` | Technical failure |

**Why calls is separate from bookings**

Not every call creates a booking.  
Nexofy still needs a complete call history for summaries, QA, and monthly reports.

---

### 6.7 Optional v1 support tables

Add if time allows before first pilot; otherwise phase 1.1.

#### `tenant_hours`

| Column | Type | Description |
|---|---|---|
| `tenant_id` | UUID | FK |
| `weekday` | INT | 0=Sunday … 6=Saturday |
| `open_time` | TIME | |
| `close_time` | TIME | |
| `is_closed` | BOOL | |

#### `webhook_deliveries`

| Column | Type | Description |
|---|---|---|
| `id` | UUID | |
| `tenant_id` | UUID | |
| `event_type` | TEXT | `booking.created`, `call.ended` |
| `target_url` | TEXT | |
| `status` | TEXT | `pending`, `delivered`, `failed` |
| `attempt_count` | INT | |
| `last_error` | TEXT | |
| `payload_json` | JSONB | |
| `created_at` | TIMESTAMPTZ | |

Useful so failed emails are visible and retryable.

---

## 7. Relationship rules

```text
tenants 1 ─── * services
tenants 1 ─── * faqs
tenants 1 ─── * bookings
tenants 1 ─── * calls

services 1 ─── * bookings     (optional link)
calls    1 ─── 0..1 bookings  (if that call produced one)
bookings * ─── 0..1 calls     (via retell_call_id / booking_id)
```

**Hard isolation rules**

1. Never query bookings without `tenant_id`
2. Resolve tenant from Twilio number before tool execution
3. Retell tool URLs should include tenant id **and** server must re-validate against call metadata when possible
4. A booking reference is unique per tenant, not globally

---

## 8. API contracts tied to the schema

### GET `/api/tenants/:tenantId/services`
Reads `services` where `active = true`.  
Response shaped for speech (“R150”, duration minutes).

### GET `/api/tenants/:tenantId/faqs`
Reads active `faqs`.  
Used when Retell needs approved answers.

### POST `/api/tenants/:tenantId/availability`
Input: service, date range/preference.  
Express checks Cal.com using tenant calendar config + service duration.

### POST `/api/tenants/:tenantId/bookings`
Input: name, phone, service, start time, notes, retell_call_id.  
Writes Cal.com + `bookings` row.  
Returns `reference`.

### POST `/api/tenants/:tenantId/bookings/:reference/cancel`
Finds booking by tenant+reference (or name/phone fallback).  
Cancels calendar event + sets `status = cancelled`.

### POST `/api/webhooks/retell/call-ended`
Upserts `calls`.  
If booking happened on that call, link `booking_id`.  
Trigger n8n summary.

---

## 9. Example end-to-end data trail

**Tenant:** Bella Hair Studio  
**Caller:** Sipho, +27831234567  
**Ask:** Fade, Wednesday 16:00

1. `tenants.twilio_number = +27821111111` identifies Bella  
2. Retell agent for Bella answers  
3. Tool reads `services` → Fade & Line-Up R150 / 40 min  
4. Availability check with Cal.com → 16:00 free  
5. Confirm → insert `bookings`  
   - reference `BHS-KYM3T`  
   - starts_at Wednesday 16:00 SAST  
   - ends_at 16:40  
6. Call ends → insert/update `calls`  
   - outcome `booked`  
   - booking_id linked  
7. n8n emails studio with reference + details  

---

## 10. What stays out of this schema (v1)

| Deferred | Why |
|---|---|
| Full staff/stylist tables | Single shared calendar first |
| Payments | Out of SRD v1 scope |
| Outbound campaigns | v2 |
| Full 11-language content tables | Phase 1 EN (+ AF premium later) |
| Browser WebRTC session storage | Not part of phone production path |

---

## 11. One-slide summary

**Architecture**

Caller → Twilio → Retell → Express → Postgres  
(+ Cal.com for diary, + n8n for messages, + human transfer)

**Data**

- `tenants` = companies  
- `services` + `faqs` = what the agent may say/sell  
- `bookings` = appointments  
- `calls` = every conversation outcome  

**Principle**

Retell is the mouth and ears.  
Express + PostgreSQL are the memory and booking authority.

---

Source: Nexofy SRD v1.0 + agreed phone-first stack (Twilio, Retell, Express, Postgres, Cal.com, n8n).
