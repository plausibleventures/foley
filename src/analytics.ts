/**
 * The one call site for analytics, and nothing else.
 *
 * The tag itself is set up in `index.html` — the measurement ID, the host gate that keeps localhost
 * out of the property, and the pinned `page_location` that stops this page's `?s=` parameter (which
 * is the entire design) being sent to Google. All of that belongs in one visible place in the
 * document rather than buried in a module.
 *
 * What is left here is the event helper, so call sites stay readable and so that **nothing about
 * what anybody made is ever sent**. Every parameter below is a bounded enumeration — which of the
 * families, which of the materials, which room — plus small integers. No axis values, no names, no
 * glyphs, no note grids, and never the URL.
 *
 * Silent and free when the tag never loaded, which is every local run, so a call site never has to
 * ask and a call site that forgot to ask cannot become a bug.
 */

type Params = Readonly<Record<string, string | number | boolean>>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (command: string, ...args: unknown[]) => void;
  }
}

/** Record something that happened. */
export function track(event: string, params: Params = {}): void {
  window.gtag?.('event', event, params);
}
