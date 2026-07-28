/**
 * Booking validation, storage and downstream notification.
 *
 * Storage is a JSON file rather than a database: the MVP needs durability and
 * an audit trail, not queries, and a file keeps the dependency list at two.
 *
 * The ordering here is deliberate. A booking is written to disk FIRST and only
 * then pushed to n8n. If the webhook is down, misconfigured or slow, the
 * customer's booking still exists and the call still completes successfully.
 * Treating the webhook as best-effort rather than as part of the critical path
 * is what stops an automation outage from becoming a lost customer.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const BOOKINGS_PATH = path.join(DATA_DIR, 'bookings.json');

const WEBHOOK_TIMEOUT_MS = 5000;

/** Fields the receptionist must collect before a booking is accepted. */
const REQUIRED_FIELDS = ['customerName', 'phone', 'service', 'date', 'time'];

export class BookingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'BookingError';
    this.status = status;
  }
}

/**
 * Check and normalise incoming booking details.
 *
 * These arrive from the model via the browser, so they are untrusted input and
 * are validated here regardless of what the model was instructed to send.
 * Lengths are capped because a transcription glitch could otherwise write an
 * enormous string straight to disk.
 */
function validateBooking(input) {
  if (!input || typeof input !== 'object') {
    throw new BookingError('Booking details are missing.');
  }

  const booking = {};

  for (const field of REQUIRED_FIELDS) {
    const value = input[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BookingError(`Missing or invalid field: ${field}`);
    }
    booking[field] = value.trim().slice(0, 200);
  }

  // Optional extras the model may supply.
  if (typeof input.notes === 'string') {
    booking.notes = input.notes.trim().slice(0, 500);
  }
  if (typeof input.quotedPrice === 'string' || typeof input.quotedPrice === 'number') {
    booking.quotedPrice = String(input.quotedPrice).slice(0, 50);
  }

  return booking;
}

/**
 * Human-friendly reference the receptionist can read aloud.
 * Short and unambiguous over the phone: no vowels, so it cannot spell anything,
 * and no characters that sound alike.
 */
function createReference() {
  const alphabet = '3479CDFHJKLMNPRTWXY';
  let suffix = '';
  for (let i = 0; i < 5; i += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `BHS-${suffix}`;
}

async function readBookings() {
  try {
    return JSON.parse(await fs.readFile(BOOKINGS_PATH, 'utf8'));
  } catch (error) {
    // First run: the file does not exist yet.
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Send the booking to n8n, if a webhook is configured.
 *
 * Never throws. A failure here is logged and reported back to the caller as a
 * flag, because the booking itself has already been stored successfully.
 */
async function notifyWebhook(booking) {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return { attempted: false, delivered: false };

  try {
    // Without a timeout a hanging webhook would stall the caller, and the
    // customer would be left in silence waiting for the receptionist to reply.
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    if (!response.ok) {
      // n8n explains refusals in the body (inactive workflow, unknown path), so
      // log a slice of it: the status alone is not enough to tell them apart.
      const detail = await response.text().catch(() => '');
      console.error(
        `[booking] webhook responded ${response.status} ${detail.slice(0, 300)}`.trim(),
      );
      return { attempted: true, delivered: false };
    }

    return { attempted: true, delivered: true };
  } catch (error) {
    console.error('[booking] webhook failed:', error.message);
    return { attempted: true, delivered: false };
  }
}

/**
 * Validate, persist and forward a booking.
 *
 * @returns {Promise<{reference: string, booking: object, webhook: object}>}
 */
export async function createBooking(input) {
  const details = validateBooking(input);

  const booking = {
    reference: createReference(),
    createdAt: new Date().toISOString(),
    ...details,
  };

  await fs.mkdir(DATA_DIR, { recursive: true });

  const bookings = await readBookings();
  bookings.push(booking);

  // Read-modify-write is not safe against simultaneous writers. Acceptable for
  // a single-process demo; a real deployment would use a database instead.
  await fs.writeFile(BOOKINGS_PATH, JSON.stringify(bookings, null, 2), 'utf8');

  console.log(`[booking] stored ${booking.reference} for ${booking.customerName}`);

  const webhook = await notifyWebhook(booking);

  return { reference: booking.reference, booking, webhook };
}

/** All stored bookings, newest first. Useful for demoing what was captured. */
export async function listBookings() {
  const bookings = await readBookings();
  return [...bookings].reverse();
}
