/**
 * The session popover — what a bar in the week says when you click it
 * (REWORK-2026-07-29f, retypeset 2026-07-30 "Kvittering").
 *
 * It is a READ surface: the facts of the one session you pointed at, anchored
 * to it, with a way through to the editor rather than being the editor.
 * `show()`, not `showModal()`, so the week stays visible and clicking a different
 * bar just re-targets the same dialog.
 *
 * A non-modal `<dialog>` gets no free dismissal: no Esc, no backdrop. Both are
 * wired by hand at the bottom of this file, and because neither is visible —
 * least of all in the bottom-sheet layout below 60rem, where "outside" is a
 * sliver of screen — a real close button is always rendered.
 *
 * **What the retypesetting changed, and why each half of it exists.** The card
 * used to be a neutral panel with a square hue dot and a `NÅR / ROM / HVA /
 * UKER` label column: four uppercase mono labels spending a third of a 20 rem
 * card to name facts that say what they are. Now:
 *
 *  - The head carries the bar's own printed fill with the code knocked out of
 *    it, so the card is visibly the bar you pressed rather than a panel that
 *    happens to mention its code. The hue never colours text (DESIGN §8); it
 *    is a fill with `--on-block` on top, exactly as `.planner-block` does it.
 *  - The clock is the card's largest figure, because it is the fact a student
 *    copies into a calendar; the weekday, the duration and the weeks read as
 *    one quiet line under it.
 *  - The room names its building. `roomLabel` throws it away for the bar,
 *    which has no width for it, but "F1" alone is not a place you can walk
 *    to, and the card has the room for "IT-bygget, sydfløy".
 *  - A collision gets a sentence (`.np-note-clash`). The week draws the red
 *    zone and the margin names the pair; the card in between used to say
 *    nothing, so pressing the red bar answered every question except the one
 *    the red raised.
 *  - A lecture drawn on an unresolved guess says so, in the same words the
 *    margin note uses ("N alternative forelesninger"), instead of printing the
 *    provisional parallel as though it had been chosen.
 *  - The button is a verb that names its outcome (DESIGN §7): "Velg parallell"
 *    / "Velg gruppe" / "Endre emnet", not "Innstillinger".
 *
 * There is deliberately **no tail** pointing at the bar. `.np-frame` clips its
 * own corners (`overflow: hidden`), the card flips above the anchor when there
 * is no room below and becomes a bottom sheet under 60rem. A pointer that has
 * to be right in three layouts, on top of a head that already carries the
 * bar's colour, is the accessory to leave off.
 */
import { dayName, el, icon } from "./dom.js";
import type { BlockClash, BlockDetail } from "./grid.js";

/** Desktop breakpoint — matches the stylesheet's own bottom-sheet cutoff. */
const DESKTOP_QUERY = "(min-width: 60rem)";
/** Gap (px) kept between the card and the anchor bar / viewport edge. */
const ANCHOR_MARGIN = 8;

/**
 * What the editor behind the button can change for the layer the clicked
 * session belongs to: this course's lecture parallels, its øving/lab groups,
 * or, when the layer offers no choice at all, the course itself.
 */
export type SessionChoice = "parallel" | "group" | "course";

export interface BlockPopoverContext {
  detail: BlockDetail;
  /** `--hue-*` custom property name: the head's printed fill. */
  hueVar: string;
  /** The course's proper name, when the bar knows it. */
  courseName: string;
  choice: SessionChoice;
  /**
   * How many alternative lectures the week is drawing ONE of, unasked. 0 when
   * the drawn parallel is not a guess (`unresolvedLectureChoices`). Only ever
   * says anything on a lecture bar.
   */
  lectureAlternatives: number;
}

export interface BlockPopoverHandle {
  showFor(ctx: BlockPopoverContext, anchor: HTMLElement): void;
  close(): void;
}

const toMinutes = (time: string): number => {
  const [h = "0", m = "0"] = time.split(":");
  return Number(h) * 60 + Number(m);
};

/**
 * How long the session runs, as a sentence fragment: "1 t 45 min", "3 t",
 * "45 min". Empty for a zero-length or reversed pair, which is upstream
 * nonsense, and
 * "0 min" printed beside a real clock reads as a fact.
 */
