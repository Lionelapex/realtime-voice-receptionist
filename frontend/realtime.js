/**
 * realtime.js
 *
 * Owns the entire voice-call lifecycle: microphone capture, the WebRTC peer
 * connection to the OpenAI Realtime API, and the data channel used for
 * control events.
 *
 * This module deliberately knows nothing about the DOM. It reports what is
 * happening through callbacks and lets app.js decide how to render it. That
 * split is what allows the UI to be rewritten later without touching any
 * connection logic.
 *
 * Connection sequence:
 *   1. ask our backend for an ephemeral token   (POST /api/session)
 *   2. ask the browser for microphone access    (getUserMedia)
 *   3. build the peer connection, attach mic + remote audio
 *   4. open the "oai-events" data channel
 *   5. exchange SDP with OpenAI                 (POST /v1/realtime/calls)
 *   6. once the channel opens, prompt the model to greet the customer first
 */

const SESSION_ENDPOINT = '/api/session';
const BOOKINGS_ENDPOINT = '/api/bookings';
const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

/** Every state the UI can be asked to render. */
export const CallState = Object.freeze({
  IDLE: 'idle',
  REQUESTING_MIC: 'requesting-mic',
  CONNECTING: 'connecting',
  LISTENING: 'listening',
  SPEAKING: 'speaking',
  ENDED: 'ended',
  ERROR: 'error',
});

/**
 * Turn a getUserMedia rejection into something a salon customer can act on.
 * The raw DOMException names are meaningless to end users, and "permission
 * denied" and "no microphone plugged in" need completely different responses.
 */
function describeMicError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Microphone access was blocked. Allow it in your browser\u2019s address bar, then try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found. Connect one and try again.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Your microphone is being used by another application. Close it and try again.';
    case 'SecurityError':
      return 'The microphone is only available over a secure connection. Open this page at http://localhost:3000.';
    default:
      return 'Could not access your microphone. Please check your browser settings and try again.';
  }
}

/**
 * Explain why the SDP exchange was refused.
 *
 * Worth the extra care because OpenAI returns HTTP 429 for two situations that
 * demand opposite responses: a genuine rate limit, where waiting and retrying
 * works, and an exhausted account balance, where retrying can never succeed.
 * Only the error code in the body tells them apart.
 *
 * Billing state is deliberately not shown to the customer -- a salon visitor
 * should not learn about the operator's account. The actionable detail goes to
 * the console for whoever is running the site.
 */
function describeSdpError(status, body) {
  let code = null;
  try {
    code = JSON.parse(body)?.error?.code ?? null;
  } catch {
    /* Not every failure returns JSON; fall through to the status code. */
  }

  if (code === 'insufficient_quota') {
    console.error(
      '[realtime] The OpenAI account has no remaining credit, so calls cannot ' +
        'connect. Add billing details at ' +
        'https://platform.openai.com/settings/organization/billing',
    );
    return 'The receptionist is temporarily unavailable. Please try again later.';
  }

  if (status === 429) {
    return 'The receptionist is busy with another call. Please wait a few seconds and try again.';
  }

  if (status === 401 || status === 403) {
    return 'The session token was rejected. Please try again.';
  }

  return `The voice service refused the connection (HTTP ${status}).`;
}

/**
 * Create a realtime call controller.
 *
 * @param {object}       options
 * @param {HTMLAudioElement} options.audioElement Where the model's voice is played.
 * @param {(state: string) => void} [options.onStateChange]
 * @param {(message: string) => void} [options.onError]
 * @returns {{ start: () => Promise<void>, stop: () => void, getState: () => string }}
 */
