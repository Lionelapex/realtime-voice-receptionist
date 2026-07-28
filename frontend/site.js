/**
 * site.js
 *
 * Behaviour for the marketing page only. The call screen loads app.js instead;
 * the two never share a page.
 *
 * Scope is deliberately tiny: a mobile menu, and one observer that decides when
 * the header turns solid and the floating button appears. Everything visual
 * lives in styles.css, keyed off the data attributes set here.
 */

const SERVICES_ENDPOINT = '/api/services';

const header = document.getElementById('site-header');
const navToggle = document.getElementById('nav-toggle');
const mobileNav = document.getElementById('mobile-nav');
const floatingCta = document.getElementById('floating-cta');
const hero = document.getElementById('home');
const menuRoot = document.getElementById('menu-root');

/* ------------------------------------------------------------- the menu -- */

/**
 * Escape text before it goes anywhere near innerHTML.
 *
 * The catalogue is our own data today, but it is still data flowing into
 * markup, and the day someone lets a salon owner edit it through a form is the
 * day an unescaped apostrophe or angle bracket becomes a bug -- or worse.
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Match the backend's formatting: "R50", "R1 200". */
function formatPrice(symbol, amount) {
  return `${symbol}${amount.toLocaleString('en-ZA')}`;
}

function renderMenu(catalog) {
  const symbol = catalog.currencySymbol ?? 'R';

  const html = catalog.categories
    .map((category) => {
      const items = category.services
        .map(
          (service) => `
            <li class="menu-item">
              <div class="menu-item-body">
                <p class="menu-item-name">${escapeHtml(service.name)}</p>
                <p class="menu-item-desc">${escapeHtml(service.description)}</p>
              </div>
              <div class="menu-item-meta">
                <p class="menu-price">${escapeHtml(formatPrice(symbol, service.price))}</p>
                <p class="menu-duration">${service.durationMinutes} min</p>
              </div>
            </li>`,
        )
        .join('');

      return `
        <h3 class="menu-category">${escapeHtml(category.name)}</h3>
        <ul class="menu-list">${items}</ul>`;
    })
    .join('');

  menuRoot.innerHTML = html;
  menuRoot.setAttribute('aria-busy', 'false');
}

async function loadMenu() {
  if (!menuRoot) return;

  try {
    const response = await fetch(SERVICES_ENDPOINT);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderMenu(await response.json());
  } catch (error) {
    console.error('[site] could not load the menu', error);
    // Never leave "Loading..." on screen forever; give people the phone number.
    menuRoot.innerHTML =
      '<p class="mt-14 text-sm text-muted">Our menu could not be loaded just now. ' +
      'Please call the studio on <a href="tel:+27115550142" class="underline">' +
      '+27 11 555 0142</a>.</p>';
    menuRoot.setAttribute('aria-busy', 'false');
  }
}

loadMenu();

/* ------------------------------------------------------------ mobile nav -- */

function setMobileNav(open) {
  if (!mobileNav || !navToggle) return;
  mobileNav.hidden = !open;
  // Keep the accessible state truthful, not just the visual one.
  navToggle.setAttribute('aria-expanded', String(open));
}

navToggle?.addEventListener('click', () => {
  setMobileNav(mobileNav?.hidden ?? true);
});

// Anchor links jump within the same page, so the menu has to be closed
// manually or it stays open covering the section just navigated to.
mobileNav?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => setMobileNav(false));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setMobileNav(false);
});

// Reaching the desktop breakpoint hides the menu via CSS while leaving
// aria-expanded stale, so reset it explicitly.
window.matchMedia('(min-width: 768px)').addEventListener('change', (event) => {
  if (event.matches) setMobileNav(false);
});

/* ------------------------------------------------ header + floating cta -- */

/**
 * Both effects trigger at the same moment: the hero leaving the viewport.
 *
 * An IntersectionObserver is used rather than a scroll listener because it does
 * not run work on every scroll frame, and it needs no manual throttling.
 */
function setPastHero(pastHero) {
  header?.setAttribute('data-scrolled', String(pastHero));
  floatingCta?.setAttribute('data-visible', String(pastHero));
}

if (hero && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    ([entry]) => setPastHero(!entry.isIntersecting),
    // Shrink the top of the viewport by roughly the header height so the
    // switch happens as the hero passes behind the header, not after.
    { rootMargin: '-72px 0px 0px 0px', threshold: 0 },
  );

  observer.observe(hero);
} else {
  // Without observer support, show the solid header and button permanently
  // rather than leaving the floating CTA unreachable.
  setPastHero(true);
}
