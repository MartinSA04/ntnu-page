/**
 * Per-page lifecycle for client widgets under Astro's ClientRouter (view
 * transitions). Runs `setup(signal)` on the first load and after every
 * navigation swap; the signal aborts on the next `astro:before-swap`, so
 * anything bound with `{ signal }` — event listeners, plus cleanup registered
 * via `signal.addEventListener("abort", …)` for timers/observers — is torn down
 * before the page is replaced. Widgets keep working after navigation without
 * leaking listeners, intervals or observers across pages.
 *
 * Requires ClientRouter to be present (it is, in CourseLayout) so that
 * `astro:page-load` fires on the initial load as well as after each swap.
 */
export function onPage(setup: (signal: AbortSignal) => void): void {
  let controller: AbortController | null = null;
  document.addEventListener("astro:page-load", () => {
    controller = new AbortController();
    setup(controller.signal);
  });
  document.addEventListener("astro:before-swap", () => {
    controller?.abort();
    controller = null;
  });
}
