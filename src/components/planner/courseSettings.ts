/**
 * Course settings — the ONE surface a planned course is configured on
 * (REWORK-2026-07-29 D1). Replaces `popover.ts`, which could only be reached
 * by clicking a rendered block: a course whose sessions were swallowed by a
 * pile, or which had no timetable at all, had no way to reach its own group
 * picker.
 *
 * Two callers open it and they hand it the same context: a course row in the
 * Emner list, and a block in the week/day grid.
 *
 * It is a real modal (`showModal()`), not the old anchored card. That is the
 * whole reason this file is shorter than the one it replaces: Esc, the
 * backdrop, and focus return to the invoker are native `<dialog>` behaviour,
 * and a centered dialog cannot be knocked out of position by the grid
 * re-rendering underneath it — so `popover.ts`'s hand-wired Escape/outside-
 * pointerdown listeners, its flip-above-when-no-room arithmetic and its
 * `refreshInvoker` anchor re-resolution are all dropped rather than ported.
 *
 * `setCourseGroups` still writes on every edit, so the grid behind the
 * backdrop is already correct when the modal closes; `renderContent` is a
 * full idempotent rebuild driven by the local `selection`, called again
 * after every edit, exactly as before.
 *
 * The group-picker rules themselves are unchanged and moved verbatim from
 * `popover.ts` — `lecturesAreExclusive` and `nextSelection` are re-exported
 * from here now, and `tests/planner/popover.test.ts` moved with them. Those
 * rules have twice deleted real teaching from a student's week (audit
 * week-1, groups-2), so they stay pure and stay tested.
 */
import type { GroupOption } from "../../lib/planner/groups.js";
import type { CourseSource, PlanStore } from "../../lib/planner/store.js";
import { dot, el, formatCreditNumber, icon } from "./dom.js";

/**
 * What the caller hands the modal. Everything the old
 * `BlockPopoverContext["course"]` carried, plus the facts the course row used
 * to print inline (D2 moved them here) — and no `kind: "info"` variant: a
 * pile no longer opens this surface at all, it focuses its day (D5).
 */
export interface CourseSettingsContext {
  code: string;
  /** The course's proper name. */
  name: string;
  /** `--hue-*` custom property name, for the head's dot. */
  hueVar: string;
  credits: number | null;
  /** ALL of this course's group options (every lecture parallel + øving/lab group). */
  groups: GroupOption[];
  /** `course.groups ?? []` — empty means "no explicit pick, defaults apply". */
  selected: string[];
  /**
   * `resolveLectureDefaults(...).keys` — the lecture group(s) the week draws
   * before the student picks. Its LENGTH also decides radios vs checkboxes,
   * see `lecturesAreExclusive`.
   */
  defaults: string[];
  /**
   * `resolveLectureDefaults(...).resolved`: `false` when `defaults` is one
   * provisional pick per ambiguous session family rather than the student's
   * own parallel, in which case no option is labelled "(din parallell)"
   * (groups-5).
   */
  resolved?: boolean;
  source: CourseSource;
  dropped: boolean;
  /**
   * Status fragments the course row used to concatenate into a run-on meta
   * line — "undervises ikke i valgt semester", "ikke undervist i 2026 · sist
   * undervist 2024", "fikk ikke hentet timeplanen". Rendered as one note per
   * entry.
   */
  notes: string[];
  /** Shown when a bundle fetch failed, so the retry is reachable from here. */
  onRetry?: (() => void) | null;
}

export interface CourseSettingsHandle {
  showFor(ctx: CourseSettingsContext): void;
  /** The code currently on screen, or null while closed — lets the caller refresh us in place. */
  currentCode(): string | null;
  close(): void;
}

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
 * Which options are worth offering. A control the student cannot use to make
 * a different choice is noise: one lecture parallel does not need a radio to
 * select it, and one øving group does not need a checkbox. The two kinds are
 * counted SEPARATELY — a course with a single parallel and two øving groups
 * would otherwise draw a lone dead radio above the useful checkboxes.
 */
export function pickableGroups(groups: GroupOption[]): {
  lectures: GroupOption[];
  others: GroupOption[];
} {
  const lectures = groups.filter((g) => g.kind === "lecture");
  const others = groups.filter((g) => g.kind !== "lecture");
  return {
    lectures: lectures.length > 1 ? lectures : [],
    others: others.length > 1 ? others : [],
  };
}

/**
 * Mounts the modal once. Idempotent against a stale dialog left by a previous
 * mount (same guard as studieinfo.ts/addCourse.ts) and self-removes on
 * `signal` abort (a page swap under ClientRouter).
 */
