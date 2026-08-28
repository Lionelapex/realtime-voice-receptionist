/**
 * Booking capture, availability, reschedule and cancel endpoints.
 *
 * Called by the browser when the model invokes Realtime tools. Everything
 * arriving here is treated as untrusted and re-validated in the service layer.
 */

import { Router } from 'express';
import {
  cancelBooking,
  checkAvailability,
  createBooking,
  listBookings,
  rescheduleBooking,
} from '../services/bookingService.js';

const router = Router();

/** POST /api/availability -> open Cal.com slots for a day or range. */
router.post('/availability', async (req, res, next) => {
  try {
    const result = await checkAvailability(req.body || {});
    res.status(result.ok ? 200 : 502).json(result);
  } catch (error) {
    next(error);
  }
});

/** POST /api/bookings -> validate, store, and create a Cal.com event. */
router.post('/bookings', async (req, res, next) => {
  try {
    const result = await createBooking(req.body);
    res.status(result.ok ? 201 : 409).json(result);
  } catch (error) {
    next(error);
  }
});

/** POST /api/bookings/reschedule -> move an existing Cal.com appointment. */
router.post('/bookings/reschedule', async (req, res, next) => {
  try {
    const result = await rescheduleBooking(req.body || {});
    res.status(result.ok ? 200 : 409).json(result);
  } catch (error) {
    next(error);
  }
});

/** POST /api/bookings/cancel -> cancel an existing Cal.com appointment. */
router.post('/bookings/cancel', async (req, res, next) => {
  try {
    const result = await cancelBooking(req.body || {});
    res.status(result.ok ? 200 : 409).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/bookings -> everything captured so far.
 *
 * Handy for demonstrating that a conversation really produced structured data.
 * This would need authentication before any real deployment; it exposes
 * customer names and phone numbers.
 */
router.get('/bookings', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await listBookings());
  } catch (error) {
    next(error);
  }
});

export default router;
