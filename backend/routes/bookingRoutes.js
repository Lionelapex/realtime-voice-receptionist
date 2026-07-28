/**
 * Booking capture endpoint.
 *
 * Called by the browser when the model invokes its save_booking tool. Because
 * that path runs through the client, everything arriving here is treated as
 * untrusted and re-validated in the service layer.
 */

import { Router } from 'express';
import { createBooking, listBookings } from '../services/bookingService.js';

const router = Router();

/** POST /api/bookings -> validate, store, and forward to n8n. */
router.post('/bookings', async (req, res, next) => {
  try {
    const { reference, webhook } = await createBooking(req.body);

    // The reference is echoed back so the receptionist can read it aloud.
    res.status(201).json({ ok: true, reference, webhook });
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
