/**
 * Express application entry point.
 *
 * Responsibilities:
 *   - load environment variables
 *   - serve the static frontend
 *   - expose the /api routes
 *   - translate errors into clean JSON responses
 *
 * Deliberately boring. Any real logic belongs in routes/ or services/.
 */

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import sessionRoutes from './routes/sessionRoutes.js';
import servicesRoutes from './routes/servicesRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '..', 'frontend');
const PORT = Number(process.env.PORT) || 3000;

const app = express();

app.use(express.json());

/**
 * Serve the frontend from this same Express server.
 *
 * This is not just convenience. `navigator.mediaDevices.getUserMedia` only
 * exists in a secure context, which means HTTPS *or* localhost. Opening
 * index.html straight from disk as a file:// URL leaves mediaDevices undefined
 * and the microphone request fails before it is ever shown to the user.
 * Serving from http://localhost keeps us in a secure context and, as a bonus,
 * puts the API on the same origin so there is no CORS to configure.
 */
app.use(express.static(FRONTEND_DIR));

app.use('/api', sessionRoutes);
app.use('/api', servicesRoutes);
app.use('/api', bookingRoutes);

// Cheap endpoint for confirming the process is alive without spending an
// OpenAI request.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', hasApiKey: Boolean(process.env.OPENAI_API_KEY) });
});

/**
 * Central error handler.
 *
 * `detail` is logged in full on the server but only echoed to the client in
 * development, so production responses cannot leak upstream error text.
 */
app.use((error, req, res, next) => {
  const status = error.status || 500;

  console.error(`[error] ${req.method} ${req.originalUrl}:`, error.message);
  if (error.detail) {
    console.error('[error] detail:', error.detail);
  }

  res.status(status).json({
    error: error.message || 'Internal server error.',
    ...(process.env.NODE_ENV !== 'production' && error.detail
      ? { detail: error.detail }
      : {}),
  });
});

app.listen(PORT, () => {
  console.log(`AI Receptionist server running at http://localhost:${PORT}`);

  // Warn loudly but do not exit: a missing key should not stop you from
  // loading the page and seeing the UI. The failure then surfaces as a clear
  // message when you click the talk button, rather than as a crashed process.
  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      '\n  WARNING: OPENAI_API_KEY is not set.\n' +
        '  Copy backend/.env.example to backend/.env and add your key.\n' +
        '  The page will load, but starting a call will fail.\n',
    );
  }
});
