/**
 * Public price list endpoint.
 *
 * The website fetches this instead of hard-coding prices in markup, which is
 * what guarantees the menu a visitor reads matches the prices the receptionist
 * quotes out loud.
 */

import { Router } from 'express';
import { getCatalog } from '../services/servicesCatalog.js';

const router = Router();

/** GET /api/services -> the full price catalogue. */
router.get('/services', (req, res) => {
  // The catalogue only changes on redeploy, so let browsers hold onto it
  // briefly rather than refetching on every navigation.
  res.set('Cache-Control', 'public, max-age=300');
  res.json(getCatalog());
});

export default router;
