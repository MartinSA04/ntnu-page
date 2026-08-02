/**
 * Course settings — the ONE surface a planned course is configured on. Two
 * callers hand it the same context: a course row in the Emner list, and a
 * block in the week/day grid.
 *
 * A real modal (`showModal()`), so Esc, backdrop dismissal (`closedby="any"`)
 * and focus return to the invoker are native behaviour, and the grid
 * re-rendering underneath cannot knock it out of position.
 *
 * `setCourseGroups` writes on every edit, so the grid behind the backdrop is
 * already correct when the modal closes; `renderContent` is a full idempotent
 * rebuild driven by the local `selection`.
 *
 * `lecturesAreExclusive` and `nextSelection` have twice deleted real teaching
 * from a student's week, so they stay pure and stay tested.
 */
import type { GroupOption } from "../../lib/planner/groups.js";
import type { CourseSource, PlanStore } from "../../lib/planner/store.js";
import { el, formatCreditNumber, icon } from "./dom.js";

/** What the caller hands the modal. A pile does not open this surface — it
 *  focuses its day. */
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
   * before the student picks. Its LENGTH decides radios vs checkboxes.
   */
  defaults: string[];
  /**
   * `resolveLectureDefaults(...).resolved`: `false` when `defaults` is one
   * provisional pick per ambiguous family, in which case no option may be
   * labelled "(din parallell)".
   */
  resolved?: boolean;
  /**
   * The lecture keys the week is drawing right now — read off
   * `applyGroupSelection`'s output, NOT off `defaults`. `defaults` is empty
   * both for a course whose every option is already on screen and for one
   * whose other parallels are another programme's; only the first has nothing
   * to pick. See `pickableGroups`.
   */
  drawnLectures: string[];
  /**
   * The plan's programme code, so the picker can find the student in its own
   * list. NTNU titles a split lecture with the programmes it is for
   * ("Forelesning 1 MTDT, MTIØT, MTKOM"), and TMA4400 publishes seventeen such
   * rows — twelve parallels, Plenumsregning and five Mattelab groups — flat,
   * unsorted and unmarked. The app knew the student was MTDT the whole time
   * and made them read for it.
   */
  programCode?: string | null;
  source: CourseSource;
  dropped: boolean;
  /**
   * Status fragments the course row used to run together — "undervises ikke i
   * valgt semester", "fikk ikke hentet timeplanen". One note per entry.
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
 * The fact block under the head: the figure the course is measured in and the
 * line that qualifies it — the same shape the session card sets a clock in.
 *
 * With no credits to state `figure` stays null and the provenance takes the
 * block on its own, as a grotesk sentence fragment, never promoted into the
 * mono the figure is set in (Data-Is-Mono).
 */
export function courseFacts(ctx: {
  credits: number | null;
  source: CourseSource;
  dropped: boolean;
}): { figure: string | null; provenance: string } {
  return {
    figure: ctx.credits == null ? null : `${formatCreditNumber(ctx.credits)} sp`,
    provenance: ctx.dropped
      ? "Droppet, ikke med i uka eller i sp"
      : ctx.source === "program"
        ? "Fra programmet"
        : "Lagt til selv",
  };
}

/**
 * Are this course's lecture options alternatives to each other? `defaults`
 * (`resolveLectureDefaults(...).keys`) answers it by length:
 *  - one key — the layer was narrowed to one group, so every other option is
 *    an alternative: a radio, and picking one replaces the layer.
 *  - no keys — nothing was narrowed. The listed groups are complementary
 *    weekly sessions or other programmes' sections; calling those alternatives
 *    is what deleted two thirds of a course.
 *  - several keys — one provisional pick per session family, which a single
 *    radio group cannot express either.
 * The last two are additive checkboxes: an allow-list, exactly what
 * `applyGroupSelection` does with an explicit pick.
 */
export function lecturesAreExclusive(defaults: string[]): boolean {
  return defaults.length === 1;
}

/**
 * The selection to store after the student toggles one option — the whole write
 * path, kept pure so the half that has twice deleted real teaching from the
 * week is unit-testable without a DOM.
 *
 * `layerKeys` holds the keys of the layer being edited; the other layer's picks
 * carry through untouched, because groups.ts applies a selection per activity
 * kind. `shown` is what that layer draws right now, so an additive edit starts
 * from what the student can see. `exclusive` is the radio case. Emptying a
 * layer returns it to the default — the way back out of a wrong pick.
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
 * Does a group's own label name this programme?
 *
 * NTNU titles a split lecture with the programmes it serves — "Forelesning 1
 * MTDT, MTIØT, MTKOM" — so the student's row is findable, and the picker was
 * making them find it by eye among seventeen.
 *
 * Whole-token match, never `includes`: programme codes nest ("MTDT" sits
 * inside no real code, but "BAT" is inside "BATEK" and "MIBIOT5" inside
 * nothing you can rely on), and marking the wrong row is worse than marking
 * none — it would send a student to another programme's lecture with our
 * label on it. The separators are what upstream actually uses: commas,
 * slashes, ampersands, spaces. Æ/Ø/Å are letters here, so `\b` is no good.
 */
