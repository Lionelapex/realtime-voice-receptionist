/**
 * HTTP surface for Realtime session creation.
 *
 * Kept deliberately thin: routing and status codes only. All OpenAI knowledge
 * lives in the service layer, so this file stays readable and the service can
 * be reused later (for example by the Phase 2 booking webhook) without dragging
 * Express along with it.
 */

import { Router } from 'express';
import { createEphemeralSession } from '../services/realtimeSessionService.js';

const router = Router();

/**
 * POST /api/session
 *
 * Returns a fresh ephemeral client secret for the browser.
 *
 * The frontend must call this immediately before opening its WebRTC connection
 * rather than fetching a token once at page load. Observed TTL is around ten
 * minutes, which is long enough that reuse would appear to work during testing
 * and then fail for a real visitor who leaves the tab open before calling.
 */
router.post('/session', async (req, res, next) => {
  try {
    const session = await createEphemeralSession();

    // Never cache a credential.
    res.set('Cache-Control', 'no-store');
    res.json(session);
  } catch (error) {
    next(error);
  }
});

export default router;
