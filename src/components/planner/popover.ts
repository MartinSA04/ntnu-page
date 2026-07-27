/**
 * Block popover — the detail + group-picker surface a clicked timetable
 * block (or a pile of simultaneous ones) opens (Task 8; consumes `BlockDetail` /
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
 * pick it. But a lecture list is NOT always a list of alternatives: TMA4400
 * teaches "Forelesning 1 …", "Forelesning 2 …" and "Plenumsregning" to the
 * same programme cluster, three complementary weekly sessions. Rendering
 * those as one radio group made picking your own programme's session delete
 * the other two thirds of the course (audit groups-2), so which control the
 * lecture layer gets is decided from `ctx.defaults` — groups.ts's own answer
 * to "did we narrow this to one group?" — not from `kind === "lecture"`.
 * `applyGroupSelection` narrows a lecture pick per session family as well, so
 * no control here can delete a session the student did not pick in; the choice
 * of control is what makes the narrowing legible, not what enforces it.
 *
 * Every group edit calls `store.setCourseGroups` immediately: the
 * store's plan-change event re-renders the grid live behind the (still
 * open) dialog, so the effect of a pick is visible without a Lagre step.
 * The dialog's own radio/checkbox display is kept in sync the same way —
 * `renderContent` is a full, idempotent rebuild driven by the local
 * `selection`, called again after every edit.
 *
 * A pile — the single block a cluster too deep to lay out side by side
 * collapses into (grid.ts) — spanning more than one course has no single
 * course to key group/action state off (`detail.code` is the codes joined
 * `" · "`) — that context is `kind: "info"` (Task 12): the dialog opens with
 * the detail's facts and one course-page link per code, with no group section
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
 * The material a clicked block (or pile) hands the popover — built by the
 * caller from `BlockDetail` plus the course's plan/group state.
 */
export type BlockPopoverContext =
  | {
      kind: "course";
      detail: BlockDetail;
      /** ALL of this course's group options (every lecture parallel + øving/lab group), from the unfiltered bundle timetable. */
      groups: GroupOption[];
      /** `course.groups ?? []` — empty means "no explicit pick, defaults apply". */
      selected: string[];
      /**
       * `resolveLectureDefaults(...).keys` for this course — the lecture
       * group(s) the week draws before the student picks. Also the signal for
       * whether the lecture options are alternatives at all, see
       * `lecturesAreExclusive`.
       */
      defaults: string[];
      /**
       * `resolveLectureDefaults(...).resolved` (groups.ts): `false` when
       * `defaults` is one provisional pick per ambiguous session family rather
       * than the student's own parallel. Optional because the caller does not
       * compute it yet — until it does, a default is labeled "(din parallell)"
       * as before, which is a lie for the unresolved case (audit groups-5).
       */
      resolved?: boolean;
      source: CourseSource;
      dropped: boolean;
    }
  | {
      /** A multi-course pile — informational, plus one link per course; no groups/actions. */
      kind: "info";
      detail: BlockDetail;
    };

export interface BlockPopoverHandle {
  showFor(ctx: BlockPopoverContext, anchor: HTMLElement): void;
}

/** The narrowed `kind: "course"` half of the context — what the group picker/actions need. */
type CoursePopoverContext = Extract<BlockPopoverContext, { kind: "course" }>;

/**
 * Are this course's lecture options alternatives to each other?
 *
 * `defaults` is `resolveLectureDefaults(...).keys` (groups.ts), and its length
 * answers the question outright:
 *  - exactly one key — the lecture layer was narrowed to one group, either by
 *    the programme's own section or as one family of numbered parallels, so
 *    every other option is an alternative to it: a radio, and picking one
 *    replaces the layer.
 *  - no keys — nothing was narrowed. The listed groups are complementary
 *    weekly sessions (TMA4400's "Forelesning 1 …" + "Forelesning 2 …" +
 *    "Plenumsregning" for one cluster) or other programmes' sections; calling
 *    those alternatives is what deleted two thirds of a course (groups-2).
 *  - several keys — one provisional pick per session family. A single radio
 *    group cannot express "one from each family" either.
 * The last two cases are additive checkboxes: an allow-list, exactly what
 * `applyGroupSelection` does with an explicit pick.
 */
