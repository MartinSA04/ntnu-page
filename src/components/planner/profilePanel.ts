/**
 * The profile panel — the ONE surface the opt-in account lives on: the
 * programme/kull summary a student already set in studieinfo, signup/login,
 * and (today) this device's own sync line. It is reached from one control
 * ("Profil", in the planner's title block) and nothing else nags about it —
 * the account is strictly opt-in and never a prerequisite for using the
 * planner (see the plan's product framing).
 *
 * Two states, switched on `sync.session()`:
 *  - signed out — programme block, Navn/PIN/Gjenta PIN, the two terms lines,
 *    Opprett konto / Logg inn.
 *  - signed in — programme block, "Sist synkronisert …", this device's own
 *    row, Logg ut på denne enheten.
 *
 * There is no *device list* here yet in the plural sense the name suggests:
 * `SyncSession` (Task 6) carries only this device's own `label`, and the
 * server keeps no registry of other devices — that is `SyncPayload.devices`,
 * Task 10's job (plan file, Task 10 header: "leave room for it; do not design
 * it away here"). Rendering a one-row list today, rather than inventing a
 * fetch this client cannot make, is the honest state; Task 10 grows the same
 * `<ul>` to more rows without changing this file's shape.
 *
 * Follows `courseSettings.ts`'s modal pattern: a `<dialog>` built with `el`,
 * `showModal()`, `closedby="any"`, appended to `document.body`, idempotent
 * against a stale dialog left by a previous mount. Unlike that dialog's
 * per-row invoker, this one is always opened from the single static "Profil"
 * control in the page chrome, which is never removed from the document — so
 * the native `showModal()`/`close()` focus return needs no manual fallback.
 */
import type { PlanStore } from "../../lib/planner/store.js";
import type { SyncClient, SyncSession } from "../../lib/planner/syncClient.js";
import { el, icon } from "./dom.js";

export interface ProfilePanelDeps {
  store: PlanStore;
  sync: SyncClient;
  /** Opens studieinfo. Called after this panel closes itself — see `renderProgramBlock`. */
  onEditProgram: () => void;
  signal: AbortSignal;
}

/** What `setSyncState` renders on the "Sist synkronisert" line and this
 *  device's own row. Mirrors the three states a push can end in. */
export type SyncUiState = "ok" | "failed" | "syncing";

export interface ProfilePanelHandle {
  show(): void;
  setSyncState(state: SyncUiState): void;
}

