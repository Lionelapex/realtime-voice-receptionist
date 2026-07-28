/**
 * The salon's price list, loaded once and shared by everything that needs it.
 *
 * This module exists so that the website and the AI receptionist can never
 * disagree about a price. The website renders this catalogue over HTTP; the
 * receptionist gets the same catalogue rendered as text inside its instructions.
 * Changing a price means editing data/services.json and restarting -- there is
 * no second copy to forget about.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.resolve(__dirname, '..', 'data', 'services.json');

/*
 * Read synchronously at startup rather than on each request.
 *
 * The file is small and never changes while the process runs, so caching it
 * avoids disk I/O on every page load and every session. It also means a
 * malformed price list crashes the server immediately with a clear error,
 * instead of silently breaking the receptionist mid-conversation.
 */
const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

/** The raw catalogue, as served to the website. */
export function getCatalog() {
  return catalog;
}

/**
 * Format a price the South African way: "R50", "R1 200".
 *
 * en-ZA groups thousands with a space, and salon prices are always whole rand,
 * so trailing decimals would just be noise.
 */
export function formatPrice(amount) {
  return `${catalog.currencySymbol}${amount.toLocaleString('en-ZA')}`;
}

/** Every service across all categories, flattened. */
export function getAllServices() {
  return catalog.categories.flatMap((category) =>
    category.services.map((service) => ({ ...service, category: category.name })),
  );
}

/** The cheapest price in the catalogue, used for "from R.." copy. */
export function getLowestPrice() {
  return Math.min(...getAllServices().map((service) => service.price));
}

/**
 * Render the catalogue as plain text for the model's instructions.
 *
 * Injecting the list directly is a deliberate choice over exposing a lookup
 * tool. The menu is around twenty items, which costs very little context, and
 * it lets the receptionist answer "how much is a fade?" instantly instead of
 * pausing mid-conversation for a tool round-trip. If this list ever grew to
 * hundreds of items, or varied per branch, a tool would become the right call.
 */
export function formatCatalogForPrompt() {
  const lines = catalog.categories.map((category) => {
    const services = category.services
      .map(
        (service) =>
          `  - ${service.name}: ${formatPrice(service.price)}, about ${service.durationMinutes} minutes. ${service.description}`,
      )
      .join('\n');

    return `${category.name}\n${services}`;
  });

  return lines.join('\n\n');
}
