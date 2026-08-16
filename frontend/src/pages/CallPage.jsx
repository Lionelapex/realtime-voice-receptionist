import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useRealtimeCall, CallState } from '../hooks/useRealtimeCall.js';

const STATE_PRESENTATION = {
  [CallState.IDLE]: {
    label: 'Talk to Desk',
    status: 'Ready when you are.',
    busy: false,
  },
  [CallState.REQUESTING_MIC]: {
    label: 'Allow mic…',
    status: 'Waiting for microphone permission…',
    busy: true,
  },
  [CallState.CONNECTING]: {
    label: 'Connecting…',
    status: 'Connecting you to the receptionist…',
    busy: true,
  },
  [CallState.LISTENING]: {
    label: 'End call',
    status: 'Listening… go ahead and speak.',
    busy: false,
  },
  [CallState.SPEAKING]: {
    label: 'End call',
    status: 'The receptionist is speaking…',
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

const ACTIVE_STATES = new Set([
  CallState.REQUESTING_MIC,
  CallState.CONNECTING,
  CallState.LISTENING,
  CallState.SPEAKING,
]);

export default function CallPage() {
  const { audioRef, state, error, booking, start, stop } = useRealtimeCall();
  const view = STATE_PRESENTATION[state] ?? STATE_PRESENTATION[CallState.IDLE];

  useEffect(() => {
    document.title = 'Talk to the desk — Bella Hair Studio';
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    document.head.appendChild(robots);
    return () => {
      document.head.removeChild(robots);
    };
  }, []);

  function onButtonClick() {
    if (ACTIVE_STATES.has(state)) {
      stop();
      return;
    }
    start();
  }

  return (
    <div className="min-h-screen bg-espresso font-sans text-cream antialiased">
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-12">
        <Link
          to="/"
          className="absolute left-6 top-6 text-sm text-cream/50 transition hover:text-cream"
        >
          ← Back to the studio
        </Link>

        <header className="mb-12 text-center">
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.25em] text-tan">
            Bella Hair Studio
          </p>
          <h1 className="mt-3 font-display text-4xl font-medium tracking-tight text-cream">
            The front desk
          </h1>
          <p className="mx-auto mt-4 max-w-xs text-sm leading-relaxed text-cream/60">
            Tap below and just talk. Your browser will ask for microphone access.
          </p>
        </header>

        <button
          type="button"
          data-state={state}
          disabled={view.busy}
          onClick={onButtonClick}
          className="call-button relative flex h-40 w-40 items-center justify-center rounded-full bg-tan px-6 text-center text-base font-semibold leading-snug text-espresso shadow-xl shadow-black/30 transition hover:brightness-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-tan/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span>{view.label}</span>
        </button>

        <p
          role="status"
          aria-live="polite"
          className="mt-10 h-6 text-center text-sm text-cream/60"
        >
          {view.status}
        </p>

        {error ? (
          <div className="mt-6 w-full rounded-xl border border-tan/30 bg-black/25 px-4 py-3 text-sm text-cream/80">
            <p className="leading-relaxed">{error}</p>
          </div>
        ) : null}

        {booking ? (
          <div className="mt-8 w-full rounded-xl border border-tan/40 bg-tan/10 px-5 py-4 text-sm">
            <p className="text-[0.7rem] font-medium uppercase tracking-[0.2em] text-tan">
              Booking confirmed
            </p>
            <p className="mt-2 font-display text-2xl text-cream">{booking.reference}</p>
            <p className="mt-1 leading-relaxed text-cream/70">
              {booking.service} for {booking.customerName} on {booking.date} at{' '}
              {booking.time}
            </p>
          </div>
        ) : null}

        <footer className="mt-14 text-center text-xs text-cream/35">
          Demo · Conversations are not recorded or stored.
        </footer>
      </main>

      {/*
        playsInline must exist before a stream is attached — iOS Safari
        otherwise tries to open audio in a fullscreen native player.
      */}
      <audio ref={audioRef} className="ai-audio" autoPlay playsInline />
    </div>
  );
}
