/**
 * The session popover — what a bar in the week says when you click it
 * (REWORK-2026-07-29f).
 *
 * A bar shows its course code and, when it is wide enough, its room and
 * activity. Everything else it knows — the exact minutes, the week range, the
 * full course name — was only in its `title` attribute, which never appears on
 * a touch screen. Clicking used to open the course-settings modal instead: a
 * whole-course editor answering a question about one session, and it covered
 * the week to do it.
 *
 * So this is a READ surface: the facts of the one session you pointed at,
 * anchored to it, with a way through to the editor rather than being the
 * editor. `show()`, not `showModal()` — the week stays visible and clicking a
 * different bar just re-targets the same dialog.
 *
 * A non-modal `<dialog>` gets no free dismissal: no Esc, no backdrop. Both are
 * wired by hand at the bottom of this file, and because neither is visible —
 * least of all in the bottom-sheet layout below 60rem, where "outside" is a
 * sliver of screen — a real close button is always rendered.
 */
import type { CourseSource } from "../../lib/planner/store.js";
import { dot, el, icon } from "./dom.js";
import type { BlockDetail } from "./grid.js";

/** Desktop breakpoint — matches the stylesheet's own bottom-sheet cutoff. */
const DESKTOP_QUERY = "(min-width: 60rem)";
/** Gap (px) kept between the card and the anchor bar / viewport edge. */
const ANCHOR_MARGIN = 8;

export interface BlockPopoverContext {
  detail: BlockDetail;
  /** `--hue-*` custom property name, for the head's dot. */
  hueVar: string;
  /** The course's proper name, when the bar knows it. */
  courseName: string;
  source: CourseSource;
  dropped: boolean;
}

export interface BlockPopoverHandle {
  showFor(ctx: BlockPopoverContext, anchor: HTMLElement): void;
  close(): void;
}

/**
 * Mounts the popover once. Idempotent against a stale dialog left by a
 * previous mount and self-removes on `signal` abort (a page swap under
 * ClientRouter) — the same idiom as the other surfaces here.
 *
 * `onOpenSettings` is the way out to the editor: the popover answers "what is
 * this", the modal answers "change it", and one link joins them.
 */
export function mountBlockPopover(
  onOpenSettings: (code: string) => void,
  signal: AbortSignal,
): BlockPopoverHandle {
  document.getElementById("planner-block-popover")?.remove();

  const dialog = el("dialog", "np-frame block-popover");
  dialog.id = "planner-block-popover";
  dialog.setAttribute("aria-labelledby", "block-popover-title");
  document.body.append(dialog);

  let invoker: HTMLElement | null = null;
  const desktop = window.matchMedia(DESKTOP_QUERY);

  function close(): void {
    if (dialog.open) dialog.close();
  }

  function render(ctx: BlockPopoverContext): void {
    dialog.replaceChildren();
    const { detail } = ctx;

    const head = el("div", "block-popover-head");
    const title = el("h3", "block-popover-title");
    title.id = "block-popover-title";
    title.append(dot(ctx.hueVar));
    title.append(el("span", "np-data block-popover-code", detail.code));
    head.append(title);

    const closeBtn = el("button", "np-icon-btn block-popover-close");
    closeBtn.append(icon("close"));
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Lukk");
    closeBtn.addEventListener("click", close);
    head.append(closeBtn);
    dialog.append(head);

    if (ctx.courseName) dialog.append(el("p", "block-popover-name", ctx.courseName));

    // The facts the bar could not fit, one per line rather than joined by
    // separators: at this size a run-on "Forelesning · 08:15–10:00 · R1 · uke
    // 34–47" is the same wall of text the bar was already truncating.
    const facts = el("dl", "block-popover-facts");
    for (const [label, value] of [
      ["Når", detail.timeLabel],
      ["Rom", detail.rooms],
      ["Hva", detail.entryName ?? ""],
      ["Uker", detail.weeksLabel],
    ] as const) {
      if (!value) continue;
      facts.append(el("dt", "block-popover-label", label));
      facts.append(el("dd", "block-popover-value np-data", value));
    }
    dialog.append(facts);

    const actions = el("div", "block-popover-actions");
    const settings = el("button", "np-btn block-popover-settings", "Innstillinger");
    settings.type = "button";
    settings.setAttribute("aria-label", `Innstillinger for ${detail.code}`);
    settings.addEventListener("click", () => {
      close();
      onOpenSettings(detail.code);
    });
    actions.append(settings);

    const link = el("a", "block-popover-link", "Gå til emnesiden");
    link.append(icon("arrowRight"));
    link.href = `/emne/${detail.code}/`;
    actions.append(link);
    dialog.append(actions);
  }

  /**
   * Desktop: a card pinned just under the bar, flipped above when there is no
   * room below and clamped to the viewport. Below 60rem the stylesheet turns
   * it into a bottom sheet, so the inline coordinates are cleared rather than
   * left to fight it.
   */
  function position(anchor: HTMLElement): void {
    if (!anchor.isConnected) return;
    if (!desktop.matches) {
      dialog.style.removeProperty("top");
      dialog.style.removeProperty("left");
      return;
    }
    const a = anchor.getBoundingClientRect();
    const d = dialog.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    let top = a.bottom + ANCHOR_MARGIN;
    if (top + d.height > vh - ANCHOR_MARGIN) top = a.top - d.height - ANCHOR_MARGIN;
    top = Math.max(ANCHOR_MARGIN, Math.min(top, vh - d.height - ANCHOR_MARGIN));

    const left = Math.max(ANCHOR_MARGIN, Math.min(a.left, vw - d.width - ANCHOR_MARGIN));

    dialog.style.top = `${top}px`;
    dialog.style.left = `${left}px`;
  }

  // Neither Esc nor an outside click is free for a non-modal dialog.
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && dialog.open) close();
    },
    { signal },
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (dialog.open && !dialog.contains(event.target as Node)) close();
    },
    { signal },
  );
  dialog.addEventListener("close", () => {
    // `close` fires from a queued task, so clicking straight from one bar to
    // another can run it AFTER `showFor` has re-targeted the dialog. Acting
    // then would steal focus back from the bar being opened.
    if (dialog.open) return;
    if (invoker?.isConnected) invoker.focus();
    invoker = null;
  });
  signal.addEventListener("abort", () => dialog.remove());

  return {
    showFor(ctx, anchor) {
      invoker = anchor;
      render(ctx);
      dialog.scrollTop = 0;
      if (!dialog.open) dialog.show();
      position(anchor);
    },
    close,
  };
}
