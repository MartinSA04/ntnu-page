/**
 * Backdrop dismissal for a modal `<dialog>`, decided on the CLICK.
 *
 * WHY NOT `closedby="any"`, which is the platform's own answer to this and was
 * what these dialogs used. Two reasons, and the second is what forced it.
 *
 * 1. **It is not in Safari.** `closedby` is Chrome 134+ and Firefox 141+; on
 *    Safari and iOS it is still "preview" (MDN browser-compat-data, checked
 *    2026-08-04). So on an iPhone the attribute did nothing at all and these
 *    modals could not be dismissed by tapping outside them.
 *
 * 2. **Light dismiss closes at `pointerup`, and a touch's click arrives after
 *    that.** The algorithm is shared by popovers and dialogs: the `pointerdown`
 *    target is recorded, `pointerup` compares it, and the surface closes there.
 *    But a touch produces no click of its own — the browser synthesises
 *    `mousedown`/`mouseup`/`click` after `touchend`, i.e. after `pointerup`. The
 *    dialog is therefore already closed when its own dismissing click is
 *    dispatched, and the browser hit-tests that click against the page the
 *    dialog was covering: one tap dismissed the modal AND pressed the control
 *    behind it. Verified in Chrome 149 for `closedby="any"`, and for
 *    `popover=auto`, which leaks with a mouse too — it has nothing inert to
 *    retarget through.
 *
 * The click is the LAST event of the gesture, so a dismissal decided there has
 * nothing trailing it to leak. `closedby` stays on as `"closerequest"`, which is
 * the half with no defect: Esc and the close watcher (Android's back gesture)
 * remain the platform's.
 *
 * **The drag is why this is not the one-liner.** `event.target === dialog` on
 * its own — the idiom every recipe prints — closes on a text selection that
 * started inside the card and was released on the backdrop, because the click's
 * target is then the common ancestor, which is the dialog. Native light dismiss
 * gets that right by requiring `pointerdown` and `pointerup` to agree, so this
 * requires the same thing: the gesture must BEGIN on the backdrop as well as end
 * there. Deciding at the click is what keeps both properties at once.
 *
 * Two smaller guards. The pointer is tested against the dialog's box, not only
 * its identity, because a click on the dialog's own padding also targets the
 * dialog. And `detail === 0` is a click with no pointer behind it (Enter on a
 * focused element), whose coordinates are 0,0 and would read as the backdrop's
 * top-left corner.
 */

/** Is this pointer position outside the dialog's own box, i.e. on the backdrop? */
function onBackdrop(dialog: HTMLDialogElement, event: MouseEvent | PointerEvent): boolean {
  if (event.target !== dialog) return false;
  const box = dialog.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
}

export function dismissOnBackdropClick(dialog: HTMLDialogElement, signal: AbortSignal): void {
  /** Did the gesture in flight START on the backdrop? */
  let startedOutside = false;

  dialog.addEventListener(
    "pointerdown",
    (event) => {
      startedOutside = onBackdrop(dialog, event);
    },
    { signal },
  );

  dialog.addEventListener(
    "click",
    (event) => {
      const dismiss = startedOutside && event.detail !== 0 && onBackdrop(dialog, event);
      startedOutside = false;
      if (dismiss) dialog.close();
    },
    { signal },
  );
}
