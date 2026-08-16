/**
 * HTTP surface for Realtime session creation and locale discovery.
 */

import { Router } from 'express';
import { createEphemeralSession } from '../services/realtimeSessionService.js';
import {
  localeDisplayName,
  resolveReceptionistLocale,
  SUPPORTED_LOCALES,
} from '../services/locale.js';

const router = Router();

/**
 * GET /api/locale
 *
 * Lets the call UI know which language the receptionist is configured for
 * (RECEPTIONIST_LOCALE) before a session is minted.
 */
router.get('/locale', (req, res) => {
  const locale = resolveReceptionistLocale();
  res.set('Cache-Control', 'no-store');
  res.json({
    locale,
    localeName: localeDisplayName(locale),
    supported: SUPPORTED_LOCALES,
  });
});

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
