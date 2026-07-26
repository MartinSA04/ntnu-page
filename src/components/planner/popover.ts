/**
 * Block popover — the detail + group-picker surface a clicked timetable
 * block (or "+N til" overflow chip) opens (Task 8; consumes `BlockDetail` /
 * `GridRenderOptions.onBlockClick` from grid.ts, Task 7, and `GroupOption` /
 * `PlanStore.setCourseGroups` from groups.ts/store.ts, Tasks 2–3).
 *
 * One shared, non-modal `<dialog>` mounted once: `show()`, not
 * `showModal()`, so the grid stays interactive behind it — there is no
 * backdrop blocking clicks, and clicking a different block just re-targets
 * the same dialog (a fresh `showFor` call) rather than requiring a
 * close-then-reopen dance.
 *
 * A multi-section course (EXPH0300's three campus lecture streams,
 * TDT4110's three parallels…) needs exactly one lecture parallel plus
 * whichever øving/lab group the student was assigned — this is where they
 * pick it. Every group edit calls `store.setCourseGroups` immediately: the
 * store's plan-change event re-renders the grid live behind the (still
 * open) dialog, so the effect of a pick is visible without a Lagre step.
 * The dialog's own radio/checkbox display is kept in sync the same way —
 * `renderContent` is a full, idempotent rebuild driven by the local
 * `selection`, called again after every edit.
 */
import type { GroupOption } from "../../lib/planner/groups.js";
import type { CourseSource, PlanStore } from "../../lib/planner/store.js";
import { el } from "./dom.js";
import type { BlockDetail } from "./grid.js";

/** Desktop breakpoint — matches plannerApp's own side-by-side/tab-switch cutoff. */
const DESKTOP_QUERY = "(min-width: 60rem)";
/** Gap (px) kept between the popover and the anchor block / viewport edge. */
const ANCHOR_MARGIN = 8;

/**
 * The material a clicked block (or overflow chip) hands the popover — built
 * by the caller from `BlockDetail` plus the course's plan/group state.
 */
export interface BlockPopoverContext {
  detail: BlockDetail;
  /** ALL of this course's group options (every lecture parallel + øving/lab group), from the unfiltered bundle timetable. */
  groups: GroupOption[];
  /** `course.groups ?? []` — empty means "no explicit pick, defaults apply". */
  selected: string[];
  /** `defaultLectureKeys(...)` for this course — which lecture option is "din parallell". */
  defaults: string[];
  source: CourseSource;
  dropped: boolean;
}

export interface BlockPopoverHandle {
  showFor(ctx: BlockPopoverContext, anchor: HTMLElement): void;
}

/**
 * Mounts the shared popover once. Idempotent against a stale dialog left by
 * a previous mount (same guard as studieinfo.ts's modal) and self-removes on
 * `signal` abort (a page swap under ClientRouter).
 */
