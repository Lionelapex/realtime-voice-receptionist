/**
 * app.js
 *
 * The UI layer. Its only responsibilities are wiring up the button, rendering
 * call state, and showing errors.
 *
 * All connection logic lives in realtime.js. This file never touches WebRTC,
 * tokens or media streams -- it reacts to state names and renders them. Keeping
 * the boundary that strict is what makes the UI safe to redesign later.
 */

import { createRealtimeCall, CallState } from './realtime.js';

const callButton = document.getElementById('call-button');
const callButtonLabel = document.getElementById('call-button-label');
const statusText = document.getElementById('status-text');
const errorBox = document.getElementById('error-box');
const errorText = document.getElementById('error-text');
const audioElement = document.getElementById('ai-audio');
const bookingBox = document.getElementById('booking-box');
const bookingReference = document.getElementById('booking-reference');
const bookingSummary = document.getElementById('booking-summary');


const STATE_PRESENTATION = {
  [CallState.IDLE]: {
    label: 'Talk to Desk',
    status: 'Ready when you are.',
    busy: false,
  },
  [CallState.REQUESTING_MIC]: {
    label: 'Allow mic\u2026',
    status: 'Waiting for microphone permission\u2026',
    busy: true,
  },
  [CallState.CONNECTING]: {
    label: 'Connecting\u2026',
    status: 'Connecting you to the receptionist\u2026',
    busy: true,
  },
  [CallState.LISTENING]: {
    label: 'End call',
    status: 'Listening\u2026 go ahead and speak.',
    busy: false,
  },
  [CallState.SPEAKING]: {
    label: 'End call',
    status: 'The receptionist is speaking\u2026',
    busy: false,
  },
  [CallState.ENDED]: {
    label: 'Talk to Desk',
    status: 'Call ended. Thanks for calling.',
    busy: false,
  },
  [CallState.ERROR]: {
    label: 'Try again',
    status: 'Something went wrong.',
    busy: false,
  },
};

/** States in which a call is live, so the button should hang up rather than dial. */
const ACTIVE_STATES = new Set([
  CallState.REQUESTING_MIC,
  CallState.CONNECTING,
  CallState.LISTENING,
  CallState.SPEAKING,
]);

function showError(message) {
  errorText.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorText.textContent = '';
  errorBox.hidden = true;
}

function render(state) {
  const view = STATE_PRESENTATION[state] ?? STATE_PRESENTATION[CallState.IDLE];

  callButtonLabel.textContent = view.label;
  statusText.textContent = view.status;
  callButton.disabled = view.busy;

  // styles.css keys its animations off this attribute, so JavaScript never
  // has to know which visual effect belongs to which state.
  callButton.dataset.state = state;
}

/**
 * Show the captured booking on screen once the AI saves it.
 *
 * The receptionist reads the reference aloud, but a spoken number is easy to
 * mishear and impossible to scroll back to, so it is worth showing too.
 */
function showBooking(booking) {
  if (!bookingBox) return;

  bookingReference.textContent = booking.reference;
  bookingSummary.textContent = `${booking.service} for ${booking.customerName} on ${booking.date} at ${booking.time}`;
  bookingBox.hidden = false;
}

const call = createRealtimeCall({
  audioElement,
  onStateChange: render,
  onError: showError,
  onBooking: showBooking,
});

callButton.addEventListener('click', () => {
  if (ACTIVE_STATES.has(call.getState())) {
    call.stop();
    return;
  }

  // Errors belong to the previous attempt; clear them as the next one starts.
  clearError();
  call.start();
});

/**
 * Release the microphone if the page is closed or hidden mid-call.
 *
 * `pagehide` is used rather than `beforeunload` because it also fires when a
 * mobile browser moves the page into the back/forward cache, a case where
 * beforeunload does not run and the mic would stay open.
 */
window.addEventListener('pagehide', () => {
  call.stop();
});

render(CallState.IDLE);