export function durationLabel(startTime: string, endTime: string): string {
  const total = toMinutes(endTime) - toMinutes(startTime);
  if (total <= 0) return "";
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} t` : `${hours} t ${minutes} min`;
}

/**
 * The shared minutes, when they are not simply the session's own slot. A
 * collision that covers the whole session would otherwise print the clock the
 * card has already set at 1.6rem two lines above.
 */
export function clashClock(
  session: { startTime: string; endTime: string },
  clash: BlockClash,
): string {
  if (clash.startTime === session.startTime && clash.endTime === session.endTime) return "";
  return `${clash.startTime}–${clash.endTime}`;
}

/** The button's label: a verb naming what pressing it lets you change. */
export function editVerb(choice: SessionChoice): string {
  if (choice === "parallel") return "Velg parallell";
  if (choice === "group") return "Velg gruppe";
  return "Endre emnet";
}

/** "A, B og C": the Norwegian list separator, as separators between spans. */
function codeList(codes: string[]): (HTMLElement | string)[] {
  const parts: (HTMLElement | string)[] = [];
  codes.forEach((code, index) => {
    if (index > 0) parts.push(index === codes.length - 1 ? " og " : ", ");
    parts.push(el("span", "np-data", code));
  });
  return parts;
}

/**
 * Mounts the popover once. Idempotent against a stale dialog left by a
 * previous mount and self-removes on `signal` abort (a page swap under
 * ClientRouter) — the same idiom as the other surfaces here.
 *
 * `onOpenSettings` is the way out to the editor: the popover answers "what is
 * this", the modal answers "change it", and one verb joins them.
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
    // The head's fill is the bar's fill, so it follows the same reduced branch
    // a øving/lab bar takes (`.planner-block.is-muted`) rather than printing a
    // lecture-strength colour over a reduced one.
    dialog.style.setProperty("--dot", `var(${ctx.hueVar})`);

    const head = el(
      "div",
      `np-head ${detail.isLecture ? "np-head--printed" : "np-head--reduced"} block-popover-head`,
    );
    const ident = el("div", "np-head-ident");
    const title = el("h3", "np-head-title block-popover-code np-data", detail.code);
    title.id = "block-popover-title";
    ident.append(title);
    if (ctx.courseName) ident.append(el("p", "np-head-sub", ctx.courseName));
    head.append(ident);

    const closeBtn = el("button", "np-icon-btn block-popover-close");
    closeBtn.append(icon("close"));
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Lukk");
    closeBtn.addEventListener("click", close);
    head.append(closeBtn);
    dialog.append(head);

    const body = el("div", "block-popover-body");

    const when = el("p", "block-popover-when");
    when.append(el("span", "block-popover-clock np-data", `${detail.startTime}–${detail.endTime}`));
    const meta = el("span", "block-popover-meta");
    meta.append(dayName(detail.dayNumber));
    const duration = durationLabel(detail.startTime, detail.endTime);
    if (duration) {
      meta.append(" · ");
      meta.append(el("span", "np-data", duration));
    }
    if (detail.weeksLabel) {
      meta.append(" · ");
      meta.append(el("span", "np-data", detail.weeksLabel));
    }
    when.append(meta);
    body.append(when);

    // Room and activity, each as its own fact with its own second line: the
    // building under the room, the guess under the parallel. No label column:
    // a room code and an activity name do not need to be told apart.
    const facts = el("div", "block-popover-facts");
    if (detail.rooms) {
      const fact = el("div", "np-fact");
      fact.append(el("p", "np-fact-value np-data", detail.rooms));
      if (detail.buildings) fact.append(el("p", "np-fact-sub", detail.buildings));
      facts.append(fact);
    }
    if (detail.entryName) {
      const fact = el("div", "np-fact");
      fact.append(el("p", "np-fact-value", detail.entryName));
      if (detail.isLecture && ctx.lectureAlternatives > 1) {
        fact.append(
          el("p", "np-fact-sub", `Én av ${ctx.lectureAlternatives} alternative forelesninger.`),
        );
      }
      facts.append(fact);
    }
    if (facts.childElementCount > 0) body.append(facts);

    if (detail.clash) {
      // Red-Is-Collision: the sentence names both things that cannot coexist.
      const say = el("p", "np-note-clash block-popover-clash");
      say.append("Kolliderer med ");
      for (const part of codeList(detail.clash.partners)) say.append(part);
      const clock = clashClock(detail, detail.clash);
      if (clock) {
        say.append(" ");
        say.append(el("span", "np-data", clock));
      }
      say.append(".");
      body.append(say);
    }

    const actions = el("div", "np-actions np-actions--split block-popover-actions");
    const edit = el("button", "np-btn block-popover-edit", editVerb(ctx.choice));
    edit.type = "button";
    edit.setAttribute("aria-label", `${editVerb(ctx.choice)} for ${detail.code}`);
    edit.addEventListener("click", () => {
      close();
      onOpenSettings(detail.code);
    });
    actions.append(edit);

    const link = el("a", "np-link-out", "Gå til emnesiden");
    link.append(icon("arrowRight"));
    link.href = `/emne/${detail.code}/`;
    actions.append(link);
    body.append(actions);

    dialog.append(body);
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
