/**
 * The profile panel — the ONE surface the opt-in account lives on: the
 * programme/kull summary a student already set in studieinfo, signup/login,
 * the device registry, and changing the PIN. It is reached from one control
 * ("Profil", in the planner's title block) and nothing else nags about it —
 * the account is strictly opt-in and never a prerequisite for using the
 * planner (see the plan's product framing).
 *
 * Three states, switched on `sync.session()` and a pending collision:
 *  - signed out — programme block, Navn/PIN/Gjenta PIN, the two terms lines,
 *    Opprett konto / Logg inn.
 *  - a login collision (§6 step 5) — the one prompt this design keeps: two
 *    independent histories met, and the student picks which one wins. Shown
 *    ONLY when `describeCollision` says so; an ordinary "add my second
 *    device" login never reaches it.
 *  - signed in — programme block, "Sist synkronisert …", the device
 *    registry (`SyncSession.devices`, labelled by platform and browser —
 *    two browsers on one Mac are two entries), Bytt PIN, Logg ut på denne
 *    enheten.
 *
 * There is no per-device revocation (§4 / §6 step 8): Bytt PIN is the only
 * way to drop a device, and it is honest about the cost — every OTHER
 * device is logged out until given the new PIN, because they all share one
 * derived key.
 *
 * Follows `courseSettings.ts`'s modal pattern: a `<dialog>` built with `el`,
 * `showModal()`, `closedby="any"`, appended to `document.body`, idempotent
 * against a stale dialog left by a previous mount. Unlike that dialog's
 * per-row invoker, this one is always opened from the single static "Profil"
 * control in the page chrome, which is never removed from the document — so
 * the native `showModal()`/`close()` focus return needs no manual fallback.
 */
import type { PlanStore } from "../../lib/planner/store.js";
import {
  type DeviceEntry,
  describeCollision,
  type SyncClient,
  type SyncPayload,
  type SyncResult,
  type SyncSession,
} from "../../lib/planner/syncClient.js";
import { el, formatCreditNumber, icon } from "./dom.js";