export function lecturesAreExclusive(defaults: string[]): boolean {
  return defaults.length === 1;
}

/**
 * The selection to store after the student toggles one option — the whole
 * write path, kept pure so the half that has twice deleted real teaching from
 * the week (audit week-1, groups-2) is unit-testable without a DOM.
 *
 * `layerKeys` holds the keys of the layer being edited (lecture, or øving/lab);
 * the other layer's picks carry through untouched, because groups.ts applies a
 * selection per activity kind. `shown` is what that layer draws right now (its
 * explicit picks, else its defaults): an additive edit starts from what the
 * student can see, so ticking a second option adds to the first instead of
 * silently replacing it. `exclusive` is the radio case — the pick is the whole
 * layer. Emptying a layer returns it to the default: `applyGroupSelection`
 * treats "no pick for this kind" as "apply the programme default", which is
 * the way back out of a wrong pick (groups-6).
 */
export function nextSelection(args: {
  selection: string[];
  layerKeys: Set<string>;
  shown: string[];
  key: string;
  checked: boolean;
  exclusive: boolean;
}): string[] {
  const { selection, layerKeys, shown, key, checked, exclusive } = args;
  const otherLayer = selection.filter((k) => !layerKeys.has(k));
  if (exclusive) return checked ? [key, ...otherLayer] : otherLayer;
  const layer = shown.filter((k) => k !== key);
  return checked ? [...layer, key, ...otherLayer] : [...layer, ...otherLayer];
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

  function lectureKeysOf(ctx: CoursePopoverContext): Set<string> {
    return new Set(ctx.groups.filter((g) => g.kind === "lecture").map((g) => g.key));
  }

  /** The lecture keys the week draws right now: the explicit pick, else the default. */
  function shownLectures(ctx: CoursePopoverContext): string[] {
    const keys = lectureKeysOf(ctx);
    const picked = selection.filter((k) => keys.has(k));
    return picked.length > 0 ? picked : ctx.defaults;
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
    // The store's plan-change event has already rebuilt the grid under us, so
    // the block we are pinned to may be a fresh node by now (audit app-2).
    refreshInvoker();
    if (invoker) position(invoker);
    if (focusKey) {
      dialog.querySelector<HTMLInputElement>(`input[value="${CSS.escape(focusKey)}"]`)?.focus();
    }
  }

  /** Lecture edit: exclusive (radio) or additive (checkbox) per `lecturesAreExclusive`. */
  function toggleLecture(ctx: CoursePopoverContext, key: string, checked: boolean): void {
    setSelection(
      nextSelection({
        selection,
        layerKeys: lectureKeysOf(ctx),
        shown: shownLectures(ctx),
        key,
        checked,
        exclusive: lecturesAreExclusive(ctx.defaults),
      }),
      key,
    );
  }

  /**
   * Øving/lab checkbox toggle. It seeds from the øving/lab picks alone and
   * never touches the lecture layer: `applyGroupSelection` applies a selection
   * per activity kind, so a selection naming only øving keys leaves the
   * lectures on their default (audit week-1/groups-1). This used to seed from
   * `ctx.defaults` to keep the lectures alive through the old flat allow-list —
   * which did not work for the common single-lecture-group course (`defaults`
   * is empty there, and both of TMA4412's weekly lectures vanished on the first
   * tick) and wrote a provisional guess into the student's stored plan.
   */
  function toggleOther(ctx: CoursePopoverContext, key: string, checked: boolean): void {
    const lectureKeys = lectureKeysOf(ctx);
    const otherKeys = new Set(ctx.groups.map((g) => g.key).filter((k) => !lectureKeys.has(k)));
    setSelection(
      nextSelection({
        selection,
        layerKeys: otherKeys,
        shown: selection.filter((k) => otherKeys.has(k)),
        key,
        checked,
        exclusive: false,
      }),
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
   * One control per option — in `ctx.groups`'s own order (lecture-kind first,
   * then label), minus whichever kind has nothing to choose between
   * (`pickableGroups`). Øving/lab options are always checkboxes; the lecture
   * layer gets radios only when its options really are alternatives
   * (`lecturesAreExclusive`) and additive checkboxes otherwise, because a
   * radio group is a promise that picking one turns the others off — true for
   * TDT4110's three parallels, false and destructive for TMA4400's three
   * weekly sessions (groups-2).
   *
   * A control is checked when the layer draws that group right now: the
   * explicit picks, or — no pick for that layer yet — `ctx.defaults`. An
   * option that came from `ctx.defaults` is labeled "(din parallell)"
   * regardless of what is currently picked, so the student's assigned default
   * stays identifiable after they switch away from it; the label is dropped
   * when the caller tells us the default was only a guess (`resolved: false`),
   * since naming a provisional pick "din parallell" is a lie (groups-5).
   *
   * There is no "Vis alle grupper" button. It called `setSelection([])`, and
   * `[]` is `applyGroupSelection`'s encoding for "no explicit pick, apply the
   * programme default" (groups.ts) — so the button NARROWED the week to one
   * parallel, the exact opposite of its label. "Nullstill gruppevalg" is the
   * same call under a name that says what it does, and it is the only way back
   * from a radio, which the student cannot untick (groups-6).
   */
  function renderGroupsSection(ctx: CoursePopoverContext): HTMLElement {
    const { lectures, others } = pickableGroups(ctx);
    const exclusive = lecturesAreExclusive(ctx.defaults);
    const section = el("div", "planner-popover-groups");
    section.append(el("p", "np-kicker", "Grupper"));

    const list = el("div", "planner-popover-group-list");
    const drawnLectures = shownLectures(ctx);

    // An unticked checkbox reads as "off". A course whose lecture layer was
    // narrowed by nothing has no ticked box and every session on screen — say
    // so, or the picker denies what the week is drawing.
    if (lectures.length > 0 && !exclusive && drawnLectures.length === 0) {
      section.append(
        el("p", "np-hint", "Uten avkryssing viser uka alle forelesningene vi tror er dine."),
      );
    }

    for (const option of [...lectures, ...others]) {
      const isLecture = option.kind === "lecture";
      const row = el("label", "planner-popover-group-row");
      const input = el("input");
      input.value = option.key;
      if (isLecture && exclusive) {
        input.type = "radio";
        input.name = "planner-popover-lecture";
      } else {
        input.type = "checkbox";
      }
      input.checked = isLecture
        ? drawnLectures.includes(option.key)
        : selection.includes(option.key);
      input.addEventListener("change", () => {
        if (isLecture) toggleLecture(ctx, option.key, input.checked);
        else toggleOther(ctx, option.key, input.checked);
      });
      row.append(input);
      const isDefault = ctx.defaults.includes(option.key) && ctx.resolved !== false;
      row.append(
        el("span", undefined, isDefault ? `${option.label} (din parallell)` : option.label),
      );
      list.append(row);
    }
    section.append(list);

    if (selection.length > 0) {
      const actions = el("div", "planner-popover-group-actions");
      const reset = el("button", "np-btn planner-popover-reset", "Nullstill gruppevalg");
      reset.type = "button";
      reset.addEventListener("click", () => {
        setSelection([]);
        // The reset renders only while there is something to reset, so it has
        // just removed itself from under the pointer/caret — hand focus to the
        // list it belongs to rather than dropping it on <body>.
        dialog.querySelector<HTMLInputElement>(".planner-popover-group-row input")?.focus();
      });
      actions.append(reset);
      section.append(actions);
    }

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
   * A pile's way out: one course-page link per code. A pile is the week's most
   * compressed block — several courses' sessions in one slab — and its popover
   * was a dead end, since `renderContent` returned before `renderActions` and
   * the pile got no link at all (audit grid-1). The course page is where the
   * detail the pile compressed away is recoverable, so every code gets its own
   * named link rather than one ambiguous "Gå til emnesiden →". `detail.code` is
   * the codes joined `" · "` by grid.ts's `pileDetail`.
   */
  function renderPileLinks(detail: BlockDetail): HTMLElement {
    const row = el("div", "planner-popover-actions");
    for (const raw of detail.code.split(" · ")) {
      const code = raw.trim();
      if (code === "") continue;
      const link = el("a", "planner-popover-link", `Gå til ${code} →`);
      link.href = `/emne/${code}/`;
      row.append(link);
    }
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

    // Empty for a "velg din gruppe" note, which opens this dialog for a whole
    // course rather than one session — there is no single slot to describe,
    // and an empty <p> is a gap in the layout that reads as a missing fact.
    const noteText = [ctx.detail.timeLabel, ctx.detail.rooms, ctx.detail.weeksLabel]
      .filter(Boolean)
      .join(" · ");
    if (noteText) dialog.append(el("p", "np-note", noteText));

    if (ctx.kind !== "course") {
      dialog.append(renderPileLinks(ctx.detail));
      return;
    }
    const { lectures, others } = pickableGroups(ctx);
    if (lectures.length > 0 || others.length > 0) dialog.append(renderGroupsSection(ctx));
    dialog.append(renderActions(ctx));
  }

  // --- Positioning -------------------------------------------------------

  /**
   * The clicked block, re-resolved after the grid has been rebuilt under us.
   * `store.setCourseGroups` re-renders the week synchronously, and the grid's
   * `frame.replaceChildren(...)` detaches every block — including our anchor,
   * whose `getBoundingClientRect()` is then all zeros, which is what sent the
   * card to the viewport corner on the first pick (audit app-2). Blocks carry
   * a stable `planner-block-<ordinal>` id (grid.ts), but the ordinal is only
   * stable while the entry list is — a pick changes how many entries the
   * course contributes — so we adopt the replacement only when it still
   * belongs to this course. Otherwise `invoker` stays detached and `position`
   * leaves the card where it is.
   */
  function refreshInvoker(): void {
    if (!invoker || invoker.isConnected) return;
    const fresh = invoker.id ? document.getElementById(invoker.id) : null;
    const code = fresh?.querySelector(".planner-block-code")?.textContent?.trim();
    if (fresh && code === current?.detail.code) invoker = fresh;
  }

  /**
   * Desktop (≥60rem): a floating card pinned just below the anchor block,
   * flipped above it when there isn't room below, clamped to the viewport.
   * Below 60rem the CSS media query turns `.planner-popover` into a bottom
   * sheet — inline top/left are cleared here so they can't fight it.
   */
  function position(anchor: HTMLElement): void {
    // A detached anchor measures 0×0 at the origin, and clamping that pins the
    // card to (8,8) over the page heading (app-2). Keeping the last good
    // coordinates is both correct and calmer: the card does not move because
    // the block under it was redrawn.
    if (!anchor.isConnected) return;
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

  /**
   * The course's own row action ("Dropp" / "Legg tilbake" / "Fjern") in the
   * plan panel, found by the accessible name plannerApp gives it
   * (`${label} ${code}`) since the row carries no id.
   */
  function courseRowAction(code: string): HTMLElement | null {
    const buttons = Array.from(
      document.querySelectorAll<HTMLElement>("#planner-course-rows .planner-course-remove"),
    );
    for (const button of buttons) {
      if (button.getAttribute("aria-label")?.endsWith(` ${code}`)) return button;
    }
    return null;
  }

  /**
   * Where focus goes when the dialog closes. Normally back to the block that
   * opened it — but "Dropp"/"Fjern" rebuild the grid without that block, and
   * `focus()` on a detached node is a silent no-op that leaves focus on
   * `<body>`, outside the week entirely: the next Tab restarted at the skip
   * link (audit a11y-3). This dialog is deliberately non-modal, so nothing
   * else catches that fall. The course's own row action is the honest landing
   * place — it is the same drop the student just made, so it also undoes it —
   * with the week frame as the last resort for a manual course whose row is
   * gone too.
   */
  function restoreFocus(ctx: BlockPopoverContext | null): void {
    if (invoker?.isConnected) {
      invoker.focus();
      return;
    }
    const rowAction = ctx?.kind === "course" ? courseRowAction(ctx.detail.code) : null;
    if (rowAction) {
      rowAction.focus();
      return;
    }
    const frame = document.getElementById("planner-grid-frame");
    if (!frame) return;
    // The frame is a plain <div>; it has to be programmatically focusable
    // before it can catch anything.
    frame.tabIndex = -1;
    frame.focus();
  }

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
    // `close` is fired from a queued task, so clicking straight from one block
    // to another can run it AFTER `showFor` has re-targeted the dialog. Acting
    // then would steal focus and null the context the new block is being
    // edited through.
    if (dialog.open) return;
    restoreFocus(current);
    invoker = null;
    current = null;
  });
  signal.addEventListener("abort", () => dialog.remove());

  return { showFor };
}