export function namesProgramme(label: string, programCode: string | null | undefined): boolean {
  const code = programCode?.trim().toUpperCase();
  if (!code) return false;
  return label
    .toUpperCase()
    .split(/[^0-9A-ZÆØÅ]+/)
    .includes(code);
}

/**
 * Which options are worth offering. A control that cannot make a different
 * choice is noise. The two kinds are counted SEPARATELY, or a course with one
 * parallel and two øving groups draws a lone dead radio above the checkboxes.
 *
 * `drawn` is the second half of the lecture gate: **a lecture layer whose every
 * option is already on screen is not a choice, however many options that is.**
 * TMA4401's two complementary lecture-classified sessions were offered as
 * checkboxes, inviting the student to untick teaching they attend. Counting
 * alone cannot tell that from TMA4400, which also narrows nothing but lists
 * eight parallels the week is NOT drawing, one of which a student may
 * legitimately want — so the gate cannot be `defaults.length > 0`.
 *
 * The øving/lab layer is deliberately not held to this test: its default IS
 * "every group of your programme", so `drawn` covers all of them and the rule
 * would delete every øving picker on the site.
 */
export function pickableGroups(
  groups: GroupOption[],
  drawn: string[],
): {
  lectures: GroupOption[];
  others: GroupOption[];
} {
  const lectures = groups.filter((g) => g.kind === "lecture");
  const others = groups.filter((g) => g.kind !== "lecture");
  const switchable = lectures.some((g) => !drawn.includes(g.key));
  return {
    lectures: lectures.length > 1 && switchable ? lectures : [],
    others: others.length > 1 ? others : [],
  };
}

/**
 * Mounts the modal once. Idempotent against a stale dialog left by a previous
 * mount, and self-removes on `signal` abort (a page swap under ClientRouter).
 */