export interface ProfilePanelDeps {
  store: PlanStore;
  sync: SyncClient;
  /** Opens studieinfo. Called after this panel closes itself — see `renderProgramBlock`. */
  onEditProgram: () => void;
  /**
   * Fires after a successful `signup`/`login`, i.e. exactly when `sync`'s
   * `applySyncable` may just have written a DIFFERENT plan straight into
   * `localStorage`. `login` bypasses `store.savePlan` (it has to — it is
   * writing the server's copy, not deriving a new one), so nothing repaints
   * on its own; the caller is expected to pass its own pull-repaint path
   * (`applyPulledPlan` in `plannerApp.ts`) here rather than this file
   * reaching into plan rendering it does not own. Harmless to call after a
   * `signup` too: the blob just pushed IS the plan already on screen, so the
   * hash comparison there is a no-op.
   */
  onAuthenticated: () => void;
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
 * Norwegian copy for a `SyncResult`'s failure `reason`. `bad_pin` is the
 * brief's exact string; the rest of `SyncClient`'s documented reasons
 * (`no_account`, `too_many_attempts`, `unavailable`) get the same
 * sentence-case treatment. Anything else — `failed`, and `login`'s
 * `undecryptable`, which the Task 6 review found not reachable today but real
 * in the type — falls back to the generic retry sentence rather than leaking
 * a code the student cannot act on.
 *
 * `taken` and `no_account` name the OTHER action rather than stopping at the
 * fact, e.g. "Det navnet er tatt. Har du kontoen alt? Logg inn i stedet."
 * (the brief's original "Velg et annet." is gone). Both fields feed both
 * `signup` and `login` (see `signupBtn.type = "submit"`'s comment below) and
 * the same pair of buttons sits under either message, so a returning
 * student who lands on `taken` by pressing Enter, or by clicking Opprett
 * konto on a name they already own, is one sentence away from the control
 * that actually works — not just told what went wrong.
 */
function reasonCopy(reason: string): string {
  switch (reason) {
    case "taken":
      return "Det navnet er tatt. Har du kontoen alt? Logg inn i stedet.";
    case "bad_pin":
      return "Feil PIN.";
    case "no_account":
      return "Fant ingen konto med det navnet. Opprett konto i stedet.";
    case "too_many_attempts":
      return "For mange forsøk. Prøv igjen senere.";
    case "unavailable":
      return "Tjenesten er utilgjengelig. Prøv igjen senere.";
    default:
      return "Noe gikk galt. Prøv igjen.";
  }
}

/**
 * Calls `sync.signup`/`sync.login` and turns whatever happens — a normal
 * `{ ok: true }`, a normal `{ ok: false, reason }`, `login`'s third outcome
 * (§6 step 5's collision), or an outright promise REJECTION — into one
 * outcome that always resolves.
 *
 * The reject-to-`"failed"` fold below is belt and braces, not the fix: Task
 * 10 made `syncClient.ts`'s own `fetch` calls total (every method resolves
 * `{ ok: false, reason: "failed" }` on a network error rather than rejecting
 * the promise), which is the actual close of the gap this function was first
 * built to paper over. The `try`/`catch` stays anyway — `submit()` awaits
 * this function and unconditionally re-enables both buttons right after, and
 * a second line of defence here costs nothing.
 *
 * The collision branch is picked out with `isCollisionResult`, a proper type
 * predicate, rather than `result.reason === "collision"` or an `"local" in
 * result` check: `LoginResult`'s generic failure member types `reason` as a
 * bare `string`, so neither form actually excludes that member — TS keeps it
 * around as an intersection with a `Record<"local", unknown>` (or similar),
 * which still fails `result.local`/`result.remote` against `SyncPayload`. An
 * explicit predicate sidesteps that structural-narrowing gap entirely.
 */
function isCollisionResult(
  result: SyncResult | Awaited<ReturnType<SyncClient["login"]>>,
): result is { ok: false; reason: "collision"; local: SyncPayload; remote: SyncPayload } {
  return !result.ok && "local" in result && "remote" in result;
}

export async function attemptAuth(
  sync: SyncClient,
  kind: "signup" | "login",
  navn: string,
  pin: string,
  label: string,
): Promise<
  | { ok: true }
  | { ok: false; hint: string }
  | { ok: false; collision: { local: SyncPayload; remote: SyncPayload } }
> {
  let result: SyncResult | Awaited<ReturnType<SyncClient["login"]>>;
  try {
    result =
      kind === "signup" ? await sync.signup(navn, pin, label) : await sync.login(navn, pin, label);
  } catch {
    result = { ok: false, reason: "failed" };
  }
  if (result.ok) return { ok: true };
  if (isCollisionResult(result)) {
    return { ok: false, collision: { local: result.local, remote: result.remote } };
  }
  return { ok: false, hint: reasonCopy(result.reason) };
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

/**
 * A device row's relative-time suffix ("2 t siden", "i går" — §6 step 6) for
 * every row EXCEPT this one, which keeps `syncSuffix` (it reflects live sync
 * state, not a stored timestamp). Buckets rather than an exact duration,
 * matching the rest of the planner's copy register.
 */
function relativeSince(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "nå";
  if (minutes < 60) return `${minutes} min siden`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} t siden`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "i går" : `${days} dager siden`;
}

/** "1 emne" / "5 emner" — the same singular/plural rule `plannerApp.ts` uses
 *  for every other course count. */
function courseWord(n: number): string {
  return n === 1 ? "emne" : "emner";
}

/**
 * A payload's credit total for one semester, parsed straight from the
 * plaintext `plans` JSON the same defensive way `describeCollision` reads
 * `code` — malformed or missing rows count as nothing rather than throwing,
 * since this only ever runs on a payload this client just decrypted or holds
 * locally, never on something a mistake elsewhere should crash the panel over.
 */
function creditsFor(payload: SyncPayload, semesterId: string): number {
  try {
    const plans = JSON.parse(payload.plans) as Record<string, Array<{ credits?: unknown }>>;
    return (plans[semesterId] ?? []).reduce(
      (sum, row) => sum + (typeof row.credits === "number" ? row.credits : 0),
      0,
    );
  } catch {
    return 0;
  }
}

/** The most recently active OTHER device, for naming the remote side of the
 *  collision question ("MacBook — …"). `undefined` when the account has no
 *  registry yet — a fresh signup nobody else has ever pushed to. */
function latestDevice(devices: DeviceEntry[]): DeviceEntry | undefined {
  return devices.reduce<DeviceEntry | undefined>(
    (latest, candidate) => (!latest || candidate.lastSeen > latest.lastSeen ? candidate : latest),
    undefined,
  );
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
    // A <form>, not a <div>: `addCourse.ts`'s search field sets this
    // precedent (`searchForm`, addCourse.ts:169) for exactly this reason —
    // without it, only a mouse click reaches `submit()` and Enter in Navn/
    // PIN/Gjenta PIN does nothing. A login form is a stronger case for it
    // than a search box.
    const body = el("form", "profile-panel-body") as HTMLFormElement;
    body.autocomplete = "off";
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
    // The form's one `type="submit"` control, so Enter in any field and a
    // click land on the same listener below (native submit dispatch) rather
    // than needing a second, separately-bound click handler. It is also the
    // button already carrying `.np-btn--primary` — Enter deferring to the
    // same action a mouse click defaults to, not a second convention.
    //
    // Which action Enter picks is ARBITRARY: the same three fields feed both
    // signup and login, and a returning student setting up a second device —
    // the single most likely keyboard flow in a sync feature — is exactly as
    // probable as a first-time student, so there is no "more correct" default
    // to route Enter to. Swapping which button carries `type="submit"` only
    // moves the mis-route from one population to the other; it does not
    // remove it. What actually makes either landing survivable is
    // `reasonCopy`'s `taken`/`no_account` cases naming the OTHER action —
    // whichever button Enter (or a mismatched mouse click) reaches, a wrong
    // guess names its way out rather than dead-ending. Do not "fix" this by
    // moving `type="submit"` to `loginBtn` without also reverting that copy;
    // the two changes are one decision.
    const signupBtn = el("button", "np-btn np-btn--primary", "Opprett konto") as HTMLButtonElement;
    signupBtn.type = "submit";
    signupBtn.setAttribute("aria-describedby", "profile-panel-hint");
    // Deliberately NOT `type="submit"`: two submit controls in one form make
    // the "default button" Enter activates engine-dependent. Logg inn stays
    // reachable by its own click handler, exactly as before.
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
      // `attemptAuth` never rejects — see its own doc comment — so these two
      // lines are unconditional, unlike the bare `await deps.sync.signup(…)`
      // this replaced.
      const outcome = await attemptAuth(deps.sync, kind, navnValue, pinValue, label);
      signupBtn.disabled = false;
      loginBtn.disabled = false;
      if (!outcome.ok) {
        // §6 step 5: not a failure — this device and the account it just
        // authenticated against each hold a plan, and the student has to
        // pick. `resolveLogin` (inside `renderCollision`) finishes the login
        // `attemptAuth` deliberately left pending.
        if ("collision" in outcome) {
          renderCollision(outcome.collision.local, outcome.collision.remote);
          return;
        }
        hint.textContent = outcome.hint;
        return;
      }
      syncState = "ok";
      render();
      // See `onAuthenticated`'s own doc comment: `login` may have just
      // overwritten this device's plan and nothing else here repaints it.
      deps.onAuthenticated();
    }

    // Enter in Navn/PIN/Gjenta PIN triggers native form submission, which
    // fires this once — including when it was `signupBtn` (type="submit")
    // that was clicked directly, so no separate click listener is needed
    // for it.
    body.addEventListener("submit", (event) => {
      event.preventDefault();
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
    // This device first — it is the only row that reflects LIVE sync state
    // (`syncSuffix`: "nå"/"synkroniserer"/"prøv igjen") rather than a stored
    // timestamp — then the rest by most recently seen.
    const sorted = [...session.devices].sort((a, b) => {
      if (a.id === session.deviceId) return -1;
      if (b.id === session.deviceId) return 1;
      return b.lastSeen.localeCompare(a.lastSeen);
    });
    for (const device of sorted) {
      const row = el("li", "profile-panel-device-row");
      const suffix =
        device.id === session.deviceId ? syncSuffix(syncState) : relativeSince(device.lastSeen);
      row.append(el("span", undefined, `${device.label} — ${suffix}`));
      list.append(row);
    }
    body.append(list);

    const actions = el("div", "np-actions profile-panel-actions");
    // §4 / §6 step 8: the only way to drop a device — no per-device control
    // exists in the list above, on purpose. There is no per-device
    // revocation, and this UI must not imply one.
    const changePinBtn = el("button", "np-btn profile-panel-change-pin", "Bytt PIN");
    changePinBtn.type = "button";
    changePinBtn.addEventListener("click", () => renderChangePin());
    const logoutBtn = el("button", "np-btn profile-panel-logout", "Logg ut på denne enheten");
    logoutBtn.type = "button";
    logoutBtn.addEventListener("click", () => {
      deps.sync.logout();
      syncState = "ok";
      render();
    });
    actions.append(changePinBtn, logoutBtn);
    body.append(actions);

    dialog.append(body);
  }

  /**
   * §4 / §6 step 8: re-credentials the account under a new PIN. Honest about
   * the one real consequence — every OTHER device is logged out until given
   * the new PIN, because all of them share one derived key and there is no
   * finer-grained revocation. `changePin` itself is atomic (its own doc
   * comment): a failure here leaves the session exactly as it was, so
   * `Avbryt` and a failed attempt both just fall back to `render()`.
   */
  function renderChangePin(): void {
    dialog.replaceChildren(renderHead());
    const body = el("form", "profile-panel-body") as HTMLFormElement;
    body.autocomplete = "off";
    body.append(el("h3", "profile-panel-heading", "Bytt PIN"));
    body.append(
      el(
        "p",
        "np-hint",
        "Da lager vi en ny kobling. Du må logge inn på nytt på enhetene du beholder.",
      ),
    );

    const oldPin = buildField("Nåværende PIN", "profile-panel-old-pin", {
      inputmode: "numeric",
      maxlength: "6",
    });
    const newPin = buildField("Ny PIN", "profile-panel-new-pin", {
      inputmode: "numeric",
      maxlength: "6",
    });
    const repeatPin = buildField("Gjenta ny PIN", "profile-panel-repeat-new-pin", {
      inputmode: "numeric",
      maxlength: "6",
    });
    body.append(oldPin.wrapper, newPin.wrapper, repeatPin.wrapper);

    const hint = el("p", "np-hint profile-panel-hint", "");
    hint.id = "profile-panel-change-pin-hint";
    hint.setAttribute("aria-live", "polite");
    body.append(hint);

    const actions = el("div", "np-actions profile-panel-actions");
    const cancelBtn = el("button", "np-btn", "Avbryt");
    cancelBtn.type = "button";
    cancelBtn.addEventListener("click", () => render());
    const confirmBtn = el("button", "np-btn np-btn--primary", "Bytt PIN") as HTMLButtonElement;
    confirmBtn.type = "submit";
    confirmBtn.setAttribute("aria-describedby", "profile-panel-change-pin-hint");
    actions.append(cancelBtn, confirmBtn);
    body.append(actions);

    dialog.append(body);

    async function submit(): Promise<void> {
      const oldValue = oldPin.input.value.trim();
      const newValue = newPin.input.value.trim();
      if (!pinIsValid(oldValue)) {
        hint.textContent = "Skriv inn PIN-en du bruker i dag.";
        oldPin.input.focus();
        return;
      }
      if (!pinIsValid(newValue)) {
        hint.textContent = "Ny PIN må være 6 siffer.";
        newPin.input.focus();
        return;
      }
      if (newValue !== repeatPin.input.value.trim()) {
        hint.textContent = "PIN-ene er ikke like.";
        repeatPin.input.focus();
        return;
      }
      hint.textContent = "";
      cancelBtn.disabled = true;
      confirmBtn.disabled = true;
      // `changePin` never rejects (same total `SyncResult` contract as every
      // other `SyncClient` method), so these two lines are unconditional.
      const result = await deps.sync.changePin(oldValue, newValue);
      cancelBtn.disabled = false;
      confirmBtn.disabled = false;
      if (!result.ok) {
        hint.textContent = reasonCopy(result.reason);
        return;
      }
      syncState = "ok";
      render();
    }

    body.addEventListener("submit", (event) => {
      event.preventDefault();
      void submit();
    });
  }

  /**
   * §6 step 5's collision question — the one prompt this design keeps.
   * `login()` only returns here when its own `describeCollision` call
   * already found something to ask about, so the recompute below (needed for
   * the counts and the "mangler …" list, which `LoginResult` does not carry)
   * cannot itself come back null.
   */
  function renderCollision(local: SyncPayload, remote: SyncPayload): void {
    dialog.replaceChildren(renderHead());
    const body = el("div", "profile-panel-body");
    body.append(
      el("h3", "profile-panel-heading", "Begge enhetene har en plan. Hvilken vil du beholde?"),
    );

    const semesterId = local.lastSemester;
    const summary = describeCollision(local, remote, semesterId) ?? {
      localCount: 0,
      remoteCount: 0,
      missingFromRemote: [] as string[],
    };
    const remoteLabel = latestDevice(remote.devices)?.label ?? "Den andre enheten";
    const missingSuffix =
      summary.missingFromRemote.length > 0
        ? ` · mangler ${summary.missingFromRemote.join(", ")}`
        : "";

    const hint = el("p", "np-hint profile-panel-hint", "");
    hint.id = "profile-panel-collision-hint";
    hint.setAttribute("aria-live", "polite");

    const options = el("div", "profile-panel-collision-options");
    const localBtn = el(
      "button",
      "np-btn np-btn--primary",
      `Denne enheten — ${summary.localCount} ${courseWord(summary.localCount)} · ${formatCreditNumber(creditsFor(local, semesterId))} sp`,
    ) as HTMLButtonElement;
    localBtn.type = "button";
    localBtn.setAttribute("aria-describedby", "profile-panel-collision-hint");
    const remoteBtn = el(
      "button",
      "np-btn",
      `${remoteLabel} — ${summary.remoteCount} ${courseWord(summary.remoteCount)} · ${formatCreditNumber(creditsFor(remote, semesterId))} sp${missingSuffix}`,
    ) as HTMLButtonElement;
    remoteBtn.type = "button";
    remoteBtn.setAttribute("aria-describedby", "profile-panel-collision-hint");
    options.append(localBtn, remoteBtn);
    body.append(options);
    body.append(hint);

    dialog.append(body);

    async function resolve(choice: "local" | "remote"): Promise<void> {
      localBtn.disabled = true;
      remoteBtn.disabled = true;
      // `resolveLogin` never rejects either — same contract as the rest of
      // `SyncClient`.
      const result = await deps.sync.resolveLogin(choice);
      if (!result.ok) {
        hint.textContent = reasonCopy(result.reason);
        localBtn.disabled = false;
        remoteBtn.disabled = false;
        return;
      }
      syncState = "ok";
      render();
      // "remote" just overwrote this device's plan; "local" did not. Calling
      // this unconditionally is harmless either way — see `onAuthenticated`'s
      // own doc comment on `ProfilePanelDeps`.
      deps.onAuthenticated();
    }

    localBtn.addEventListener("click", () => void resolve("local"));
    remoteBtn.addEventListener("click", () => void resolve("remote"));
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