export function mountBlockPopover(store: PlanStore, signal: AbortSignal): BlockPopoverHandle {
  document.getElementById("planner-popover")?.remove();

  const dialog = el("dialog", "np-frame planner-popover");
  dialog.id = "planner-popover";
  dialog.setAttribute("aria-labelledby", "planner-popover-title");
  document.body.append(dialog);

  /** The element focus returns to once the dialog closes. */
  let invoker: HTMLElement | null = null;
  /** The context currently on screen; null while closed. */
  let current: BlockPopoverContext | null = null;
  /** This session's explicit group selection — starts at `ctx.selected`, mutated as the student picks, mirrored to the store on every change. */
  let selection: string[] = [];

  const desktopQuery = window.matchMedia(DESKTOP_QUERY);

  function close(): void {
    if (dialog.open) dialog.close();
  }

  function lectureKeysOf(ctx: BlockPopoverContext): Set<string> {
    return new Set(ctx.groups.filter((g) => g.kind === "lecture").map((g) => g.key));
  }

  /** Applies a new explicit selection: store first (live grid update), then this dialog's own display. */
  function setSelection(next: string[]): void {
    if (!current) return;
    selection = next;
    store.setCourseGroups(current.detail.code, next);
    renderContent(current);
    if (invoker) position(invoker);
  }

  /** Radio pick: the parallel replaces any previous one, øving/lab picks carry over untouched. */
  function pickLecture(ctx: BlockPopoverContext, key: string): void {
    const lectureKeys = lectureKeysOf(ctx);
    setSelection([key, ...selection.filter((k) => !lectureKeys.has(k))]);
  }

  /** Checkbox toggle: add/remove one øving/lab key, everything else untouched. */
  function toggleOther(key: string, checked: boolean): void {
    setSelection(
      checked ? [...selection.filter((k) => k !== key), key] : selection.filter((k) => k !== key),
    );
  }

  function showAllGroups(): void {
    setSelection([]);
  }

  // --- Content ---------------------------------------------------------

  /**
   * Radio per lecture-kind option, checkbox per øving/lab option — in
   * `ctx.groups`'s own order (lecture-kind first, then label). A lecture
   * option is checked when its key is in the explicit selection, or — no
   * explicit selection yet — when it is one of `ctx.defaults`; either way,
   * any option that came from `ctx.defaults` is labeled "(din parallell)"
   * regardless of what is currently picked, so the student's assigned
   * default stays identifiable even after they switch away from it.
   */
  function renderGroupsSection(ctx: BlockPopoverContext): HTMLElement {
    const section = el("div", "planner-popover-groups");
    section.append(el("p", "np-kicker", "Grupper"));

    const list = el("div", "planner-popover-group-list");
    const checkedLectureKeys = selection.length > 0 ? selection : ctx.defaults;

    for (const option of ctx.groups) {
      const row = el("label", "planner-popover-group-row");
      const input = el("input");
      if (option.kind === "lecture") {
        input.type = "radio";
        input.name = "planner-popover-lecture";
        input.checked = checkedLectureKeys.includes(option.key);
        input.addEventListener("change", () => {
          if (input.checked) pickLecture(ctx, option.key);
        });
      } else {
        input.type = "checkbox";
        input.checked = selection.includes(option.key);
        input.addEventListener("change", () => toggleOther(option.key, input.checked));
      }
      row.append(input);
      const text = ctx.defaults.includes(option.key)
        ? `${option.label} (din parallell)`
        : option.label;
      row.append(el("span", undefined, text));
      list.append(row);
    }
    section.append(list);

    const showAll = el("button", "np-btn planner-popover-showall", "Vis alle grupper");
    showAll.type = "button";
    showAll.addEventListener("click", showAllGroups);
    section.append(showAll);

    return section;
  }

  /** Dropp/Legg tilbake mirrors the course row's own toggle (§0.3); a manual add's is "Fjern fra planen". */
  function renderActions(ctx: BlockPopoverContext): HTMLElement {
    const row = el("div", "planner-popover-actions");
    const { detail, source, dropped } = ctx;
    const isProgram = source === "program";
    const label = isProgram ? (dropped ? "Legg tilbake" : "Dropp") : "Fjern fra planen";

    const action = el("button", "np-btn planner-popover-action", label);
    action.type = "button";
    action.addEventListener("click", () => {
      if (isProgram) {
        if (dropped) store.restoreCourse(detail.code);
        else store.dropCourse(detail.code);
      } else {
        store.removeCourse(detail.code);
      }
      // The clicked block is about to disappear from the grid (dropped and
      // manual-removed courses are both excluded from the schedule) — an
      // anchor-less popover left floating would be stale, so close it.
      close();
    });
    row.append(action);

    const link = el("a", "planner-popover-link", "Gå til emnesiden →");
    link.href = `/emne/${detail.code}/`;
    row.append(link);

    return row;
  }

  function renderContent(ctx: BlockPopoverContext): void {
    dialog.replaceChildren();

    const title = el("h3", undefined, `${ctx.detail.code} · ${ctx.detail.name}`);
    title.id = "planner-popover-title";
    dialog.append(title);

    const noteText = [ctx.detail.timeLabel, ctx.detail.rooms, ctx.detail.weeksLabel]
      .filter(Boolean)
      .join(" · ");
    dialog.append(el("p", "np-note", noteText));

    if (ctx.groups.length > 1) dialog.append(renderGroupsSection(ctx));
    dialog.append(renderActions(ctx));
  }

  // --- Positioning -------------------------------------------------------

  /**
   * Desktop (≥60rem): a floating card pinned just below the anchor block,
   * flipped above it when there isn't room below, clamped to the viewport.
   * Below 60rem the CSS media query turns `.planner-popover` into a bottom
   * sheet — inline top/left are cleared here so they can't fight it.
   */
  function position(anchor: HTMLElement): void {
    if (!desktopQuery.matches) {
      dialog.style.removeProperty("top");
      dialog.style.removeProperty("left");
      return;
    }
    const anchorRect = anchor.getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    const viewportW = document.documentElement.clientWidth;
    const viewportH = document.documentElement.clientHeight;

    let top = anchorRect.bottom + ANCHOR_MARGIN;
    if (top + dialogRect.height > viewportH - ANCHOR_MARGIN) {
      top = anchorRect.top - dialogRect.height - ANCHOR_MARGIN;
    }
    top = Math.max(ANCHOR_MARGIN, Math.min(top, viewportH - dialogRect.height - ANCHOR_MARGIN));

    let left = anchorRect.left;
    left = Math.max(ANCHOR_MARGIN, Math.min(left, viewportW - dialogRect.width - ANCHOR_MARGIN));

    dialog.style.top = `${top}px`;
    dialog.style.left = `${left}px`;
  }

  function showFor(ctx: BlockPopoverContext, anchor: HTMLElement): void {
    invoker = anchor;
    current = ctx;
    selection = [...ctx.selected];
    renderContent(ctx);
    dialog.scrollTop = 0;
    if (!dialog.open) dialog.show();
    position(anchor);
  }

  // --- Dismissal -----------------------------------------------------------

  // Non-modal dialogs get no free Esc-to-close (that is a showModal() only
  // behaviour) or backdrop click, so both are wired by hand.
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
    invoker?.focus?.();
    invoker = null;
    current = null;
  });
  signal.addEventListener("abort", () => dialog.remove());

  return { showFor };
}
