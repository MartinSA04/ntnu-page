/**
 * The account, as a site-wide thing rather than a planner thing.
 *
 * WHY IT IS NOT IN THE PLANNER. The account governs site-GLOBAL state:
 * `np:profile`, `np:plans` and `np:lastSemester` are read by `/`, `/emner/`
 * and `/emne/[code]/`, not only by `/planlegger/`. And `/emne/[code]/` is the
 * largest cold-traffic surface there is — a student who lands there from a
 * search engine has to be able to sign in (and to say which programme they
 * are on) without navigating somewhere else first. So the door is in the
 * topbar, on every page, and this module is what stands behind it.
 *
 * Two lifetimes, and the split is the whole design:
 *
 *  - **The shared pair (`store`, `sync`) is a MODULE singleton**, created on
 *    first use and kept for the life of the tab. `SyncClient` holds its
 *    session in memory (`createSyncClient`'s own `session` variable, written
 *    through to storage), so two clients would DIVERGE the moment one of them
 *    logged in: the other would keep answering `session() === null` until the
 *    page reloaded. `plannerApp.ts` pushes and pulls through the same client
 *    this panel signs in with, and that is only sound if it is literally the
 *    same object. The store is stateless (every read is fresh from storage),
 *    but it rides along so nothing has to guess a default semester twice.
 *
 *  - **The panel and the topbar button are PER PAGE-LOAD.** The panel appends
 *    a `<dialog>` to `document.body` and the button is re-rendered by the
 *    server on every ClientRouter swap, so both are mounted from `onPage` and
 *    torn down on the signal. `panel` is nulled on the way out, which is why
 *    every reader below goes through `accountPanel()` rather than caching it.
 *
 * The planner reaches this through `account()`/`accountPanel()` and never
 * mounts anything account-shaped itself.
 */
import { createPlanStore, type PlanStore } from "../lib/planner/store.js";
import { createSyncClient, type SyncClient } from "../lib/planner/syncClient.js";
import {
  ACCOUNT_CHANGE_EVENT,
  type AuthMode,
  mountProfilePanel,
  type ProfilePanelHandle,
} from "./planner/profilePanel.js";

/**
 * Opens the account panel from anywhere on the page, in a named mode.
 *
 * A CustomEvent rather than an exported function because the panel is per
 * page-load while the callers are static markup on three different pages — the
 * same shape `store.ts` uses for `PLAN_CHANGE_EVENT`. It also works below
 * 480px, where the topbar button is folded into the menu and cannot simply be
 * clicked by proxy.
 */
export const ACCOUNT_OPEN_EVENT = "np:account-open";

export interface AccountOpenDetail {
  /** Omitted leaves whichever form was last on screen this page-load. */
  mode?: AuthMode;
}

export interface SharedAccount {
  store: PlanStore;
  sync: SyncClient;
}

let shared: SharedAccount | null = null;
let panel: ProfilePanelHandle | null = null;
let repaint: (() => void) | null = null;

/**
 * The one store + sync client this tab uses. `defaultSemesterId` is only read
 * on the first call (every caller derives it from the same build-time
 * `data/semesters.json`, so they cannot disagree).
 *
 * `.bind(globalThis)`, not the bare reference: `deps.fetch(...)` inside
 * syncClient.ts is a METHOD CALL on the deps object, so an unbound `fetch`
 * runs with `this === deps` and the native implementation throws "Illegal
 * invocation".
 */
export function account(defaultSemesterId: string): SharedAccount {
  if (!shared) {
    shared = {
      store: createPlanStore(defaultSemesterId),
      sync: createSyncClient({
        storage: localStorage,
        fetch: globalThis.fetch.bind(globalThis),
      }),
    };
  }
  return shared;
}

/** The live panel, or `null` between page-loads. Never cache the result. */
export function accountPanel(): ProfilePanelHandle | null {
  return panel;
}

/**
 * Registers the repaint a login owes the page under the modal. `login` writes
 * the server's plan straight into `localStorage` — it bypasses
 * `store.savePlan`, because it is adopting a copy rather than deriving one —
 * so nothing repaints on its own. The planner passes its own pull-repaint
 * path here; every other page passes nothing and re-reads on its next load.
 */
export function setAccountRepaint(cb: (() => void) | null): void {
  repaint = cb;
}

/**
 * Mounts the profile panel and wires the topbar button for one page-load.
 * Idempotent per load: the panel removes any stale dialog of its own, and the
 * button lookup simply misses on a page that has no topbar.
 */
export function mountAccount(signal: AbortSignal, defaultSemesterId: string): void {
  const button = document.getElementById("site-account-btn");
  const nameEl = document.getElementById("site-account-name");
  if (!button || !nameEl) return;

  const { store, sync } = account(defaultSemesterId);

  panel = mountProfilePanel({
    store,
    sync,
    onAuthenticated: () => repaint?.(),
    signal,
  });
  signal.addEventListener("abort", () => {
    panel = null;
  });

  /**
   * The account's name is what the student typed at signup, so it is rendered
   * as TEXT and never as markup, and the CSS caps and ellipsises it — the
   * topbar has to stay one row on a 390 px phone (the planner's own budget
   * measures from the viewport's top, so a wrapped topbar is a real
   * regression, not a cosmetic one).
   */
  function renderName(): void {
    const navn = sync.session()?.navn ?? "";
    const label = navn === "" ? "Profil" : navn;
    if (nameEl) nameEl.textContent = label;
    button?.setAttribute("aria-label", navn === "" ? "Profil" : `Profil for ${navn}`);
  }

  renderName();
  // Astro's `swapRootAttributes()` wipes client-set state on every swap and
  // this button is server-rendered, so the name is re-read on each page-load
  // (this function runs from `onPage`) and on every session change in
  // between — the same shape the theme toggle uses for `data-theme`.
  document.addEventListener(ACCOUNT_CHANGE_EVENT, renderName, { signal });
  button.addEventListener("click", () => panel?.show(), { signal });

  document.addEventListener(
    ACCOUNT_OPEN_EVENT,
    (event) => {
      const detail = (event as CustomEvent<AccountOpenDetail>).detail;
      panel?.show(detail?.mode);
    },
    { signal },
  );
}
