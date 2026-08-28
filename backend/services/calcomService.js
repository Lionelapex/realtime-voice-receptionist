/**
 * Cal.com diary integration: create, availability, reschedule, cancel.
 *
 * Auth: Authorization Bearer with a Cal.com API key (cal_ / cal_live_).
 * Slots use GET /v2/slots/available (verified against this account).
 * Bookings use POST /v2/bookings, …/reschedule, …/cancel.
 */

const CALCOM_API_BASE = 'https://api.cal.com/v2';
const CALCOM_API_VERSION = '2024-08-13';
const REQUEST_TIMEOUT_MS = 10000;

/** South Africa — fixed offset, no DST. Wall times are interpreted here. */
export const DEFAULT_TIME_ZONE = 'Africa/Johannesburg';
const SA_OFFSET = '+02:00';

const MAX_DAYS = 14;
const MAX_TIMES_PER_DAY = 16;

/**
 * @returns {{ configured: boolean, missing: string[] }}
 */
export function getCalcomConfigStatus() {
  const missing = [];
  if (!process.env.CALCOM_API_KEY?.trim()) missing.push('CALCOM_API_KEY');
  if (!process.env.CALCOM_EVENT_TYPE_ID?.trim()) missing.push('CALCOM_EVENT_TYPE_ID');
  return { configured: missing.length === 0, missing };
}

function requireConfig() {
  const { configured, missing } = getCalcomConfigStatus();
  if (!configured) {
    return {
      ok: false,
      error: `Cal.com is not configured (missing ${missing.join(', ')}).`,
    };
  }
  const eventTypeId = Number(process.env.CALCOM_EVENT_TYPE_ID);
  if (!Number.isFinite(eventTypeId) || eventTypeId <= 0) {
    return { ok: false, error: 'CALCOM_EVENT_TYPE_ID must be a positive number.' };
  }
  return {
    ok: true,
    apiKey: process.env.CALCOM_API_KEY.trim(),
    eventTypeId,
    timeZone: process.env.CALCOM_TIMEZONE?.trim() || DEFAULT_TIME_ZONE,
  };
}

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'cal-api-version': CALCOM_API_VERSION,
  };
}

/**
 * Normalise a South African mobile to E.164 (+27…).
 */
export function toE164Phone(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return null;

  if (raw.startsWith('+')) {
    const digits = raw.slice(1).replace(/\D/g, '');
    return digits ? `+${digits}` : null;
  }

  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith('27') && digits.length >= 11) {
    return `+${digits}`;
  }

  if (digits.startsWith('0') && digits.length === 10) {
    return `+27${digits.slice(1)}`;
  }

  if (digits.length === 9) {
    return `+27${digits}`;
  }

  return `+${digits}`;
}

/**
 * Parse spoken/tool date + time into a UTC ISO start string for Cal.com.
 */
