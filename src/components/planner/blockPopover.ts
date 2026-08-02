/**
 * The session popover — what a bar in the week says when you click it.
 *
 * A READ surface: the facts of the session you pointed at, anchored to it, with
 * a way through to the editor rather than being the editor. `show()`, not
 * `showModal()`, so the week stays visible and clicking another bar re-targets
 * the same dialog. A non-modal `<dialog>` gets no free dismissal — Esc and
 * backdrop are wired by hand below, and a real close button is always rendered
 * because neither gesture is visible.
 *
 * The head carries the bar's own printed fill with the code knocked out, so the
 * card is visibly the bar you pressed, and it names the session — code, course,
 * activity — because "which of this course's five sessions is this" is the one
 * thing the block itself has no width to say.
 *
 * Under it, LABELLED rows: Tid, Sted, and a Merk when there is something about
 * the session a clock cannot state. The clock is no longer the card's largest
 * figure — in a grid the time is already drawn, since it IS the block's place
 * in the week you just clicked. A collision gets a sentence, or pressing the
 * red bar answers every question except the one the red raised. The button is a
 * verb that names its outcome (DESIGN §8).
 *
 * Deliberately **no tail** pointing at the bar: the frame clips its own
 * corners, the card flips above the anchor and becomes a bottom sheet under
 * 60rem, and a pointer that has to be right in three layouts is the accessory
 * to leave off.
 */
import { dayName, el, icon } from "./dom.js";
import { type BlockClash, type BlockDetail, isDropIn } from "./grid.js";

/** Desktop breakpoint — matches the stylesheet's own bottom-sheet cutoff. */
const DESKTOP_QUERY = "(min-width: 60rem)";
/** Gap (px) kept between the card and the anchor bar / viewport edge. */
const ANCHOR_MARGIN = 8;

