import { useEffect, useState } from 'react';

const SERVICES_ENDPOINT = '/api/services';

function formatPrice(symbol, amount) {
  return `${symbol}${amount.toLocaleString('en-ZA')}`;
}

/**
 * Renders the salon menu from the shared backend catalogue.
 *
 * Keeping prices out of JSX is what stops the website and the receptionist
 * from drifting apart — both read the same JSON.
 */
export default function ServiceMenu() {
  const [catalog, setCatalog] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(SERVICES_ENDPOINT);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!cancelled) setCatalog(data);
      } catch (error) {
        console.error('[menu] could not load services', error);
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <p className="mt-14 text-sm text-muted">
        Our menu could not be loaded just now. Please call the studio on{' '}
        <a href="tel:+27115550142" className="underline">
          +27 11 555 0142
        </a>
        .
      </p>
    );
  }

  if (!catalog) {
    return (
      <p className="mt-14 text-sm text-muted" aria-busy="true">
        Loading the menu…
      </p>
    );
  }

  const symbol = catalog.currencySymbol ?? 'R';

  return (
    <>
      {catalog.categories.map((category) => (
        <div key={category.id}>
          <h3 className="menu-category">{category.name}</h3>
          <ul className="menu-list">
            {category.services.map((service) => (
              <li key={service.id} className="menu-item">
                <div className="menu-item-body">
                  <p className="menu-item-name">{service.name}</p>
                  <p className="menu-item-desc">{service.description}</p>
                </div>
                <div className="menu-item-meta">
                  <p className="menu-price">{formatPrice(symbol, service.price)}</p>
                  <p className="menu-duration">{service.durationMinutes} min</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
