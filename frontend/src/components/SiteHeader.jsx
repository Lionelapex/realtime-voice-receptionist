import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export default function SiteHeader({ pastHero }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const onChange = (event) => {
      if (event.matches) setMobileOpen(false);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return (
    <header
      data-scrolled={String(pastHero)}
      className="site-header fixed inset-x-0 top-0 z-50 transition-colors duration-300"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <a href="#home" className="font-display text-xl tracking-tight">
          Bella Hair Studio
        </a>

        <nav aria-label="Primary" className="hidden items-center gap-9 text-sm md:flex">
          <a href="#home" className="nav-link">
            Home
          </a>
          <a href="#services" className="nav-link">
            Services
          </a>
          <a href="#visit" className="nav-link">
            Visit
          </a>
        </nav>

        <div className="hidden items-center gap-5 md:flex">
          <a href="tel:+27115550142" className="nav-link text-sm">
            +27 11 555 0142
          </a>
          <Link to="/call" className="btn-desk text-sm">
            Talk to Desk
          </Link>
        </div>

        <button
          type="button"
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          className="nav-link md:hidden"
          onClick={() => setMobileOpen((open) => !open)}
        >
          <span className="sr-only">Toggle navigation</span>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 7h16M4 12h16M4 17h16"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {mobileOpen ? (
        <div id="mobile-nav" className="mobile-nav md:hidden">
          <a href="#home" className="mobile-nav-link" onClick={() => setMobileOpen(false)}>
            Home
          </a>
          <a href="#services" className="mobile-nav-link" onClick={() => setMobileOpen(false)}>
            Services
          </a>
          <a href="#visit" className="mobile-nav-link" onClick={() => setMobileOpen(false)}>
            Visit
          </a>
          <Link
            to="/call"
            className="mobile-nav-link font-semibold text-tan"
            onClick={() => setMobileOpen(false)}
          >
            Talk to Desk
          </Link>
        </div>
      ) : null}
    </header>
  );
}