/**
 * What the editor behind the button can change for the layer the clicked
 * session belongs to: lecture parallels, øving/lab groups, or — when the layer
 * offers no choice — the course itself.
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
   * the drawn parallel is not a guess. Only ever says anything on a lecture.
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
 * How long the session runs, as a sentence fragment: "1 t 45 min", "3 t".
 * Empty for a zero-length or reversed pair — "0 min" beside a real clock reads
 * as a fact.
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
 * collision covering the whole session would print the clock the card already
 * set at 1.6rem two lines above.
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
 * Mounts the popover once. Idempotent against a stale dialog and self-removes
 * on `signal` abort. `onOpenSettings` is the way out to the editor: the popover
 * answers "what is this", the modal answers "change it".
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

  /**
   * Tabbing off the end of a NON-MODAL dialog walks straight out of it — into
   * the document behind, which for this one meant landing on the skip link at
   * the very top of the page with an open popover still painted over the week.
   *
   * Closing rather than trapping: a trap is what the three modals do because
   * they are modal, and building one here would make a surface that is
   * deliberately not modal behave as if it were. A popover you have tabbed out
   * of is a popover you are done with — which is already how a click elsewhere
   * treats it.
   */
  dialog.addEventListener("focusout", (event) => {
    if (!dialog.open) return;
    const next = (event as FocusEvent).relatedTarget as Node | null;
    if (next !== null) {
      if (!dialog.contains(next)) close();
      return;
    }
    // `relatedTarget: null` is TWO different things, and reading it as one is
    // what made the first version of this handler inert: focus really leaving
    // the document (a tab switch, devtools — the popover should survive that
    // and still be there on the way back), and focus landing on `BODY`, which
    // is what Chromium reports when you Tab off the last control of a
    // NON-MODAL dialog. Measured: last control → BODY → skip link → brand,
    // with the popover still painted over the week the whole way.
    //
    // `document.activeElement` tells them apart on its own, once the focus move
    // has settled — hence the next frame. Tabbing off the end moves it to
    // `body`, which the dialog does not contain; a window or tab losing focus
    // LEAVES it on whatever was focused inside the dialog, which the dialog
    // does contain. No `document.hasFocus()`: it answers false in a headless
    // browser whatever the page is doing, so a guard built on it never fires
    // in the one place this behaviour can be tested.
    requestAnimationFrame(() => {
      if (!dialog.open) return;
      if (!dialog.contains(document.activeElement)) close();
    });
  });

  function render(ctx: BlockPopoverContext): void {
    dialog.replaceChildren();
    const { detail } = ctx;
    // The head's fill is the bar's fill, so it follows the same reduced branch
    // an øving/lab bar takes rather than printing a lecture-strength colour.
    dialog.style.setProperty("--dot", `var(${ctx.hueVar})`);

    const head = el("div", "np-head block-popover-head");
    head.append(el("span", "np-head-swatch"));
    const ident = el("div", "np-head-ident");
    // THE CODE AND THE NAME AS ONE TITLE, with the ACTIVITY under it. The name
    // used to be the second line, which spent it saying what the course rail
    // three inches away already says — while the one fact that separates this
    // card from the other four this course opens, "which session is this", was
    // buried in the facts below.
    const title = el("h3", "np-head-title block-popover-code np-data", detail.code);
    title.id = "block-popover-title";
    if (ctx.courseName) title.append(el("span", "block-popover-course", ctx.courseName));
    ident.append(title);
    if (detail.entryName) ident.append(el("p", "np-head-sub", detail.entryName));
    head.append(ident);

    const closeBtn = el("button", "np-icon-btn block-popover-close");
    closeBtn.append(icon("close"));
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Lukk");
    closeBtn.addEventListener("click", close);
    head.append(closeBtn);
    dialog.append(head);

    const body = el("div", "block-popover-body");

    // LABELLED ROWS. The card answers two questions — when, and where — and a
    // stack of unlabelled facts made the reader work out which was which from
    // the shape of the string. "R8" and "Forelesning 2" are both short lines of
    // text; only a label tells you one is a place.
    //
    // The clock is no longer one large figure: it was the card's loudest thing
    // in a view where the time is ALREADY drawn — it is the block's own place
    // in the grid you just clicked.
    const facts = el("dl", "block-popover-facts");
    const row = (label: string, value: Node | string, sub?: Node | string | null): void => {
      const wrap = el("div", "block-popover-row");
      wrap.append(el("dt", undefined, label));
      const dd = el("dd");
      dd.append(value);
      // `append(node)`, never `el("small", …, node)`: the third argument of `el`
      // is TEXT and assigning an element to it stringifies the element.
      if (sub) {
        const small = el("small");
        small.append(sub);
        dd.append(small);
      }
      wrap.append(dd);
      facts.append(wrap);
    };

    const when = el("span", "block-popover-when");
    when.append(`${dayName(detail.dayNumber)} `);
    when.append(el("span", "block-popover-clock np-data", `${detail.startTime}–${detail.endTime}`));
    const meta = el("span", "block-popover-meta");
    const duration = durationLabel(detail.startTime, detail.endTime);
    if (duration) meta.append(el("span", "np-data", duration));
    if (detail.weeksLabel) {
      if (duration) meta.append(" · ");
      meta.append(el("span", "np-data", detail.weeksLabel));
    }
    row("Tid", when, meta.childElementCount > 0 ? meta : null);

    if (detail.rooms) {
      row("Sted", el("span", "np-data", detail.rooms), detail.buildings ? detail.buildings : null);
    }

    // The one thing about this session a clock cannot say: you do not have to
    // be there at any particular minute of it.
    if (isDropIn(detail)) {
      row("Merk", "Åpent vindu — du kan stikke innom når du vil.");
    } else if (detail.isLecture && ctx.lectureAlternatives > 1) {
      row("Merk", `Én av ${ctx.lectureAlternatives} alternative forelesninger.`);
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
    // another can run it AFTER `showFor` re-targeted the dialog, which would
    // steal focus back from the bar being opened.
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
