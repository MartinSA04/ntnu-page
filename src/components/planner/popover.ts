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
 * A non-modal dialog gets NO free dismissal: no Esc, no backdrop. Both are
 * wired by hand at the bottom of this file, and — because neither is visible,
 * least of all in the sub-60rem bottom-sheet layout where "outside" is a
 * sliver of screen — a `×` close button is always rendered (`renderClose`).
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
 *
 * A "+N til" overflow chip whose hidden entries span more than one course
 * has no single course to key group/action state off (`detail.code` is the
 * codes joined `" · "`) — that context is `kind: "info"` (Task 12): the
 * dialog still opens with the detail's facts, just with no group section
 * and no dropp/fjern action, since neither means anything for a joint pile.
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
export type BlockPopoverContext =
  | {
      kind: "course";
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
  | {
      /** A multi-course "+N til" overflow chip — informational only, no groups/actions. */
      kind: "info";
      detail: BlockDetail;
    };

export interface BlockPopoverHandle {
  showFor(ctx: BlockPopoverContext, anchor: HTMLElement): void;
}

/** The narrowed `kind: "course"` half of the context — what the group picker/actions need. */
type CoursePopoverContext = Extract<BlockPopoverContext, { kind: "course" }>;

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

  function lectureKeysOf(ctx: CoursePopoverContext): Set<string> {
    return new Set(ctx.groups.filter((g) => g.kind === "lecture").map((g) => g.key));
  }

  /**
   * Applies a new explicit selection: store first (live grid update), then
   * this dialog's own display. `focusKey` re-focuses the input for that
   * group key after the rebuild, so toggling a checkbox/radio with the
   * keyboard doesn't drop focus back to the document.
   */
  function setSelection(next: string[], focusKey?: string): void {
    if (!current) return;
    selection = next;
    store.setCourseGroups(current.detail.code, next);
    renderContent(current);
    if (invoker) position(invoker);
    if (focusKey) {
      dialog.querySelector<HTMLInputElement>(`input[value="${CSS.escape(focusKey)}"]`)?.focus();
    }
  }

  /** Radio pick: the parallel replaces any previous one, øving/lab picks carry over untouched. */
  function pickLecture(ctx: CoursePopoverContext, key: string): void {
    const lectureKeys = lectureKeysOf(ctx);
    setSelection([key, ...selection.filter((k) => !lectureKeys.has(k))], key);
  }

  /**
   * Checkbox toggle: add/remove one øving/lab key against the *effective*
   * base, not the raw explicit selection. With no explicit pick yet,
   * `selection` is `[]` — starting from `[]` here would write an explicit
   * selection containing only the øving key, and `applyGroupSelection`
   * would then filter out every named lecture entry (nothing in the
   * selection names them), vanishing the course's lectures from the grid.
   * Seeding from `ctx.defaults` (the same fallback the display already
   * uses) keeps the student's default lecture parallel in the selection.
   */
  function toggleOther(key: string, checked: boolean): void {
    const base: string[] =
      selection.length > 0 ? selection : current?.kind === "course" ? current.defaults : [];
    setSelection(
      checked ? [...base.filter((k) => k !== key), key] : base.filter((k) => k !== key),
      key,
    );
  }

  // --- Content ---------------------------------------------------------

  /**
   * Which options are worth offering. A control the student cannot use to
   * make a different choice is noise: one lecture parallel does not need a
   * radio to select it, and one øving group does not need a checkbox.
   * The two kinds are counted SEPARATELY — the old gate was
   * `ctx.groups.length > 1` across both, so a course with a single parallel
   * and two øving groups drew a lone dead radio above the useful checkboxes.
   */
  function pickableGroups(ctx: CoursePopoverContext): {
    lectures: GroupOption[];
    others: GroupOption[];
  } {
    const lectures = ctx.groups.filter((g) => g.kind === "lecture");
    const others = ctx.groups.filter((g) => g.kind !== "lecture");
    return {
      lectures: lectures.length > 1 ? lectures : [],
      others: others.length > 1 ? others : [],
    };
  }

  /**
   * Radio per lecture-kind option, checkbox per øving/lab option — in
   * `ctx.groups`'s own order (lecture-kind first, then label), minus whichever
   * kind has nothing to choose between (`pickableGroups`). A lecture
   * option is checked when the explicit selection contains a lecture key
   * (whichever one), or — no lecture key in the selection, whether because
   * there is no explicit selection at all or because it only names øving/lab
   * groups so far — when it is one of `ctx.defaults`; either way, any option
   * that came from `ctx.defaults` is labeled "(din parallell)" regardless of
   * what is currently picked, so the student's assigned default stays
   * identifiable even after they switch away from it.
   *
   * There is no "Vis alle grupper" button. It called `setSelection([])`, and
   * `[]` is `applyGroupSelection`'s encoding for "no explicit pick, apply the
   * programme default" (groups.ts) — so the button NARROWED the week to one
   * parallel, the exact opposite of its label. The radios and checkboxes
   * already express every selection there is.
   */
  function renderGroupsSection(ctx: CoursePopoverContext): HTMLElement {
    const { lectures, others } = pickableGroups(ctx);
    const section = el("div", "planner-popover-groups");
    section.append(el("p", "np-kicker", "Grupper"));

    const list = el("div", "planner-popover-group-list");
    const lectureKeys = lectureKeysOf(ctx);
    const hasExplicitLecture = selection.some((k) => lectureKeys.has(k));
    const checkedLectureKeys = hasExplicitLecture ? selection : ctx.defaults;

    for (const option of [...lectures, ...others]) {
      const row = el("label", "planner-popover-group-row");
      const input = el("input");
      input.value = option.key;
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

    return section;
  }

  /** Dropp/Legg tilbake mirrors the course row's own toggle (§0.3); a manual add's is "Fjern fra planen". */
  function renderActions(ctx: CoursePopoverContext): HTMLElement {
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

  /**
   * The close button. Esc and an outside pointerdown (wired below) are the
   * only two ways out a non-modal `<dialog>` gets by hand, and neither is
   * visible: below 60rem this is a full-bleed bottom sheet, so "outside" is a
   * strip of screen a student has no reason to suspect is a dismiss target,
   * and on touch there is no Esc at all. So there is always a real control.
   */
  function renderClose(): HTMLElement {
    const button = el("button", "np-icon-btn planner-popover-close", "×") as HTMLButtonElement;
    button.type = "button";
    button.setAttribute("aria-label", "Lukk");
    button.addEventListener("click", close);
    return button;
  }

  function renderContent(ctx: BlockPopoverContext): void {
    dialog.replaceChildren();

    const head = el("div", "planner-popover-head");
    const title = el("h3", "planner-popover-title", `${ctx.detail.code} · ${ctx.detail.name}`);
    title.id = "planner-popover-title";
    head.append(title, renderClose());
    dialog.append(head);

    const noteText = [ctx.detail.timeLabel, ctx.detail.rooms, ctx.detail.weeksLabel]
      .filter(Boolean)
      .join(" · ");
    dialog.append(el("p", "np-note", noteText));

    if (ctx.kind !== "course") return;
    const { lectures, others } = pickableGroups(ctx);
    if (lectures.length > 0 || others.length > 0) dialog.append(renderGroupsSection(ctx));
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
    selection = ctx.kind === "course" ? [...ctx.selected] : [];
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