export function mountCourseSettings(store: PlanStore, signal: AbortSignal): CourseSettingsHandle {
  document.getElementById("planner-course-settings")?.remove();

  const dialog = el("dialog", "np-frame course-settings");
  dialog.id = "planner-course-settings";
  dialog.setAttribute("aria-labelledby", "course-settings-title");
  // Light dismiss: Esc *and* a backdrop click. Every edit here is written to
  // the store as it is made, so a stray click throws nothing away — the ×
  // stays for touch, where neither gesture exists.
  dialog.setAttribute("closedby", "any");
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
   * `showModal()` returns focus to the invoker for free — but ONLY while it is
   * still in the document, and Dropp/Fjern is exactly when it is not: `focus()`
   * on a detached node is a silent no-op that leaves focus on `<body>`, so the
   * next Tab restarts at the skip link.
   *
   * The course's settings BUTTON in the Emner list is the honest landing place
   * — that row still shows the course and the button reopens this dialog. The
   * button, not the row: the row is inert and would be the same no-op. The week
   * frame is the last resort when the row is gone too.
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
    // The frame is a plain <div>; it must be programmatically focusable first.
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
   * Applies a new explicit selection: store first (the grid behind the backdrop
   * updates live), then this dialog. `focusKey` re-focuses that group's input
   * after the rebuild, so keyboard toggling does not drop focus.
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
   * per activity kind, so this leaves the lectures on their default.
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
   * One control per option — in `ctx.groups`'s own order, minus whichever kind
   * has nothing to choose between (`pickableGroups`). Øving/lab options are
   * always checkboxes; the lecture layer gets radios only when its options
   * really are alternatives (`lecturesAreExclusive`), because a radio group
   * promises that picking one turns the others off — true for three parallels,
   * false and destructive for three complementary weekly sessions.
   *
   * An option from `ctx.defaults` is labelled "(din parallell)" whatever is
   * picked, so the assigned default stays identifiable — dropped when the
   * caller says the default was only a guess (`resolved: false`).
   *
   * "Nullstill gruppevalg" calls `setSelection([])`, which reads as "apply the
   * programme default" — the only way back from a radio, which cannot be
   * unticked.
   */
  function renderGroupsSection(ctx: CourseSettingsContext): HTMLElement {
    const { lectures, others } = pickableGroups(ctx.groups, ctx.drawnLectures);
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

    // The student's own row first, and said so. Everything below is unchanged
    // in content — no option is hidden, and a parallel tagged for another
    // programme stays pickable, which is a documented capability.
    const mine = (option: GroupOption): boolean => namesProgramme(option.label, ctx.programCode);
    const byOwn = (a: GroupOption, b: GroupOption): number => Number(mine(b)) - Number(mine(a));
    const ordered: [heading: string, options: GroupOption[]][] = [
      ["Forelesning", [...lectures].sort(byOwn)],
      ["Øving og lab", [...others].sort(byOwn)],
    ];

    for (const [heading, options] of ordered) {
      if (options.length === 0) continue;
      // A heading only when there are two kinds to tell apart. One list of
      // øving groups does not need to be told it is a list of øving groups.
      if (lectures.length > 0 && others.length > 0) {
        list.append(el("p", "np-note course-settings-group-heading", heading));
      }
      for (const option of options) buildRow(option);
    }

    function buildRow(option: GroupOption): void {
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
      const label = el("span", undefined, option.label);
      // Two different claims, and only one of them was ever made. "(din
      // parallell)" says WE PICKED THIS FOR YOU, and is suppressed exactly when
      // the pick was a guess (`resolved: false`) — which is the ambiguous
      // multi-programme case, i.e. the seventeen-row list where the student
      // most needs help. "ditt program" says something weaker and always true:
      // this row names your programme. It is available in the case the other
      // one is not, which is the point.
      if (isDefault) label.append(" (din parallell)");
      else if (mine(option)) label.append(el("span", "course-settings-group-own", "ditt program"));
      row.append(label);
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
        // just removed itself from under the pointer — hand focus to the list.
        dialog.querySelector<HTMLInputElement>(".course-settings-group-row input")?.focus();
      });
      actions.append(reset);
      section.append(actions);
    }

    return section;
  }

  /**
   * Dropp/Legg tilbake mirrors PRODUCT.md §0.3's verbs; a manual add's is
   * "Fjern fra planen". This is the ONLY remove control — the course row
   * carries none of its own.
   */
  function renderActions(ctx: CourseSettingsContext): HTMLElement {
    const row = el("div", "np-actions np-actions--split course-settings-actions");
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
      // A removed course has no settings left to edit and a dropped one has no
      // blocks in the week — either way this dialog is about something that is
      // no longer on screen.
      close();
    });
    row.append(action);

    const link = el("a", "np-link-out", "Gå til emnesiden");
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

  /**
   * The same masthead the session card opens on: the course's swatch, its code,
   * its name on the quiet line under it. A student reaches this modal FROM that
   * card, so the two have to be visibly one object — which is what the shared
   * `.np-head` buys, and it no longer costs a full-bleed band of colour to do
   * it (see `.np-head-swatch`).
   */
  function renderHead(ctx: CourseSettingsContext): HTMLElement {
    const head = el("div", "np-head course-settings-head");
    head.style.setProperty("--dot", `var(${ctx.hueVar})`);
    head.append(el("span", "np-head-swatch"));
    const ident = el("div", "np-head-ident");
    const title = el("h2", "np-head-title np-data course-settings-code", ctx.code);
    title.id = "course-settings-title";
    ident.append(title);
    if (ctx.name) ident.append(el("p", "np-head-sub", ctx.name));
    head.append(ident, renderClose());
    return head;
  }

  function renderContent(ctx: CourseSettingsContext): void {
    dialog.replaceChildren();
    dialog.append(renderHead(ctx));

    const body = el("div", "course-settings-body");

    // The figure the course is measured in, and the line that qualifies it.
    const { figure, provenance } = courseFacts(ctx);
    const facts = el("div", "np-fact course-settings-facts");
    if (figure) {
      facts.append(el("p", "np-fact-value np-data", figure));
      facts.append(el("p", "np-fact-sub", provenance));
    } else {
      facts.append(el("p", "np-fact-value", provenance));
    }
    body.append(facts);

    // The status sentences, one line each, in `.np-hint` because they are
    // sentences with verbs, not mono fragments (DESIGN §3).
    for (const note of ctx.notes) {
      body.append(el("p", "np-hint course-settings-note", note));
    }
    if (ctx.onRetry) {
      const retry = el("button", "np-btn course-settings-retry", "Prøv igjen");
      retry.type = "button";
      retry.setAttribute("aria-label", `Prøv å hente ${ctx.code} på nytt`);
      const run = ctx.onRetry;
      retry.addEventListener("click", () => run());
      body.append(retry);
    }

    const { lectures, others } = pickableGroups(ctx.groups, ctx.drawnLectures);
    if (lectures.length > 0 || others.length > 0) body.append(renderGroupsSection(ctx));
    body.append(renderActions(ctx));
    dialog.append(body);
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
