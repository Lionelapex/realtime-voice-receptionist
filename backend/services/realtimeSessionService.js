/**
 * Creates short-lived ("ephemeral") credentials for the OpenAI Realtime API.
 *
 * This is the only module in the project that ever touches OPENAI_API_KEY.
 * The browser never receives that key -- it receives an `ek_...` client secret
 * that expires after a few minutes and is bound to the session configuration
 * we set here. That binding is the important part: because the model, voice and
 * instructions are attached to the token on the server, a malicious client
 * cannot swap in a different model or overwrite the receptionist persona.
 */

import { buildReceptionistInstructions } from './receptionistPrompt.js';
import {
  formatCatalogForPrompt,
  formatPrice,
  getLowestPrice,
} from './servicesCatalog.js';
import {
  localeDisplayName,
  resolveReceptionistLocale,
} from './locale.js';

const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';

// Overridable via .env so we can A/B different voices and models without a code change.
const DEFAULT_MODEL = 'gpt-realtime-2.1';
const DEFAULT_VOICE = 'marin';

/**
 * An error carrying an HTTP status, so the Express error handler can translate
 * failures into a sensible response instead of always returning a blank 500.
 */
export class RealtimeSessionError extends Error {
  constructor(message, status = 500, detail = null) {
    super(message);
    this.name = 'RealtimeSessionError';
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Tools the receptionist can use against the live Cal.com diary.
 *
 * Declaring these as tools rather than parsing the transcript afterwards means
 * the model hands over clean, typed fields at precise moments (after the
 * customer confirms), so we never write half-finished bookings.
 */
const CHECK_AVAILABILITY_TOOL = {
  type: 'function',
  name: 'check_availability',
  description:
    'Look up open appointment times from the salon calendar (Cal.com). ' +
    'ALWAYS speak a short status line to the caller first ' +
    '(for example "Let me quickly check what is open for you"), then call this tool. ' +
    'Pass a specific date (YYYY-MM-DD) for that day, or omit date to get the next several days.',
  parameters: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description:
          'Optional single day as YYYY-MM-DD in South Africa time. ' +
          'Convert relative phrases like "Friday" first.',
      },
      endDate: {
        type: 'string',
        description:
          'Optional end of range as YYYY-MM-DD. Only needed when checking several days.',
      },
    },
    required: [],
  },
};

const SAVE_BOOKING_TOOL = {
  type: 'function',
  name: 'save_booking',
  description:
    'Save a confirmed salon appointment on the calendar. ' +
    'ALWAYS speak a short status line first (for example "Let me book that for you now"), ' +
    'then call this tool. Only after check_availability showed the slot is open and the ' +
    'customer has explicitly confirmed all details. Email is optional — include it only ' +
    'if they gave one and confirmed the spelling. Never call it more than once for the same booking.',
  parameters: {
    type: 'object',
    properties: {
      customerName: {
        type: 'string',
        description: "The customer's full name, as they said it.",
      },
      phone: {
        type: 'string',
        description: "The customer's contact number, digits only where possible.",
      },
      email: {
        type: 'string',
        description:
          'Optional customer email if they volunteered one and confirmed the spelling. ' +
          'Omit if they did not give an email.',
      },
      service: {
        type: 'string',
        description: 'The service being booked, matching a name from the price list.',
      },
      date: {
        type: 'string',
        description:
          'Appointment date as YYYY-MM-DD in South Africa local time ' +
          '(for example 2026-08-20). Convert relative phrases like "Friday" first.',
      },
      time: {
        type: 'string',
        description:
          'Appointment time as HH:mm 24-hour South Africa local time ' +
          '(for example 14:30). Must be one of the open times from check_availability.',
      },
      quotedPrice: {
        type: 'string',
        description: 'The starting price quoted for the service, for example "R150".',
      },
      notes: {
        type: 'string',
        description: 'Anything else worth passing to the stylist. Omit if nothing.',
      },
    },
    required: ['customerName', 'phone', 'service', 'date', 'time'],
  },
};

const RESCHEDULE_BOOKING_TOOL = {
  type: 'function',
  name: 'reschedule_booking',
  description:
    'Move an existing appointment to a new open calendar slot. ' +
    'ALWAYS speak a short status line first (for example "Let me move that appointment for you"), ' +
    'then call this tool. Before calling, verify identity: read back their name and phone ' +
    'and get a yes. Reference is helpful but optional. Prefer check_availability first.',
  parameters: {
    type: 'object',
    properties: {
      customerName: {
        type: 'string',
        description: 'Full name on the booking, after the caller confirmed it.',
      },
      phone: {
        type: 'string',
        description: 'Phone number on the booking, after the caller confirmed it.',
      },
      reference: {
        type: 'string',
        description: 'Optional booking reference if known, for example BHS-4TRJY.',
      },
      date: {
        type: 'string',
        description: 'New date as YYYY-MM-DD (South Africa).',
      },
      time: {
        type: 'string',
        description: 'New time as HH:mm 24-hour (South Africa), from open slots.',
      },
      reason: {
        type: 'string',
        description: 'Optional short reason for the change.',
      },
    },
    required: ['customerName', 'phone', 'date', 'time'],
  },
};

