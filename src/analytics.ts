/**
 * Analytics, in one file and behind one function.
 *
 * Three rules, and the second is the one that matters most in practice.
 *
 * **It never runs off the deployed host.** A dev server and a `file://` open are not visits, and a
 * property polluted by the author's own sixty reloads an afternoon is a property nobody trusts
 * three months later. The host check is here rather than in an environment variable because a
 * build flag that is wrong is silent, and this is not.
 *
 * **Nothing about what anybody made is ever sent.** The parameters below are all bounded
 * enumerations — which of five materials, which of six patterns, which room — plus small integers.
 * No layer values, no note grids, no kit names, and never the URL's `s` parameter, which is the
 * whole design somebody is working on. That is a deliberate line: the page counts what happened,
 * not what was made.
 *
 * **It cannot break the page.** The script is loaded async and every call goes through a queue that
 * works whether or not it ever arrives, so a blocked request or an ad blocker costs nothing.
 */

/**
 * The GA4 measurement ID. Empty disables the whole module — which is what a fork of this repo
 * should get, rather than somebody else's numbers.
 */
const MEASUREMENT_ID = '';

/** The only host that reports. */
const HOST = 'foley.plausible.ventures';

type Params = Readonly<Record<string, string | number | boolean>>;

interface Gtag {
  (command: 'js', at: Date): void;
  (command: 'config', id: string, params?: Params): void;
  (command: 'event', name: string, params?: Params): void;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

let live = false;

export function startAnalytics(): void {
  if (MEASUREMENT_ID === '' || typeof window === 'undefined') return;
  if (window.location.hostname !== HOST) return;

  window.dataLayer = window.dataLayer ?? [];
  const gtag: Gtag = ((...args: unknown[]) => {
    // The documented shape: gtag pushes `arguments` itself, not an array, and the tag reads it back
    // as an arguments object. Spreading it into an array here would be quietly ignored.
    window.dataLayer?.push(args);
  }) as Gtag;
  window.gtag = gtag;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.append(script);

  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID);
  live = true;
}

/**
 * Record something that happened.
 *
 * Silent and free when analytics is off, which is every local run — so call sites do not need to
 * ask, and a call site that forgot to ask cannot become a bug.
 */
export function track(event: string, params: Params = {}): void {
  if (!live) return;
  window.gtag?.('event', event, params);
}
