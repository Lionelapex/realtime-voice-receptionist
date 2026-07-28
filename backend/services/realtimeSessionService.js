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
 * The one action the receptionist can take in the outside world.
 *
 * Declaring this as a tool rather than parsing the transcript afterwards means
 * the model hands over clean, typed fields. It also gives us a precise moment
 * to act on -- the model only calls it once the customer has confirmed, so we
 * never save a half-finished booking that was still being corrected.
 */
const SAVE_BOOKING_TOOL = {
  type: 'function',
  name: 'save_booking',
  description:
    'Save a confirmed salon appointment. Only call this after the customer has ' +
    'explicitly confirmed that the details you read back to them are correct. ' +
    'Never call it more than once for the same booking.',
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
      service: {
        type: 'string',
        description: 'The service being booked, matching a name from the price list.',
      },
      date: {
        type: 'string',
        description: 'The requested date, exactly as the customer expressed it.',
      },
      time: {
        type: 'string',
        description: 'The requested time, exactly as the customer expressed it.',
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

/**
 * Build the session configuration that OpenAI will attach to the token.
 *
 * Note the nesting: as of the GA Realtime API, voice lives at
 * `audio.output.voice` and turn detection at `audio.input.turn_detection`.
 * Older beta examples put these at the top level; that shape is now rejected.
 */
function buildSessionConfig() {
  return {
    type: 'realtime',
    model: process.env.OPENAI_REALTIME_MODEL || DEFAULT_MODEL,
    // The price list is baked into the instructions at mint time, so the
    // receptionist can quote from the same catalogue the website renders.
    instructions: buildReceptionistInstructions({
      menuText: formatCatalogForPrompt(),
      lowestPrice: formatPrice(getLowestPrice()),
    }),
    tools: [SAVE_BOOKING_TOOL],
    tool_choice: 'auto',
    audio: {
      input: {
        // Semantic VAD decides the customer has finished speaking based on whether
        // the sentence sounds complete, rather than purely on a silence timer.
        // For a booking conversation this matters: people pause mid-sentence while
        // recalling a phone number, and a plain silence timer interrupts them.
        turn_detection: {
          type: 'semantic_vad',
          eagerness: 'auto',
          // Let the model reply on its own once the customer stops talking, and
          // let the customer cut the model off mid-sentence. Together these are
          // what make the exchange feel like a real phone call.
          create_response: true,
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
  };
}
