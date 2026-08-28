/**
 * Booking validation, storage and Cal.com diary operations.
 *
 * Local JSON is the demo audit trail. Cal.com is the live diary for open slots,
 * creates, reschedules and cancellations.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cancelCalcomBooking,
  createCalcomBooking,
  getAvailableSlots,
  getCalcomConfigStatus,
  isSlotOpen,
  normalizeDateYmd,
  normalizeTimeHm,
  rescheduleCalcomBooking,
  toE164Phone,
} from './calcomService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const BOOKINGS_PATH = path.join(DATA_DIR, 'bookings.json');

const REQUIRED_FIELDS = ['customerName', 'phone', 'service', 'date', 'time'];

export class BookingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'BookingError';
    this.status = status;
  }
}

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

  const date = normalizeDateYmd(booking.date);
  const time = normalizeTimeHm(booking.time);
  if (!date || !time) {
    throw new BookingError(
      'date must be YYYY-MM-DD and time must be HH:mm (South Africa time).',
    );
  }
  booking.date = date;
  booking.time = time;

  if (typeof input.notes === 'string') {
    booking.notes = input.notes.trim().slice(0, 500);
  }
  if (typeof input.quotedPrice === 'string' || typeof input.quotedPrice === 'number') {
    booking.quotedPrice = String(input.quotedPrice).slice(0, 50);
  }
  if (typeof input.email === 'string' && input.email.trim().includes('@')) {
    booking.email = input.email.trim().toLowerCase().slice(0, 200);
  }

  return booking;
}

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
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeBookings(bookings) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(BOOKINGS_PATH, JSON.stringify(bookings, null, 2), 'utf8');
}

function phonesMatch(a, b) {
  const left = toE164Phone(a);
  const right = toE164Phone(b);
  if (left && right) return left === right;
  const digits = (value) => String(value || '').replace(/\D/g, '');
  const da = digits(a);
  const db = digits(b);
  if (!da || !db) return false;
  return da === db || da.endsWith(db) || db.endsWith(da);
}

function normalizePersonName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(a, b) {
  const left = normalizePersonName(a);
  const right = normalizePersonName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  // Allow "Lionel" matching "Lionel John" and the reverse.
  return left.includes(right) || right.includes(left);
}

/**
 * Require phone + name identity checks before changing or cancelling.
 * Reference is optional and only narrows the search when provided.
 */
function requireIdentity(input) {
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  const customerName =
    typeof input.customerName === 'string' ? input.customerName.trim() : '';

  if (!phone) {
    throw new BookingError('Phone number is required to find and verify the booking.', 400);
  }
  if (!customerName) {
    throw new BookingError('Customer name is required to verify the booking.', 400);
  }

  return {
    phone,
    customerName,
    reference: typeof input.reference === 'string' ? input.reference.trim() : '',
  };
}

/**
 * Find the newest active local booking by optional reference and required phone,
 * then verify the spoken name matches.
 */
function findVerifiedBooking(bookings, { reference, phone, customerName }) {
  const existing = findActiveBooking(bookings, { reference, phone });

  if (!namesMatch(existing.customerName, customerName)) {
    throw new BookingError(
      'The name does not match the booking on file. Please confirm the full name used when booking.',
      403,
    );
  }

  if (reference) {
    const ref = reference.trim().toUpperCase();
    if (String(existing.reference).toUpperCase() !== ref) {
      // Reference was wrong but phone+name matched a booking — still refuse if
      // they supplied a different reference that belongs to someone else.
      const other = bookings.find(
        (row) =>
          row &&
          row.status !== 'cancelled' &&
          String(row.reference).toUpperCase() === ref,
      );
      if (other && !phonesMatch(other.phone, phone)) {
        throw new BookingError(
          'That reference does not match this caller. Please check the reference or continue with name and phone only.',
          403,
        );
      }
    }
  }

  return existing;
}

/**
 * Find the newest active local booking by reference and/or phone.
 */
function findActiveBooking(bookings, { reference, phone }) {
  const ref = typeof reference === 'string' ? reference.trim().toUpperCase() : '';
  const phoneFilter = typeof phone === 'string' ? phone.trim() : '';

  const candidates = [...bookings]
    .reverse()
    .filter((row) => row && row.status !== 'cancelled');

  if (ref) {
    const byRef = candidates.find((row) => String(row.reference).toUpperCase() === ref);
    if (byRef) {
      if (phoneFilter && !phonesMatch(byRef.phone, phoneFilter)) {
        throw new BookingError(
          'That reference does not match the phone number given.',
          404,
        );
      }
      return byRef;
    }
    // Fall through to phone lookup when reference is unknown / mistyped.
  }

  if (phoneFilter) {
    const byPhone = candidates.find((row) => phonesMatch(row.phone, phoneFilter));
    if (byPhone) return byPhone;
  }

  throw new BookingError(
    'No active booking found for that phone number. Ask them to confirm the number used when booking.',
    404,
  );
}

/** Open slots from Cal.com for the voice agent. */
export async function checkAvailability(input = {}) {
  const result = await getAvailableSlots({
    date: input.date,
    endDate: input.endDate,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error || 'Could not load availability from the calendar.',
    };
  }

  // Keep the tool payload small enough to speak from.
  const days = (result.days || []).map((day) => ({
    date: day.date,
    times: day.times.slice(0, 10),
    moreTimes: Math.max(0, day.times.length - 10),
  }));

  const unavailableDays = (result.unavailableDays || []).map((day) => ({
    date: day.date,
    weekday: day.weekday,
    reason: day.reason,
    message: day.message,
  }));

  return {
    ok: true,
    timezone: result.timezone,
    startDate: result.startDate,
    endDate: result.endDate,
    totalSlots: result.totalSlots,
    days,
    unavailableDays,
  };
}

