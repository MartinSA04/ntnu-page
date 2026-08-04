/**
 * Studieinfo — programme, kull, studieretning — as the planner's own dialog.
 *
 * It was a SECTION of the profile panel, which the topbar opens from every
 * page. That put the picker behind the account's door on all four surfaces;
 * this puts it behind the plan's own name, on the one surface the plan lives
 * on. The account keeps the topbar, because sign-in governs `np:plans`
 * synchronisation and is genuinely site-wide — a programme is a fact about the
 * plan you are building here, and the two were only ever together because both
 * were "about the student".
 *
 * The section itself is unchanged and unmoved: `buildStudieinfoSection` already
 * returns a self-contained handle, so this file is only the room it stands in.
 * Same modal pattern as `courseSettings.ts` — built with `el`, `showModal()`,
 * `dismissOnBackdropClick`, appended to `document.body`, idempotent against a
 * stale dialog left by a previous mount.
 *
 * Built ONCE per mount rather than per open: the section stages edits and holds
 * two in-flight study-plan fetch tokens, so rebuilding it on every open would
 * throw away a half-picked programme. `reset()` on open is what discards one
 * deliberately.
 */
import { dismissOnBackdropClick } from "../../lib/dialogDismiss.js";
import type { PlanStore } from "../../lib/planner/store.js";
import { el, icon } from "./dom.js";
import { buildStudieinfoSection, type StudieinfoSectionHandle } from "./studieinfo.js";

/** Which control the caller sent the student here to answer. */
export type StudieinfoFocus = "program" | "direction";

export interface StudieinfoDialogHandle {
  open(focus?: StudieinfoFocus): void;
  close(): void;
  /**
   * Takes the dialog out of the document, section and all.
   *
   * The planner calls this when it goes BACK to first run, because the screen
   * it is about to build hosts a second `buildStudieinfoSection` and the unit
   * hard-codes its ids. Rebuilding on the next `open()` is cheap; two live
   * copies are not recoverable.
   */
  destroy(): void;
}

export function mountStudieinfoDialog(
  store: PlanStore,
  signal: AbortSignal,
): StudieinfoDialogHandle {
  document.getElementById("planner-studieinfo")?.remove();

  const dialog = el("dialog", "np-frame studieinfo-dialog");
  dialog.id = "planner-studieinfo";
  dialog.setAttribute("aria-labelledby", "studieinfo-dialog-title");
  // Light dismiss: Esc and a backdrop click. Nothing is written until Lagre, so
  // a stray click discards a half-picked programme rather than committing one —
  // the same contract the section had inside the profile panel.
  dialog.setAttribute("closedby", "closerequest");
  dismissOnBackdropClick(dialog, signal);
  document.body.append(dialog);

  function close(): void {
    if (dialog.open) dialog.close();
  }

  const section: StudieinfoSectionHandle = buildStudieinfoSection({
    store,
    // The dialog edits a plan that already exists: nothing is written until
    // Lagre, so the light dismiss above discards a half-picked programme
    // rather than committing one.
    commit: "explicit",
    // A saved studieinfo is a finished errand: the week behind the dialog has
    // already redrawn, so staying open would leave the student looking at the
    // form they just submitted instead of at the answer.
    onSaved: () => close(),
  });

  const head = el("div", "np-head studieinfo-dialog-head");
  const ident = el("div", "np-head-ident");
  const title = el("h2", "np-head-title", "Studieprogram");
  title.id = "studieinfo-dialog-title";
  ident.append(title);
  const closeBtn = el("button", "np-icon-btn studieinfo-dialog-close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Lukk");
  closeBtn.append(icon("close"));
  closeBtn.addEventListener("click", close, { signal });
  head.append(ident, closeBtn);

  const body = el("div", "studieinfo-dialog-body");
  body.append(section.element);
  dialog.append(head, body);

  signal.addEventListener("abort", () => dialog.remove());

  return {
    destroy(): void {
      close();
      dialog.remove();
    },
    open(focus?: StudieinfoFocus): void {
      // Re-staged from the store on every open, so a programme abandoned last
      // time is gone rather than resurrected.
      section.reset();
      dialog.scrollTop = 0;
      if (!dialog.open) dialog.showModal();
      // The caller sent the student here to answer one question; put the caret
      // on the control that answers it.
      if (focus === "direction") section.focusDirection();
      else if (focus === "program") section.focusProgram();
    },
    close,
  };
}
