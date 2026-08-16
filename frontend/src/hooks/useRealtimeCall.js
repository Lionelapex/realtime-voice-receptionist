import { useEffect, useRef, useState } from 'react';
import { createRealtimeCall, CallState } from '../lib/realtime.js';

/**
 * React wrapper around the DOM-free realtime call controller.
 *
 * The controller itself stays vanilla so the WebRTC lifecycle is not tangled
 * up in React render cycles. This hook only owns the state React needs to
 * paint, and tears the call down when the page unmounts or is hidden.
 */
export function useRealtimeCall() {
  const [audioEl, setAudioEl] = useState(null);
  const callRef = useRef(null);
  const [state, setState] = useState(CallState.IDLE);
  const [error, setError] = useState(null);
  const [booking, setBooking] = useState(null);

  useEffect(() => {
    if (!audioEl) return undefined;

    const call = createRealtimeCall({
      audioElement: audioEl,
      onStateChange: setState,
      onError: setError,
      onBooking: setBooking,
    });

    callRef.current = call;

    // pagehide also fires when mobile Safari parks the page in bfcache, which
    // beforeunload does not. Without this the mic indicator can stick.
    const onPageHide = () => call.stop();
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.removeEventListener('pagehide', onPageHide);
      call.stop();
      callRef.current = null;
    };
  }, [audioEl]);

  function start() {
    setError(null);
    setBooking(null);
    callRef.current?.start();
  }

  function stop() {
    callRef.current?.stop();
  }

  return {
    audioRef: setAudioEl,
    state,
    error,
    booking,
    start,
    stop,
    getState: () => callRef.current?.getState() ?? state,
  };
}

export { CallState };