export function mountCourseSettings(store: PlanStore, signal: AbortSignal): CourseSettingsHandle {
  document.getElementById("planner-course-settings")?.remove();

  const dialog = el("dialog", "np-frame course-settings");
  dialog.id = "planner-course-settings";
  dialog.setAttribute("aria-labelledby", "course-settings-title");
  document.body.append(dialog);

  /** The context currently on screen; null while closed. */
  let current: CourseSettingsContext | null = null;
  /** This session's explicit group selection — starts at `ctx.selected`, mirrored to the store on every change. */
  let selection: string[] = [];
  /** What opened the dialog — see `restoreFocus`. */
  let invoker: HTMLElement | null = null;

  function close(): void {
    if (dialog.open) dialog.close();
  }

  /**
   * Where focus goes on close.
   *
   * `showModal()` returns focus to the invoker for free — but ONLY while the
   * invoker is still in the document, and Dropp/Fjern is precisely the case
   * where it is not: the grid re-renders without that block, and `focus()` on a
   * detached node is a silent no-op that leaves focus on `<body>`, so the next
   * Tab restarts at the skip link (audit a11y-3, which the popover fixed by
   * hand and which came straight back when this became a modal — e2e caught it).
   *
   * The course's own settings BUTTON in the Emner list is the honest landing
   * place: that row still shows the course, and the button reopens this dialog,
   * so the undo is one keystroke away. The button, not the row — the row is
   * inert now and `focus()` on it would be the same silent no-op this exists to
   * avoid. The week frame is the last resort for a manual course whose row is
   * gone too.
   */
  function restoreFocus(): void {
    if (invoker?.isConnected) return; // the browser's own restore is correct
    const code = current?.code;
    const row = code
      ? document.querySelector<HTMLElement>(
          `#planner-course-rows .planner-course-open[data-code="${CSS.escape(code)}"]`,
        )
      : null;
    if (row) {
      row.focus();
      return;
    }
    const frame = document.getElementById("planner-grid-frame");
    if (!frame) return;
    // The frame is a plain <div>; it has to be programmatically focusable
    // before it can catch anything.
    frame.tabIndex = -1;
    frame.focus();
  }

  function lectureKeysOf(ctx: CourseSettingsContext): Set<string> {
    return new Set(ctx.groups.filter((g) => g.kind === "lecture").map((g) => g.key));
  }

  /** The lecture keys the week draws right now: the explicit pick, else the default. */
  function shownLectures(ctx: CourseSettingsContext): string[] {
    const keys = lectureKeysOf(ctx);
    const picked = selection.filter((k) => keys.has(k));
    return picked.length > 0 ? picked : ctx.defaults;
  }

  /**
   * Applies a new explicit selection: store first (the grid behind the
   * backdrop updates live), then this dialog's own display. `focusKey`
   * re-focuses the input for that group key after the rebuild, so toggling
   * with the keyboard doesn't drop focus back to the document.
   */
  function setSelection(next: string[], focusKey?: string): void {
    if (!current) return;
    selection = next;
    store.setCourseGroups(current.code, next);
    renderContent(current);
    if (focusKey) {
      dialog.querySelector<HTMLInputElement>(`input[value="${CSS.escape(focusKey)}"]`)?.focus();
    }
  }

  /** Lecture edit: exclusive (radio) or additive (checkbox) per `lecturesAreExclusive`. */
  function toggleLecture(ctx: CourseSettingsContext, key: string, checked: boolean): void {
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
   * lectures on their default (audit week-1/groups-1).
   */
  function toggleOther(ctx: CourseSettingsContext, key: string, checked: boolean): void {
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

  // --- Content -------------------------------------------------------------

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
   * An option that came from `ctx.defaults` is labelled "(din parallell)"
   * regardless of what is currently picked, so the student's assigned default
   * stays identifiable after they switch away from it; the label is dropped
   * when the caller says the default was only a guess (`resolved: false`),
   * since naming a provisional pick "din parallell" is a lie (groups-5).
   *
   * "Nullstill gruppevalg" calls `setSelection([])`, which `applyGroupSelection`
   * reads as "no explicit pick, apply the programme default" — the only way
   * back from a radio, which the student cannot untick (groups-6).
   */
  function renderGroupsSection(ctx: CourseSettingsContext): HTMLElement {
    const { lectures, others } = pickableGroups(ctx.groups);
    const exclusive = lecturesAreExclusive(ctx.defaults);
    const section = el("div", "course-settings-groups");
    section.append(el("p", "np-kicker", "Grupper"));

    const list = el("div", "course-settings-group-list");
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
      const row = el("label", "course-settings-group-row");
      const input = el("input");
      input.value = option.key;
      if (isLecture && exclusive) {
        input.type = "radio";
        input.name = "course-settings-lecture";
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
      const actions = el("div", "course-settings-group-actions");
      const reset = el("button", "np-btn course-settings-reset", "Nullstill gruppevalg");
      reset.type = "button";
      reset.addEventListener("click", () => {
        setSelection([]);
        // The reset renders only while there is something to reset, so it has
        // just removed itself from under the pointer/caret — hand focus to the
        // list it belongs to rather than dropping it on <body>.
        dialog.querySelector<HTMLInputElement>(".course-settings-group-row input")?.focus();
      });
      actions.append(reset);
      section.append(actions);
    }

    return section;
  }

  /**
   * Dropp/Legg tilbake mirrors PRODUCT.md §0.3's verbs; a manual add's is
   * "Fjern fra planen". This is the ONLY remove control now — D3 relaxed
   * §0.3's "one tap to restore" to two taps, so the course row no longer
   * carries one of its own.
   */
  function renderActions(ctx: CourseSettingsContext): HTMLElement {
    const row = el("div", "course-settings-actions");
    const isProgram = ctx.source === "program";
    const label = isProgram ? (ctx.dropped ? "Legg tilbake" : "Dropp") : "Fjern fra planen";

    const action = el("button", "np-btn course-settings-action", label);
    action.type = "button";
    action.setAttribute("aria-label", `${label} ${ctx.code}`);
    action.addEventListener("click", () => {
      if (isProgram) {
        if (ctx.dropped) store.restoreCourse(ctx.code);
        else store.dropCourse(ctx.code);
      } else {
        store.removeCourse(ctx.code);
      }
      // A removed course has no settings left to edit, and a dropped one has
      // no blocks in the week — either way this dialog is now about something
      // that is not on screen.
      close();
    });
    row.append(action);

    const link = el("a", "course-settings-link", "Gå til emnesiden");
    link.append(icon("arrowRight"));
    link.href = `/emne/${ctx.code}/`;
    row.append(link);

    return row;
  }

  function renderClose(): HTMLElement {
    const button = el("button", "np-icon-btn course-settings-close");
    button.append(icon("close"));
    button.type = "button";
    button.setAttribute("aria-label", "Lukk");
    button.addEventListener("click", close);
    return button;
  }

  function renderContent(ctx: CourseSettingsContext): void {
    dialog.replaceChildren();

    const head = el("div", "course-settings-head");
    const title = el("h2", "course-settings-title");
    title.id = "course-settings-title";
    title.append(dot(ctx.hueVar));
    title.append(el("span", "np-data course-settings-code", ctx.code));
    title.append(el("span", "course-settings-name", ctx.name));
    head.append(title, renderClose());
    dialog.append(head);

    const facts: string[] = [];
    if (ctx.credits != null) facts.push(`${formatCreditNumber(ctx.credits)} sp`);
    facts.push(ctx.source === "program" ? "fra programmet" : "lagt til selv");
    if (ctx.dropped) facts.push("droppet");
    dialog.append(el("p", "np-note course-settings-facts", facts.join(" · ")));

    // The status sentences the course row used to concatenate into one
    // run-on meta line (D2) — one line each, in `.np-hint` because they are
    // sentences with verbs, not mono fragments (DESIGN §3).
    for (const note of ctx.notes) {
      dialog.append(el("p", "np-hint course-settings-note", note));
    }
    if (ctx.onRetry) {
      const retry = el("button", "np-btn course-settings-retry", "Prøv igjen");
      retry.type = "button";
      retry.setAttribute("aria-label", `Prøv å hente ${ctx.code} på nytt`);
      const run = ctx.onRetry;
      retry.addEventListener("click", () => run());
      dialog.append(retry);
    }

    const { lectures, others } = pickableGroups(ctx.groups);
    if (lectures.length > 0 || others.length > 0) dialog.append(renderGroupsSection(ctx));
    dialog.append(renderActions(ctx));
  }

  dialog.addEventListener("close", () => {
    restoreFocus();
    current = null;
    selection = [];
    invoker = null;
  });
  signal.addEventListener("abort", () => dialog.remove());

  return {
    showFor(ctx: CourseSettingsContext): void {
      current = ctx;
      selection = [...ctx.selected];
      // Captured BEFORE `showModal()` moves focus into the dialog, so
      // `restoreFocus` can tell "the browser will handle this" from "the thing
      // that opened me no longer exists".
      invoker = (document.activeElement as HTMLElement | null) ?? null;
      renderContent(ctx);
      dialog.scrollTop = 0;
      if (!dialog.open) dialog.showModal();
    },
    currentCode: () => current?.code ?? null,
    close,
  };
}