/**
 * Validate, persist and create the Cal.com calendar event.
 */
export async function createBooking(input) {
  const details = validateBooking(input);
  const { configured: calcomConfigured } = getCalcomConfigStatus();

  if (calcomConfigured) {
    const slot = await isSlotOpen(details.date, details.time);
    if (slot.ok && !slot.available) {
      return {
        ok: false,
        reference: null,
        booking: null,
        calcom: { attempted: false, delivered: false },
        reason: slot.reason,
        error:
          slot.message ||
          `That time is not available on ${details.date}. Open times include: ${(slot.nearbyTimes || []).join(', ') || 'none listed'}.`,
        nearbyTimes: slot.nearbyTimes,
      };
    }
  }

  const booking = {
    reference: createReference(),
    createdAt: new Date().toISOString(),
    status: 'confirmed',
    ...details,
  };

  const bookings = await readBookings();
  bookings.push(booking);
  await writeBookings(bookings);

  console.log(`[booking] stored ${booking.reference} for ${booking.customerName}`);

  const calcom = await createCalcomBooking(booking);

  if (calcom.delivered && (calcom.uid || calcom.id)) {
    booking.calcomUid = calcom.uid;
    booking.calcomId = calcom.id;
    const latest = await readBookings();
    const idx = latest.findIndex((row) => row.reference === booking.reference);
    if (idx >= 0) {
      latest[idx] = { ...latest[idx], calcomUid: calcom.uid, calcomId: calcom.id };
      await writeBookings(latest);
    }
  } else if (calcom.error) {
    console.warn(`[booking] Cal.com not delivered for ${booking.reference}: ${calcom.error}`);
  }

  const ok = !calcomConfigured || calcom.delivered === true;

  return {
    reference: booking.reference,
    booking,
    calcom,
    ok,
    confirmationEmail: ok ? booking.email : undefined,
    error: ok
      ? undefined
      : calcom.error || 'The calendar could not accept this appointment time.',
  };
}

/**
 * Change an existing appointment to a new Cal.com slot.
 */
export async function rescheduleBooking(input = {}) {
  const date = normalizeDateYmd(input.date);
  const time = normalizeTimeHm(input.time);
  if (!date || !time) {
    throw new BookingError(
      'New date must be YYYY-MM-DD and time must be HH:mm (South Africa time).',
    );
  }

  const identity = requireIdentity(input);
  const bookings = await readBookings();
  const existing = findVerifiedBooking(bookings, identity);

  if (!existing.calcomUid) {
    throw new BookingError(
      'That booking is not linked to the calendar, so it cannot be rescheduled automatically.',
      409,
    );
  }

  const { configured: calcomConfigured } = getCalcomConfigStatus();
  if (calcomConfigured) {
    const slot = await isSlotOpen(date, time);
    if (slot.ok && !slot.available) {
      return {
        ok: false,
        reference: existing.reference,
        reason: slot.reason,
        error:
          slot.message ||
          `That new time is not available on ${date}. Open times include: ${(slot.nearbyTimes || []).join(', ') || 'none listed'}.`,
        nearbyTimes: slot.nearbyTimes,
      };
    }
  }

  const calcom = await rescheduleCalcomBooking({
    uid: existing.calcomUid,
    date,
    time,
    reason: typeof input.reason === 'string' ? input.reason.slice(0, 300) : undefined,
  });

  const ok = calcom.delivered === true;
  if (ok) {
    const idx = bookings.findIndex((row) => row.reference === existing.reference);
    if (idx >= 0) {
      bookings[idx] = {
        ...bookings[idx],
        date,
        time,
        status: 'confirmed',
        calcomUid: calcom.uid || bookings[idx].calcomUid,
        calcomId: calcom.id ?? bookings[idx].calcomId,
        rescheduledAt: new Date().toISOString(),
        previousDate: existing.date,
        previousTime: existing.time,
      };
      await writeBookings(bookings);
    }
    console.log(`[booking] rescheduled ${existing.reference} -> ${date} ${time}`);
  }

  return {
    ok,
    reference: existing.reference,
    date,
    time,
    calcom,
    error: ok
      ? undefined
      : calcom.error || 'Could not reschedule this appointment on the calendar.',
  };
}

/**
 * Cancel an existing appointment on Cal.com and mark local row cancelled.
 * Requires verified name + phone; reference is optional helper only.
 */
export async function cancelBooking(input = {}) {
  const identity = requireIdentity(input);
  const bookings = await readBookings();
  const existing = findVerifiedBooking(bookings, identity);

  if (!existing.calcomUid) {
    throw new BookingError(
      'That booking is not linked to the calendar, so it cannot be cancelled automatically.',
      409,
    );
  }

  const calcom = await cancelCalcomBooking({
    uid: existing.calcomUid,
    reason: typeof input.reason === 'string' ? input.reason.slice(0, 300) : undefined,
  });

  const ok = calcom.delivered === true;
  if (ok) {
    const idx = bookings.findIndex((row) => row.reference === existing.reference);
    if (idx >= 0) {
      bookings[idx] = {
        ...bookings[idx],
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        cancelledByName: identity.customerName,
        cancelledByPhone: identity.phone,
      };
      await writeBookings(bookings);
    }
    console.log(`[booking] cancelled ${existing.reference}`);
  }

  return {
    ok,
    reference: existing.reference,
    calcom,
    error: ok
      ? undefined
      : calcom.error || 'Could not cancel this appointment on the calendar.',
  };
}

export async function listBookings() {
  const bookings = await readBookings();
  return [...bookings].reverse();
}
