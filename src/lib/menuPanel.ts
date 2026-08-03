/**
 * One collapsible chrome menu, driven from a wrapper that changes clothes.
 *
 * ABOVE its breakpoint the wrapper is `display: contents` and its children lay
 * out as direct children of the bar, exactly as they would if no menu existed;
 * BELOW it the wrapper is an absolutely-positioned panel, drawn only while the
 * bar carries `data-menu="open"`. That is the whole mechanism, and it is why
 * this is a positioned `<div>` rather than a `<dialog>` or a `[popover]`:
 * neither of those can be switched back to inline layout by CSS, and switching
 * is the entire point. One DOM means one set of ids — which matters because
 * every control that folds in here is bound by identity somewhere else
 * (`#site-account-btn`, `#planner-semester-select`, …), so a duplicated
 * phone-only copy would collide and a `matchMedia` node-move would relocate a
 * live `<select>` across resizes and ClientRouter swaps.
 *
 * The open state lives on the BAR as `data-menu`, never as `[hidden]` on the
 * wrapper: `primitives.css`'s `[hidden] { display: none !important }` beats any
 * author `display`, `display: contents` included, so hiding the wrapper that
 * way would delete the controls at every width rather than just on a phone.
 *
 * A non-`<dialog>` surface gets no free dismissal, so Esc, the scrim and
 * `focusout` are wired by hand here — the same set `blockPopover.ts` carries,
 * for the same reason. The scrim doubles as the outside-click target: one
 * element to hit-test beats document-level geometry.
 */
export interface MenuPanelOptions {
  /** Carries `data-menu="open"`, and is the panel's positioning context. */
  bar: HTMLElement;
  /** The button that opens it. Gets `aria-expanded`. */
  trigger: HTMLElement;
  /** The wrapper: `display: contents` above the breakpoint, a panel below it. */
  panel: HTMLElement;
  /** The width range in which the panel IS a panel, e.g. `"(max-width: 480px)"`. */
  query: string;
  signal: AbortSignal;
}

export interface MenuPanelHandle {
  close(): void;
  isOpen(): boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), select, input, [tabindex]:not([tabindex="-1"])';

export function mountMenuPanel(options: MenuPanelOptions): MenuPanelHandle {
  const { bar, trigger, panel, query, signal } = options;
  const media = window.matchMedia(query);
  let scrim: HTMLElement | null = null;

  const isOpen = (): boolean => bar.dataset.menu === "open";

  function close(): void {
    if (!isOpen()) return;
    delete bar.dataset.menu;
    trigger.setAttribute("aria-expanded", "false");
    scrim?.remove();
    scrim = null;
    // Only reclaim focus if it is still inside the panel being closed. A click
    // on something else has already moved it somewhere deliberate, and yanking
    // it back to the trigger would undo that.
    if (panel.contains(document.activeElement)) trigger.focus();
  }

  function open(): void {
    if (isOpen() || !media.matches) return;
    bar.dataset.menu = "open";
    trigger.setAttribute("aria-expanded", "true");
    scrim = document.createElement("div");
    scrim.className = "np-menu-scrim";
    scrim.addEventListener("pointerdown", close);
    document.body.append(scrim);
    panel.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }

  trigger.addEventListener(
    "click",
    () => {
      if (isOpen()) close();
      else open();
    },
    { signal },
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && isOpen()) {
        event.preventDefault();
        close();
      }
    },
    { signal },
  );

  // Tabbing out of a menu is being done with it — the rule `blockPopover`
  // applies to a popover you have tabbed out of. `relatedTarget` is null when
  // focus leaves the document entirely (a tab switch, devtools), which is NOT
  // a dismissal: the menu should survive that and still be there on return.
  panel.addEventListener(
    "focusout",
    (event) => {
      const next = (event as FocusEvent).relatedTarget;
      if (!(next instanceof Node)) return;
      if (panel.contains(next) || trigger.contains(next)) return;
      close();
    },
    { signal },
  );

  // Crossing the breakpoint while open would leave `data-menu` set on a bar
  // whose wrapper has gone inline again — a scrim over a menu that is not
  // there, and no visible way to dismiss it.
  media.addEventListener("change", () => close(), { signal });

  signal.addEventListener("abort", () => {
    scrim?.remove();
    scrim = null;
  });

  return { close, isOpen };
}