export function createRealtimeCall({
  audioElement,
  onStateChange = () => {},
  onError = () => {},
  onBooking = () => {},
}) {
  let peerConnection = null;
  let dataChannel = null;
  let micStream = null;
  let state = CallState.IDLE;
  let greeted = false;

  function setState(next) {
    if (state === next) return;
    state = next;
    onStateChange(next);
  }

  /** Report a failure and tear everything down. */
  function fail(message, cause) {
    if (cause) console.error('[realtime]', message, cause);
    cleanup();
    setState(CallState.ERROR);
    onError(message);
  }

  /**
   * Release every resource. Safe to call repeatedly and at any point in the
   * connection sequence, which matters because failures can happen midway.
   *
   * Stopping the microphone tracks is not optional housekeeping: without it the
   * browser keeps showing the "recording" indicator after the call has ended,
   * which understandably alarms people.
   */
  function cleanup() {
    greeted = false;

    if (dataChannel) {
      try {
        dataChannel.close();
      } catch {
        /* already closed */
      }
      dataChannel = null;
    }

    if (peerConnection) {
      // Drop handlers before closing so teardown does not re-enter fail().
      peerConnection.onconnectionstatechange = null;
      peerConnection.ontrack = null;
      try {
        peerConnection.close();
      } catch {
        /* already closed */
      }
      peerConnection = null;
    }

    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = null;
    }

    if (audioElement) {
      audioElement.srcObject = null;
    }
  }

  /** Ask our own backend to mint a short-lived OpenAI credential. */
  async function fetchEphemeralToken() {
    const response = await fetch(SESSION_ENDPOINT, { method: 'POST' });

    if (!response.ok) {
      // The backend sends structured JSON errors, but a proxy or a crash could
      // return HTML, so never assume the body parses.
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        if (body?.error) detail = body.error;
      } catch {
        /* keep the status-code fallback */
      }
      throw new Error(`Could not start a session. ${detail}`);
    }

    const data = await response.json();
    if (!data?.value) throw new Error('The server did not return a session token.');
    return data.value;
  }

  /**
   * Handle control events streamed back from the model.
   *
   * Audio itself never arrives here -- WebRTC delivers that as a media track.
   * This channel carries session lifecycle and turn-taking events, which is
   * exactly what the UI needs to show who is currently speaking.
   */
  function handleServerEvent(event) {
    switch (event.type) {
      case 'session.created':
        setState(CallState.LISTENING);
        break;

      // The model has started/finished emitting audio for its turn.
      case 'output_audio_buffer.started':
        setState(CallState.SPEAKING);
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        setState(CallState.LISTENING);
        break;

      // Server-side VAD detected the customer starting to talk. Because the
      // session enables interrupt_response, this can arrive mid-reply.
      case 'input_audio_buffer.speech_started':
        setState(CallState.LISTENING);
        break;

      // The model has finished emitting a tool call.
      //
      // This event is used in preference to response.function_call_arguments.done
      // because it carries the tool name, the call id and the complete arguments
      // together in one place, so nothing has to be stitched together from
      // earlier events.
      case 'response.output_item.done':
        if (event.item?.type === 'function_call') {
          handleToolCall(event.item);
        }
        break;

      case 'error':
        fail(
          event.error?.message || 'The voice service reported an error.',
          event.error,
        );
        break;

      default:
        // Many event types are irrelevant to Phase 1. Logging them keeps the
        // console useful while building without cluttering the UI.
        break;
    }
  }

  /**
   * Execute a tool the model asked for, then hand the outcome back to it.
   *
   * A tool call failing must never break the conversation. Whatever happens,
   * a result is returned to the model -- including failures -- so it can tell
   * the customer honestly rather than waiting forever for a reply that the
   * instructions told it to expect.
   */
  async function handleToolCall(item) {
    const { name, call_id: callId } = item;
    let result;

    try {
      const args = JSON.parse(item.arguments || '{}');

      if (name === 'save_booking') {
        const response = await fetch(BOOKINGS_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        });

        const body = await response.json().catch(() => ({}));

        if (response.ok && body.ok) {
          result = { success: true, reference: body.reference };
          onBooking({ ...args, reference: body.reference });
        } else {
          result = {
            success: false,
            error: body.error || `Booking service returned HTTP ${response.status}`,
          };
        }
      } else {
        result = { success: false, error: `Unknown tool: ${name}` };
      }
    } catch (error) {
      console.error('[realtime] tool call failed', error);
      result = { success: false, error: 'The booking system is unavailable.' };
    }

    if (dataChannel?.readyState !== 'open') return;

    // Two events, and both are required. The first delivers the result into the
    // conversation; the second asks the model to actually speak about it.
    // Sending only the first leaves the customer in silence.
    dataChannel.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result),
        },
      }),
    );
    dataChannel.send(JSON.stringify({ type: 'response.create' }));
  }

  /**
   * Make the receptionist speak first.
   *
   * A Realtime session stays silent until something prompts it, so the greeting
   * written into the server-side instructions would never be heard on its own.
   * Sending response.create the moment the channel opens is what turns this
   * from "connected silence" into a receptionist answering the phone.
   */
  function sendGreetingTrigger() {
    if (greeted || dataChannel?.readyState !== 'open') return;
    greeted = true;
    dataChannel.send(JSON.stringify({ type: 'response.create' }));
  }

  async function start() {
    if (state !== CallState.IDLE && state !== CallState.ENDED && state !== CallState.ERROR) {
      return; // A call is already in progress.
    }

    // getUserMedia only exists in a secure context (HTTPS or localhost).
    // Opening index.html as a file:// URL leaves it undefined, so check up
    // front rather than throwing an opaque TypeError later.
    if (!navigator.mediaDevices?.getUserMedia) {
      fail(
        'This browser cannot access the microphone here. Open the page at http://localhost:3000 using a recent Chrome, Edge, Firefox or Safari.',
      );
      return;
    }

    try {
      setState(CallState.REQUESTING_MIC);

      // These three hints matter a great deal for a speakerphone-style call:
      // without echo cancellation the model hears its own voice through the
      // speakers and starts replying to itself.
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      fail(describeMicError(error), error);
      return;
    }

    try {
      setState(CallState.CONNECTING);

      // Minted per call. Tokens expire, so one fetched at page load would fail
      // for anyone who left the tab open before clicking.
      const ephemeralKey = await fetchEphemeralToken();

      peerConnection = new RTCPeerConnection();

      // The model's voice arrives as a remote media track.
      peerConnection.ontrack = (event) => {
        audioElement.srcObject = event.streams[0];
        // Autoplay is permitted because start() runs inside a click handler,
        // but a rejected promise here would otherwise be silent.
        audioElement.play?.().catch((error) => {
          console.warn('[realtime] audio playback was blocked', error);
        });
      };

      // Surface a connection that dies after being established -- network drop,
      // laptop sleep, ICE failure. Without this the call goes quiet with the UI
      // still claiming everything is fine.
      peerConnection.onconnectionstatechange = () => {
        const connectionState = peerConnection?.connectionState;
        if (connectionState === 'failed') {
          fail('The connection to the receptionist was lost. Please try again.');
        } else if (connectionState === 'disconnected') {
          console.warn('[realtime] connection disconnected; awaiting recovery');
        }
      };

      micStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, micStream);
      });

      // The channel name is required by the API.
      dataChannel = peerConnection.createDataChannel('oai-events');
      dataChannel.addEventListener('open', sendGreetingTrigger);
      dataChannel.addEventListener('message', (event) => {
        try {
          handleServerEvent(JSON.parse(event.data));
        } catch (error) {
          console.warn('[realtime] unparseable server event', error);
        }
      });

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      // Note the shape of this request: the raw SDP as the body, and no
      // ?model= query parameter. The model was fixed when the backend minted
      // the token; passing it here returns an empty 400.
      const sdpResponse = await fetch(REALTIME_CALLS_URL, {
        method: 'POST',
        body: peerConnection.localDescription?.sdp ?? offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
      });

      if (!sdpResponse.ok) {
        const body = await sdpResponse.text();
        console.error('[realtime] SDP exchange failed', sdpResponse.status, body);
        throw new Error(describeSdpError(sdpResponse.status, body));
      }

      await peerConnection.setRemoteDescription({
        type: 'answer',
        sdp: await sdpResponse.text(),
      });

      // State advances to LISTENING when session.created arrives over the
      // data channel, which is the first proof the session is truly live.
    } catch (error) {
      fail(error.message || 'Could not connect to the receptionist.', error);
    }
  }

  function stop() {
    cleanup();
    setState(CallState.ENDED);
  }

  return {
    start,
    stop,
    getState: () => state,
  };
}