/** Six digits, and only digits: the field is `inputmode="numeric"`, never a password input. */
export function pinIsValid(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

/**
 * "Mac · Safari", not "Martin's laptop". Labelled by platform and browser
 * because a second browser on the same machine is a second entry — these are
 * browser profiles, not devices, and the list must not claim otherwise.
 */
export function deviceLabel(ua: string): string {
  if (ua === "") return "Ukjent enhet";
  const platform = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "Ukjent enhet";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "nettleser";
  return `${platform} · ${browser}`;
}

/**
 * Norwegian copy for a `SyncResult`'s failure `reason`. `taken` and `bad_pin`
 * are the brief's exact strings; the rest of `SyncClient`'s documented reasons
 * (`no_account`, `too_many_attempts`, `unavailable`) get the same sentence-case
 * treatment. Anything else — `failed`, and `login`'s `undecryptable`, which the
 * Task 6 review found not reachable today but real in the type — falls back to
 * the generic retry sentence rather than leaking a code the student cannot act
 * on.
 */
function reasonCopy(reason: string): string {
  switch (reason) {
    case "taken":
      return "Det navnet er tatt. Velg et annet.";
    case "bad_pin":
      return "Feil PIN.";
    case "no_account":
      return "Fant ingen konto med det navnet.";
    case "too_many_attempts":
      return "For mange forsøk. Prøv igjen senere.";
    case "unavailable":
      return "Tjenesten er utilgjengelig. Prøv igjen senere.";
    default:
      return "Noe gikk galt. Prøv igjen.";
  }
}

/** The "Sist synkronisert" line's text for each `SyncUiState`. */
function syncStatusLine(state: SyncUiState): string {
  if (state === "syncing") return "Synkroniserer …";
  if (state === "failed") return "Ikke synkronisert · prøv igjen";
  return "Sist synkronisert nå";
}

/** What a device row appends after its platform/browser label. */
function syncSuffix(state: SyncUiState): string {
  if (state === "syncing") return "synkroniserer";
  if (state === "failed") return "prøv igjen";
  return "nå";
}

/** One labelled `.np-field` text input; `extra` carries attributes `el` has no dedicated setter for. */
function buildField(
  labelText: string,
  id: string,
  extra?: Record<string, string>,
): { wrapper: HTMLElement; input: HTMLInputElement } {
  const wrapper = el("div", "profile-panel-field");
  const label = el("label", "np-kicker profile-panel-label", labelText);
  label.htmlFor = id;
  wrapper.append(label);

  const shell = el("div", "np-field");
  const input = el("input") as HTMLInputElement;
  input.id = id;
  // NEVER "password": a numeric field makes it impossible for a student to
  // type their real Feide password into an unofficial site, which is worth
  // designing out rather than trusting a label to prevent.
  input.type = "text";
  input.autocomplete = "off";
  if (extra) {
    for (const [key, value] of Object.entries(extra)) input.setAttribute(key, value);
  }
  shell.append(input);
  wrapper.append(shell);

  return { wrapper, input };
}

/**
 * Mounts the panel once. Idempotent against a stale dialog left by a previous
 * mount, and self-removes on `signal` abort (a page swap under ClientRouter).
 */
export function mountProfilePanel(deps: ProfilePanelDeps): ProfilePanelHandle {
  document.getElementById("planner-profile-panel")?.remove();

  const dialog = el("dialog", "np-frame profile-panel-dialog") as HTMLDialogElement;
  dialog.id = "planner-profile-panel";
  dialog.setAttribute("aria-labelledby", "profile-panel-title");
  // Light dismiss: Esc *and* a backdrop click, same as every other modal here.
  dialog.setAttribute("closedby", "any");
  document.body.append(dialog);

  /** What Task 8 calls after every push — reflected live only while signed in
   *  and open; otherwise it just waits for the next `show()`/`render()`. */
  let syncState: SyncUiState = "ok";

  function close(): void {
    if (dialog.open) dialog.close();
  }

  function renderClose(): HTMLElement {
    const button = el("button", "np-icon-btn profile-panel-close");
    button.append(icon("close"));
    button.type = "button";
    button.setAttribute("aria-label", "Lukk");
    button.addEventListener("click", close);
    return button;
  }

  function renderHead(): HTMLElement {
    const head = el("div", "np-head profile-panel-head");
    const ident = el("div", "np-head-ident");
    const title = el("h2", "np-head-title", "Profil");
    title.id = "profile-panel-title";
    ident.append(title);
    head.append(ident, renderClose());
    return head;
  }

  /**
   * The plan's own identity, at the top of both states — the same fact the
   * planner's title bar names, so the account panel never contradicts it. No
   * programme set gets the same fallback label `renderBanner` already uses
   * for the page's own "Endre" control, rather than a second phrase for the
   * same empty state.
   */
  function renderProgramBlock(): HTMLElement {
    const program = deps.store.loadPlan().program;
    const block = el("div", "profile-panel-program");
    const value = program
      ? `${program.code} · kull ${program.cohort}`
      : "Ingen studieprogram valgt";
    block.append(el("p", "np-hint profile-panel-program-value", value));
    const edit = el(
      "button",
      "np-navlink profile-panel-edit",
      program ? "Endre" : "Velg studieprogram",
    );
    edit.type = "button";
    edit.addEventListener("click", () => {
      // Two native <dialog>s open at once is not a state this product has
      // anywhere else; close this one before studieinfo opens on top of it.
      close();
      deps.onEditProgram();
    });
    block.append(edit);
    return block;
  }

  function renderSignedOut(): void {
    dialog.replaceChildren(renderHead());
    const body = el("div", "profile-panel-body");
    body.append(renderProgramBlock());

    body.append(el("h3", "profile-panel-heading", "Logg inn eller opprett konto"));
    body.append(el("p", "np-hint", "Da følger planen med på telefon, PC og nettbrett."));

    const navn = buildField("Navn", "profile-panel-navn");
    const pin = buildField("PIN (6 siffer)", "profile-panel-pin", {
      inputmode: "numeric",
      maxlength: "6",
    });
    const repeat = buildField("Gjenta PIN", "profile-panel-repeat-pin", {
      inputmode: "numeric",
      maxlength: "6",
    });
    body.append(navn.wrapper, pin.wrapper, repeat.wrapper);

    body.append(el("p", "np-hint", "Planen lagres kryptert. Vi kan ikke lese den."));
    body.append(el("p", "np-hint", "Husk PIN-en — du trenger den for å logge inn på en ny enhet."));

    // Permanently mounted, never `hidden` — mirrors studieinfo's own hint, so
    // a refused submit is described from the button that caused it (below).
    const hint = el("p", "np-hint profile-panel-hint", "");
    hint.id = "profile-panel-hint";
    hint.setAttribute("aria-live", "polite");
    body.append(hint);

    const actions = el("div", "np-actions profile-panel-actions");
    const signupBtn = el("button", "np-btn np-btn--primary", "Opprett konto") as HTMLButtonElement;
    signupBtn.type = "button";
    signupBtn.setAttribute("aria-describedby", "profile-panel-hint");
    const loginBtn = el("button", "np-btn", "Logg inn") as HTMLButtonElement;
    loginBtn.type = "button";
    loginBtn.setAttribute("aria-describedby", "profile-panel-hint");
    actions.append(signupBtn, loginBtn);
    body.append(actions);

    dialog.append(body);

    async function submit(kind: "signup" | "login"): Promise<void> {
      const navnValue = navn.input.value.trim();
      const pinValue = pin.input.value.trim();
      if (navnValue === "") {
        hint.textContent = "Skriv inn et navn.";
        navn.input.focus();
        return;
      }
      if (!pinIsValid(pinValue)) {
        hint.textContent = "PIN må være 6 siffer.";
        pin.input.focus();
        return;
      }
      // Gjenta PIN exists to catch a typo before it round-trips to the
      // server as the encryption key's own input — syncClient never sees the
      // second value, so the check has to happen here or not at all.
      if (kind === "signup" && pinValue !== repeat.input.value.trim()) {
        hint.textContent = "PIN-ene er ikke like.";
        repeat.input.focus();
        return;
      }
      hint.textContent = "";
      signupBtn.disabled = true;
      loginBtn.disabled = true;
      const label = deviceLabel(navigator.userAgent);
      const result =
        kind === "signup"
          ? await deps.sync.signup(navnValue, pinValue, label)
          : await deps.sync.login(navnValue, pinValue, label);
      signupBtn.disabled = false;
      loginBtn.disabled = false;
      if (!result.ok) {
        hint.textContent = reasonCopy(result.reason);
        return;
      }
      syncState = "ok";
      render();
    }

    signupBtn.addEventListener("click", () => {
      void submit("signup");
    });
    loginBtn.addEventListener("click", () => {
      void submit("login");
    });
  }

  function renderSignedIn(session: SyncSession): void {
    dialog.replaceChildren(renderHead());
    const body = el("div", "profile-panel-body");
    body.append(renderProgramBlock());

    body.append(el("p", "np-hint profile-panel-sync-line", syncStatusLine(syncState)));

    const list = el("ul", "profile-panel-devices");
    const row = el("li", "profile-panel-device-row");
    row.append(el("span", undefined, `${session.label} — ${syncSuffix(syncState)}`));
    list.append(row);
    body.append(list);

    const actions = el("div", "np-actions profile-panel-actions");
    const logoutBtn = el("button", "np-btn profile-panel-logout", "Logg ut på denne enheten");
    logoutBtn.type = "button";
    logoutBtn.addEventListener("click", () => {
      deps.sync.logout();
      syncState = "ok";
      render();
    });
    actions.append(logoutBtn);
    body.append(actions);

    dialog.append(body);
  }

  /** Full idempotent rebuild, driven by `sync.session()` — mirrors `renderContent` in `courseSettings.ts`. */
  function render(): void {
    const session = deps.sync.session();
    if (session) renderSignedIn(session);
    else renderSignedOut();
  }

  deps.signal.addEventListener("abort", () => dialog.remove());

  return {
    show(): void {
      render();
      dialog.scrollTop = 0;
      if (!dialog.open) dialog.showModal();
    },
    setSyncState(state: SyncUiState): void {
      syncState = state;
      // Only re-renders while there is something on screen to correct — Task
      // 8 calls this after every push, most of which happen with the panel
      // closed or the student mid-signup (not signed in yet).
      if (dialog.open && deps.sync.session()) render();
    },
  };
}