const CANCEL_BOOKING_TOOL = {
  type: 'function',
  name: 'cancel_booking',
  description:
    'Cancel an existing salon appointment on the calendar. ' +
    'ALWAYS speak a short status line first (for example "Let me cancel that for you now"), ' +
    'then call this tool. ONLY after identity verification: confirm their full name AND ' +
    'phone number by reading them back and getting a clear yes, AND confirm they want to cancel. ' +
    'Reference is optional and helpful to start with, but never cancel on reference alone.',
  parameters: {
    type: 'object',
    properties: {
      customerName: {
        type: 'string',
        description: 'Full name on the booking, after the caller confirmed it.',
      },
      phone: {
        type: 'string',
        description: 'Phone number on the booking, after the caller confirmed it.',
      },
      reference: {
        type: 'string',
        description: 'Optional booking reference if known, for example BHS-4TRJY.',
      },
      reason: {
        type: 'string',
        description: 'Optional short cancellation reason.',
      },
    },
    required: ['customerName', 'phone'],
  },
};

/**
 * Build the session configuration that OpenAI will attach to the token.
 *
 * Note the nesting: as of the GA Realtime API, voice lives at
 * `audio.output.voice` and turn detection at `audio.input.turn_detection`.
 * Older beta examples put these at the top level; that shape is now rejected.
 */
function buildSessionConfig() {
  const locale = resolveReceptionistLocale();
  return {
    type: 'realtime',
    model: process.env.OPENAI_REALTIME_MODEL || DEFAULT_MODEL,
    // The price list is baked into the instructions at mint time, so the
    // receptionist can quote from the same catalogue the website renders.
    instructions: buildReceptionistInstructions({
      menuText: formatCatalogForPrompt(),
      lowestPrice: formatPrice(getLowestPrice()),
      locale,
    }),
    tools: [
      CHECK_AVAILABILITY_TOOL,
      SAVE_BOOKING_TOOL,
      RESCHEDULE_BOOKING_TOOL,
      CANCEL_BOOKING_TOOL,
    ],
    tool_choice: 'auto',
    audio: {
      input: {
        // Semantic VAD decides the customer has finished speaking based on whether
        // the sentence sounds complete, rather than purely on a silence timer.
        // For a booking conversation this matters: people pause mid-sentence while
        // recalling a phone number, and a plain silence timer interrupts them.
        turn_detection: {
          type: 'semantic_vad',
          // "low" waits for a more complete utterance before seizing the turn.
          // That helps slow speakers who pause mid-sentence (T-02) and reduces
          // false replies to brief background noise bursts (T-01). Trade-off:
          // replies feel a touch less snappy after short answers like "yes".
          eagerness: 'low',
          create_response: true,
          // Callers can still cut the agent off mid-sentence when they mean to.
          interrupt_response: true,
        },
      },
      output: {
        voice: process.env.OPENAI_REALTIME_VOICE || DEFAULT_VOICE,
      },
    },
  };
}

/**
 * Mint an ephemeral client secret for a new Realtime session.
 *
 * @returns {Promise<{value: string, expiresAt: number|null, model: string}>}
 */
export async function createEphemeralSession() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new RealtimeSessionError(
      'OPENAI_API_KEY is not configured on the server.',
      500,
    );
  }

  const sessionConfig = buildSessionConfig();

  let response;
  try {
    response = await fetch(CLIENT_SECRETS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session: sessionConfig }),
    });
  } catch (cause) {
    // Network-level failure: DNS, TLS, offline, proxy blocking the request.
    throw new RealtimeSessionError(
      'Could not reach the OpenAI API.',
      502,
      cause.message,
    );
  }

  if (!response.ok) {
    // Read the body as text first: OpenAI returns JSON for most errors, but
    // gateway failures can return HTML, and blindly calling .json() would
    // throw and mask the real status code.
    const body = await response.text();
    throw new RealtimeSessionError(
      `OpenAI rejected the session request (HTTP ${response.status}).`,
      response.status === 401 ? 500 : 502,
      body.slice(0, 500),
    );
  }

  const data = await response.json();

  if (!data?.value) {
    throw new RealtimeSessionError(
      'OpenAI returned a response without a client secret.',
      502,
    );
  }

  return {
    value: data.value,
    expiresAt: data.expires_at ?? null,
    model: sessionConfig.model,
    locale: resolveReceptionistLocale(),
    localeName: localeDisplayName(resolveReceptionistLocale()),
  };
}
