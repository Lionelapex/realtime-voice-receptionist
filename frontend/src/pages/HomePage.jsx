import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader.jsx';
import ServiceMenu from '../components/ServiceMenu.jsx';

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .8-.2 1l-2.2 2.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function HomePage() {
  const heroRef = useRef(null);
  const [pastHero, setPastHero] = useState(false);

  useEffect(() => {
    document.title = 'Bella Hair Studio — Hair studio with an AI front desk';
  }, []);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero || !('IntersectionObserver' in window)) {
      setPastHero(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setPastHero(!entry.isIntersecting),
      { rootMargin: '-72px 0px 0px 0px', threshold: 0 },
    );

    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="bg-cream font-sans text-ink antialiased">
      <a href="#home" className="skip-link">
        Skip to content
      </a>

      <SiteHeader pastHero={pastHero} />

      <main>
        <section
          id="home"
          ref={heroRef}
          className="hero relative flex min-h-screen items-end"
        >
          <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-24 pt-40">
            <p className="text-[0.7rem] font-medium uppercase tracking-[0.3em] text-tan">
              Johannesburg · Since 2014
            </p>

            <h1 className="mt-6 max-w-3xl font-display text-5xl font-medium leading-[1.05] tracking-tight text-cream sm:text-6xl lg:text-7xl">
              Book your chair by simply talking.
            </h1>

            <p className="mt-7 max-w-xl text-base leading-relaxed text-cream/70 sm:text-lg">
              Our front desk picks up instantly, takes your details, and confirms
              your appointment before you hang up. No forms. No hold music.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link to="/call" className="btn-primary">
                <PhoneIcon />
                Talk to Desk
              </Link>
              <a href="#services" className="btn-ghost">
                See the menu
              </a>
            </div>

            <div className="mt-12 flex flex-wrap gap-3">
              <span className="hero-chip">Tue – Sat, 9am – 6pm</span>
              <span className="hero-chip">Sandton, Johannesburg</span>
            </div>
          </div>
        </section>

        <section className="border-b border-hairline bg-cream-deep">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <p className="section-eyebrow">How it works</p>
            <div className="mt-10 grid gap-10 sm:grid-cols-3">
              <div>
                <p className="step-number">01</p>
                <h3 className="mt-4 font-display text-xl text-espresso">
                  Say what you&apos;d like done
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  A cut, a colour, or just &ldquo;I&apos;m not sure yet&rdquo;. Speak
                  normally — it understands.
                </p>
              </div>
              <div>
                <p className="step-number">02</p>
                <h3 className="mt-4 font-display text-xl text-espresso">
                  Pick a day and time
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Tell it roughly when suits you and it will settle on a slot with
                  you.
                </p>
              </div>
              <div>
                <p className="step-number">03</p>
                <h3 className="mt-4 font-display text-xl text-espresso">
                  Leave a name and number
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  It reads the whole booking back to you before finishing. Then
                  you&apos;re done.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="services" className="scroll-mt-24">
          <div className="mx-auto max-w-4xl px-6 py-24">
            <h2 className="font-display text-4xl text-espresso sm:text-5xl">The menu</h2>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
              Prices start from; your stylist confirms on consultation. Ask the
              front desk for anything you can&apos;t see here.
            </p>
            <ServiceMenu />
          </div>
        </section>

        <section id="visit" className="scroll-mt-24 bg-espresso text-cream">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <h2 className="font-display text-4xl sm:text-5xl">Visit the studio</h2>

            <div className="mt-14 grid gap-14 lg:grid-cols-2">
              <div className="space-y-10">
                <div>
                  <p className="visit-label">Address</p>
                  <p className="mt-3 text-lg leading-relaxed">
                    12 Maude Street
                    <br />
                    Sandton, Johannesburg
                  </p>
                </div>
                <div>
                  <p className="visit-label">Opening hours</p>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between border-b border-cream/10 pb-2">
                      <dt className="text-cream/60">Tuesday – Friday</dt>
                      <dd>9:00am – 6:00pm</dd>
                    </div>
                    <div className="flex justify-between border-b border-cream/10 pb-2">
                      <dt className="text-cream/60">Saturday</dt>
                      <dd>9:00am – 5:00pm</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-cream/60">Sunday &amp; Monday</dt>
                      <dd className="text-cream/60">Closed</dd>
                    </div>
                  </dl>
                </div>
                <div>
                  <p className="visit-label">Phone</p>
                  <p className="mt-3">
                    <a
                      href="tel:+27115550142"
                      className="text-lg underline-offset-4 hover:underline"
                    >
                      +27 11 555 0142
                    </a>
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-cream/12 bg-espresso-soft p-9">
                <h3 className="font-display text-2xl">Rather just talk?</h3>
                <p className="mt-4 text-sm leading-relaxed text-cream/70">
                  Hit &ldquo;Talk to Desk&rdquo;. Tell it what you want done and
                  roughly when, and it will take your details and read your
                  confirmation back to you.
                </p>
                <ol className="mt-8 space-y-4 text-sm">
                  <li className="flex gap-4">
                    <span className="text-tan">1</span>
                    <span className="text-cream/80">Say what you&apos;d like done</span>
                  </li>
                  <li className="flex gap-4">
                    <span className="text-tan">2</span>
                    <span className="text-cream/80">Pick from the times it offers</span>
                  </li>
                  <li className="flex gap-4">
                    <span className="text-tan">3</span>
                    <span className="text-cream/80">
                      Leave a name and number; you&apos;re booked
                    </span>
                  </li>
                </ol>
                <Link to="/call" className="btn-primary mt-9 w-full justify-center">
                  Talk to Desk
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline bg-cream">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <p className="font-display text-base text-espresso">Bella Hair Studio</p>
          <p>Demo project · Voice booking powered by the OpenAI Realtime API</p>
        </div>
      </footer>

      <Link to="/call" className="floating-cta" data-visible={String(pastHero)}>
        <PhoneIcon />
        Talk to Desk
      </Link>
    </div>
  );
}