export function resolveStartUtcIso(dateText, timeText) {
  const date = parseDateParts(dateText);
  const time = parseTimeParts(timeText);
  if (!date || !time) {
    throw new Error(
      'Could not parse appointment date/time. Use YYYY-MM-DD and HH:mm (South Africa time).',
    );
  }

  const { year, month, day } = date;
  const { hour, minute } = time;
  const wall = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${SA_OFFSET}`;
  const instant = new Date(wall);

  if (Number.isNaN(instant.getTime())) {
    throw new Error('Appointment date/time is not a valid calendar moment.');
  }

  return instant.toISOString();
}

export function normalizeTimeHm(timeText) {
  const parts = parseTimeParts(timeText);
  if (!parts) return null;
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function normalizeDateYmd(dateText) {
  const parts = parseDateParts(dateText);
  if (!parts) return null;
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Today's calendar date in the salon timezone as YYYY-MM-DD. */
export function todayInSalonTz(timeZone = DEFAULT_TIME_ZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d) + days * 86400000;
  const dt = new Date(utc);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function parseDateParts(text) {
  const value = String(text || '').trim();
  if (!value) return null;

  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    };
  }

  match = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (match) {
    return {
      day: Number(match[1]),
      month: Number(match[2]),
      year: Number(match[3]),
    };
  }

  return null;
}

function parseTimeParts(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return null;

  let match = value.match(/^(\d{1,2})[:.](\d{2})\s*(am|pm)?$/i);
  if (!match) {
    match = value.match(/^(\d{1,2})\s*(am|pm)$/i);
    if (!match) return null;
    match = [match[0], match[1], '0', match[2]];
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();

  if (minute > 59) return null;

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (!meridiem && (hour > 23 || hour < 0)) return null;
  if (meridiem && (hour > 23 || hour < 0)) return null;

  return { hour, minute };
}

function guestEmailForPhone(phoneE164) {
  const domain = (process.env.CALCOM_GUEST_EMAIL_DOMAIN || 'guest.bellahairstudio.local').trim();
  const local = (phoneE164 || 'unknown').replace(/\D/g, '') || 'unknown';
  return `booking+${local}@${domain}`;
}

function utcToSalonHm(isoUtc, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(isoUtc));
}

function weekdayName(ymd, timeZone) {
  const [y, m, d] = ymd.split('-').map(Number);
  // Noon UTC avoids DST edge cases; SA has no DST anyway.
  const instant = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone,
    weekday: 'long',
  }).format(instant);
}

function eachDateInclusive(startYmd, endYmd) {
  const out = [];
  let cur = startYmd;
  while (cur <= endYmd) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
    if (out.length > MAX_DAYS + 2) break;
  }
  return out;
}

/**
 * Fetch open slots from Cal.com for one day or a short range.
 *
 * @param {{ date?: string, endDate?: string }} input
 */
export async function getAvailableSlots(input = {}) {
  const cfg = requireConfig();
  if (!cfg.ok) return cfg;

  const timeZone = cfg.timeZone;
  const startDate = normalizeDateYmd(input.date) || todayInSalonTz(timeZone);
  const endDate =
    normalizeDateYmd(input.endDate) ||
    addDaysYmd(startDate, input.date ? 0 : 6);

  const startTime = `${startDate}T00:00:00.000Z`;
  const endExclusive = addDaysYmd(endDate, 1);
  const endTime = `${endExclusive}T00:00:00.000Z`;

  const url = new URL(`${CALCOM_API_BASE}/slots/available`);
  url.searchParams.set('eventTypeId', String(cfg.eventTypeId));
  url.searchParams.set('startTime', startTime);
  url.searchParams.set('endTime', endTime);

  try {
    const response = await fetch(url, {
      headers: authHeaders(cfg.apiKey),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail =
        payload?.error?.message ||
        payload?.message ||
        JSON.stringify(payload).slice(0, 300);
      console.error(`[calcom] slots failed ${response.status}: ${detail}`);
      return { ok: false, error: detail || `Cal.com slots HTTP ${response.status}` };
    }

    const rawSlots = payload?.data?.slots || payload?.slots || {};
    const days = [];

    for (const [dayKey, entries] of Object.entries(rawSlots)) {
      if (!Array.isArray(entries) || entries.length === 0) continue;
      const times = [];
      for (const entry of entries) {
        const iso = entry?.time || entry;
        if (typeof iso !== 'string') continue;
        const hm = utcToSalonHm(iso, timeZone);
        if (hm && !times.includes(hm)) times.push(hm);
        if (times.length >= MAX_TIMES_PER_DAY) break;
      }
      if (times.length) {
        days.push({ date: dayKey.slice(0, 10), times });
      }
      if (days.length >= MAX_DAYS) break;
    }

    days.sort((a, b) => a.date.localeCompare(b.date));

    const openByDate = new Map(days.map((d) => [d.date, d]));
    const unavailableDays = [];
    for (const date of eachDateInclusive(startDate, endDate)) {
      if (openByDate.has(date)) continue;
      const weekday = weekdayName(date, timeZone);
      unavailableDays.push({
        date,
        weekday,
        reason: 'closed_or_fully_booked',
        message:
          `No open appointment times on ${weekday} ${date}. ` +
          `The salon is closed or fully booked that day — please choose another day.`,
      });
    }

    return {
      ok: true,
      timezone: timeZone,
      startDate,
      endDate,
      days,
      unavailableDays,
      totalSlots: days.reduce((n, d) => n + d.times.length, 0),
    };
  } catch (error) {
    console.error('[calcom] slots request failed:', error.message);
    return { ok: false, error: error.message };
  }
}

/**
 * True if Cal.com currently lists this local date+time as bookable.
 * Distinguishes a closed/full day from a single taken time.
 */
export async function isSlotOpen(dateText, timeText) {
  const date = normalizeDateYmd(dateText);
  const time = normalizeTimeHm(timeText);
  if (!date || !time) {
    return { ok: false, available: false, error: 'Invalid date or time format.' };
  }

  const slots = await getAvailableSlots({ date });
  if (!slots.ok) return { ok: false, available: false, error: slots.error };

  const day = slots.days.find((d) => d.date === date);
  const weekday = weekdayName(date, slots.timezone || DEFAULT_TIME_ZONE);

  if (!day || day.times.length === 0) {
    return {
      ok: true,
      available: false,
      date,
      time,
      weekday,
      reason: 'closed_or_fully_booked',
      nearbyTimes: [],
      message:
        `No open appointment times on ${weekday} ${date}. ` +
        `The salon is closed or fully booked that day — please choose another day.`,
    };
  }

  const available = day.times.includes(time);
  if (available) {
    return {
      ok: true,
      available: true,
      date,
      time,
      weekday,
      reason: 'available',
      nearbyTimes: day.times.slice(0, 8),
    };
  }

  return {
    ok: true,
    available: false,
    date,
    time,
    weekday,
    reason: 'time_taken',
    nearbyTimes: day.times.slice(0, 8),
    message:
      `${time} on ${weekday} ${date} is currently unavailable because it is already booked. ` +
      `Other open times that day include: ${day.times.slice(0, 8).join(', ')}.`,
  };
}

/**
 * Create a Cal.com booking for a stored salon appointment.
 */
export async function createCalcomBooking(booking) {
  const cfg = requireConfig();
  if (!cfg.ok) {
    return { attempted: false, delivered: false, error: cfg.error };
  }

  const phoneE164 = toE164Phone(booking.phone);
  const email =
    (typeof booking.email === 'string' && booking.email.includes('@')
      ? booking.email.trim()
      : null) ||
    process.env.CALCOM_DEFAULT_ATTENDEE_EMAIL?.trim() ||
    guestEmailForPhone(phoneE164);

  let start;
  try {
    start = resolveStartUtcIso(booking.date, booking.time);
  } catch (error) {
    return { attempted: false, delivered: false, error: error.message };
  }

  const body = {
    start,
    eventTypeId: cfg.eventTypeId,
    attendee: {
      name: booking.customerName,
      email,
      timeZone: cfg.timeZone,
      language: 'en',
      ...(phoneE164 ? { phoneNumber: phoneE164 } : {}),
    },
    metadata: {
      reference: booking.reference,
      service: booking.service,
      phone: booking.phone,
      ...(booking.quotedPrice ? { quotedPrice: String(booking.quotedPrice) } : {}),
      ...(booking.notes ? { notes: booking.notes } : {}),
      source: 'bella-voice-receptionist',
    },
    bookingFieldsResponses: {
      notes: [
        `Ref ${booking.reference}`,
        `Service: ${booking.service}`,
        booking.quotedPrice ? `Quoted from: ${booking.quotedPrice}` : null,
        booking.notes || null,
        `Phone: ${booking.phone}`,
      ]
        .filter(Boolean)
        .join('\n'),
    },
  };

  const locationType = (process.env.CALCOM_LOCATION_TYPE || 'none').trim();
  if (locationType === 'attendeePhone' && phoneE164) {
    body.location = { type: 'attendeePhone', phone: phoneE164 };
  } else if (locationType === 'phone') {
    body.location = { type: 'phone' };
  } else if (locationType === 'address') {
    body.location = { type: 'address' };
  } else if (locationType && locationType !== 'none') {
    body.location = { type: locationType };
  }

  try {
    const response = await fetch(`${CALCOM_API_BASE}/bookings`, {
      method: 'POST',
      headers: authHeaders(cfg.apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail =
        payload?.error?.message ||
        payload?.message ||
        JSON.stringify(payload).slice(0, 400);
      console.error(`[calcom] booking failed ${response.status}: ${detail}`);
      return {
        attempted: true,
        delivered: false,
        error: detail || `Cal.com HTTP ${response.status}`,
      };
    }

    const data = payload?.data || payload;
    console.log(
      `[calcom] booked ${booking.reference} -> uid=${data?.uid || 'n/a'} id=${data?.id || 'n/a'}`,
    );

    return {
      attempted: true,
      delivered: true,
      uid: data?.uid ? String(data.uid) : undefined,
      id: typeof data?.id === 'number' ? data.id : undefined,
    };
  } catch (error) {
    console.error('[calcom] request failed:', error.message);
    return { attempted: true, delivered: false, error: error.message };
  }
}

/**
 * Move an existing Cal.com booking to a new local date/time.
 */
export async function rescheduleCalcomBooking({ uid, date, time, reason }) {
  const cfg = requireConfig();
  if (!cfg.ok) {
    return { attempted: false, delivered: false, error: cfg.error };
  }
  if (!uid) {
    return { attempted: false, delivered: false, error: 'Missing Cal.com booking uid.' };
  }

  let start;
  try {
    start = resolveStartUtcIso(date, time);
  } catch (error) {
    return { attempted: false, delivered: false, error: error.message };
  }

  try {
    const response = await fetch(
      `${CALCOM_API_BASE}/bookings/${encodeURIComponent(uid)}/reschedule`,
      {
        method: 'POST',
        headers: authHeaders(cfg.apiKey),
        body: JSON.stringify({
          start,
          reschedulingReason: reason || 'Customer requested a different time',
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail =
        payload?.error?.message ||
        payload?.message ||
        JSON.stringify(payload).slice(0, 400);
      console.error(`[calcom] reschedule failed ${response.status}: ${detail}`);
      return {
        attempted: true,
        delivered: false,
        error: detail || `Cal.com HTTP ${response.status}`,
      };
    }

    const data = payload?.data || payload;
    console.log(`[calcom] rescheduled ${uid} -> ${data?.uid || uid}`);
    return {
      attempted: true,
      delivered: true,
      uid: data?.uid ? String(data.uid) : String(uid),
      id: typeof data?.id === 'number' ? data.id : undefined,
      start: data?.start,
    };
  } catch (error) {
    console.error('[calcom] reschedule request failed:', error.message);
    return { attempted: true, delivered: false, error: error.message };
  }
}

/**
 * Cancel an existing Cal.com booking.
 */
export async function cancelCalcomBooking({ uid, reason }) {
  const cfg = requireConfig();
  if (!cfg.ok) {
    return { attempted: false, delivered: false, error: cfg.error };
  }
  if (!uid) {
    return { attempted: false, delivered: false, error: 'Missing Cal.com booking uid.' };
  }

  try {
    const response = await fetch(
      `${CALCOM_API_BASE}/bookings/${encodeURIComponent(uid)}/cancel`,
      {
        method: 'POST',
        headers: authHeaders(cfg.apiKey),
        body: JSON.stringify({
          cancellationReason: reason || 'Customer requested cancellation',
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail =
        payload?.error?.message ||
        payload?.message ||
        JSON.stringify(payload).slice(0, 400);
      console.error(`[calcom] cancel failed ${response.status}: ${detail}`);
      return {
        attempted: true,
        delivered: false,
        error: detail || `Cal.com HTTP ${response.status}`,
      };
    }

    console.log(`[calcom] cancelled ${uid}`);
    return { attempted: true, delivered: true, uid: String(uid) };
  } catch (error) {
    console.error('[calcom] cancel request failed:', error.message);
    return { attempted: true, delivered: false, error: error.message };
  }
}
