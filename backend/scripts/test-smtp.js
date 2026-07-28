/**
 * SMTP credential check.
 *
 * Talks raw SMTP over TLS and stops after AUTH, so it answers exactly one
 * question: does the mail server accept this username and password? No email
 * is sent. This exists because an SMTP failure inside an automation tool is
 * ambiguous - the credential could be wrong, or the tool could be storing or
 * escaping it badly - and testing against the server directly separates those.
 *
 * Credentials are read from .env so they never have to be typed on a command
 * line, where they would end up in shell history.
 *
 * Usage: node scripts/test-smtp.js
 */

import 'dotenv/config';
import tls from 'node:tls';

const HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const PORT = Number(process.env.SMTP_PORT) || 465;
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;

const TIMEOUT_MS = 15000;

/** Gmail's documented reply codes, translated into the actual fix. */
const HINTS = {
  535: [
    'Google rejected the username/password pair itself.',
    '  - A normal account password will always fail here; it must be an App Password.',
    '  - The App Password must belong to the same account as SMTP_USER.',
    '  - Check for a stray space or newline captured when pasting.',
  ],
  534: [
    'Google wants an application-specific password for this account.',
    '  - Generate one at https://myaccount.google.com/apppasswords',
  ],
  454: [
    'Temporary failure, often too many recent attempts.',
    '  - Wait a few minutes before retrying.',
  ],
};

function fail(message) {
  console.error(`FAIL - ${message}`);
  process.exit(1);
}

if (!USER || !PASS) {
  fail(
    'SMTP_USER and SMTP_PASS must be set in backend/.env before running this check.',
  );
}

/**
 * Wrap the socket in a request/response helper.
 *
 * SMTP replies can span several lines, and only the last one has a space after
 * the code (earlier ones use a hyphen). Waiting for that space is what stops a
 * multi-line greeting being mistaken for a complete reply.
 */
function createConversation(socket) {
  let buffer = '';
  let waiting = null;

  socket.setEncoding('utf8');

  socket.on('data', (chunk) => {
    buffer += chunk;

    const match = buffer.match(/^(\d{3}) [^\n]*\r?\n/m);
    if (!match || !waiting) return;

    const reply = { code: Number(match[1]), text: buffer.trim() };
    buffer = '';

    const { resolve } = waiting;
    waiting = null;
    resolve(reply);
  });

  return {
    read: () =>
      new Promise((resolve, reject) => {
        waiting = { resolve, reject };
      }),
    send(line) {
      socket.write(`${line}\r\n`);
    },
  };
}

const b64 = (value) => Buffer.from(value, 'utf8').toString('base64');

async function main() {
  console.log(`host = ${HOST}:${PORT}`);
  console.log(`user = ${USER}`);
  console.log(`pass = ${PASS.length} characters`);

  // A password containing whitespace is almost certainly a Gmail App Password
  // pasted in its displayed form, which is the most common cause of a 535.
  if (/\s/.test(PASS)) {
    console.log('');
    console.log('WARNING: password contains a space. Gmail App Passwords are');
    console.log('         displayed in four blocks but must be entered as 16');
    console.log('         characters with the spaces removed.');
  }
  console.log('');

  const socket = tls.connect({ host: HOST, port: PORT, servername: HOST });
  socket.setTimeout(TIMEOUT_MS);

  socket.on('timeout', () => {
    socket.destroy();
    fail(`no response within ${TIMEOUT_MS}ms. Port ${PORT} may be blocked.`);
  });
  socket.on('error', (error) => fail(`connection error: ${error.message}`));

  await new Promise((resolve) => socket.once('secureConnect', resolve));
  console.log('connected, TLS established');

  const smtp = createConversation(socket);

  const greeting = await smtp.read();
  if (greeting.code !== 220) fail(`unexpected greeting: ${greeting.text}`);
  console.log('greeting ok');

  smtp.send('EHLO localhost');
  const ehlo = await smtp.read();
  if (ehlo.code !== 250) fail(`EHLO refused: ${ehlo.text}`);
  console.log('EHLO ok');

  smtp.send('AUTH LOGIN');
  const authStart = await smtp.read();
  if (authStart.code !== 334) fail(`AUTH LOGIN refused: ${authStart.text}`);

  smtp.send(b64(USER));
  const userReply = await smtp.read();
  if (userReply.code !== 334) fail(`username refused: ${userReply.text}`);

  smtp.send(b64(PASS));
  const passReply = await smtp.read();

  socket.end();

  if (passReply.code === 235) {
    console.log('');
    console.log('PASS - the mail server accepted these credentials.');
    console.log('       Use these exact values in the n8n SMTP credential.');
    return;
  }

  console.log('');
  console.error(`FAIL - authentication rejected (${passReply.code})`);
  console.error(passReply.text);

  const hint = HINTS[passReply.code];
  if (hint) {
    console.error('');
    for (const line of hint) console.error(line);
  }
  process.exit(1);
}

main().catch((error) => fail(error.message));
