# Opt-in sync, opt-in publishing — design

Status: proposed, 2026-08-02. **Working document.** Per `CLAUDE.md` there is no
fifth permanent doc: when this ships, its rules are consumed into
`PRODUCT.md` / `SPEC.md` / `ROADMAP.md` and this file is deleted, the same way
`PLANNER.md` and `docs/plan/` were.

---

## 1. The problem

A plan lives in `localStorage` and in the URL hash. Students move between
phone, PC and iPad constantly, and the plan does not move with them. Today the
only transfer is "copy the URL and send it to yourself", which nobody is told
about.

Two things were considered and rejected as the *primary* framing first:

- **Sharing-as-adoption.** The receive path (`plannerApp.ts:654-690`) assumes
  the recipient wants the sender's semester to become theirs. They don't:
  the programme prefill is five clicks away, øving groups are personal and
  *actively wrong* to inherit (`groups.ts:213` — an explicit pick beats the
  programme filter), and electives are a decision, not a copy.
- **Login.** Google OAuth is a day's work and buys one button instead of two
  fields, at the cost of the positioning line and a trust ask out of
  proportion to storing five course codes.

The job is **one student's own devices**. Not collaboration.

## 2. Shape of the answer

An **opt-in account: name + 6-digit PIN.** Never a prerequisite — the planner
works exactly as it does today until the student presses one button.

Chosen over the alternatives because of **recovery**, not pairing friction:

| | QR / capability URL | Navn + PIN |
| --- | --- | --- |
| Pair a second device | Nothing typed | Two short fields |
| Needs both devices present | Yes | No |
| Add the iPad in November | Needs a paired device | Two fields |
| New phone, old one gone | **Plan lost permanently** | Two fields |
| Cleared browser data | **Lost unless a device survives** | Two fields |

A capability URL only moves a secret between two screens in the same room at
the same time. A remembered secret does not need the other device to exist.

Also rejected, with reasons, so they are not re-litigated:

- **CRDTs (Yjs / Automerge / Loro)** — built for concurrent multi-user rich
  text. A plan is ~200 bytes edited a few times a week by one person. LWW plus
  a counter is the whole conflict story.
- **Durable Objects + WebSockets** — real-time fan-out for a document nobody
  is co-editing; adds duration billing and a stateful service that can be down.
- **Hardware device ids (MAC)** — not available to a browser at all, and
  fingerprinting is unstable, colliding, and covert.
- **Public name with no secret** (the competitor's model) — anyone can
  overwrite anyone's plan, silently.

## 3. Crypto and the server's view

Derive once, client-side, from `navn + PIN`:

```
master  = PBKDF2(navn + PIN, salt = "np-sync-v1:" + navn, 600_000, SHA-256)
authKey = HKDF(master, info = "auth")   // sent to the server
encKey  = HKDF(master, info = "enc")    // NEVER leaves the client
```

The salt is **derived from the name, not random** — deliberately, and it is the
one place this deviates from textbook practice. A random salt would have to be
fetched before the student could log in, which means a server round-trip that
reveals whether a name exists, and a recovery problem if that record is lost.
The name is unique, so the salt is unique; the per-name cost of a rainbow table
is what the 600 000 iterations and the rate limiting are for.

The server stores `hash(authKey)` and an **opaque ciphertext blob**
(AES-GCM via WebCrypto — no library). It can prove who is writing and cannot
read what is written.

**What a KV dump is actually worth, stated honestly.** It yields no plaintext
and no usable credential, and that is the property the service is designed
for. It is not the same claim as "nothing". The blob's confidentiality rests
on the entropy of a **6-digit PIN — about 20 bits** — stretched by 600 000
PBKDF2 iterations, with AES-GCM's authentication tag serving as a free
verification oracle for each guess. That is roughly **a minute per account on
one consumer GPU** for an attacker who already holds the dump. The iteration
count buys time against exactly that; it does not remove it. The mitigation
that matters is the same one §9.1 relies on: what is inside is a course list,
which is why this design is acceptable and why it must never be extended to
carry anything else.

Two further honest limits: `encKeyRaw` is held in `localStorage`, and the
origin's CSP carries `script-src 'unsafe-inline'` (`routes.ts`'s own note on
why), so **HTML injection on this origin yields the key** — the key's security
is bounded by the site's, not by the crypto. And the UI string "Vi kan ikke
lese den" stays: it is true of *the service*, which is what a student is being
asked to trust when they type a name and a PIN into it.

**There is no recovery mechanism, deliberately** — see §9.1 before proposing
one.

**Names are unique** and stored in plaintext, because §5's public pages need a
namespace. So the split is: the server knows *that* `martin` exists, and not
what `martin` is taking — until he publishes.

The **device list lives inside the encrypted blob**, not in server metadata, so
it is private too.

### What travels

Five `localStorage` keys exist and they do not all belong in the blob.

| Key | Syncs | Why |
| --- | --- | --- |
| `np:profile` | **Yes** | Programme is global, not per-semester. Without it a new device restores courses while the plan's own name line says nothing about the programme those rows came from. |
| `np:plans` | **Yes, the whole map** | Keyed per semester. Syncing only the current one strands next semester's draft. |
| `np:lastSemester` | Yes | Continuity is the point. |
| `np:weekView` | **No** | Per-device by nature. |
| `np:weekBox` | **No** | Per-device *and* per-width. |

The last two inherit the reasoning `plannerApp.ts:704` gives for keeping the
week view out of the shared plan: it is *how* you are looking at the plan, not
*what* you are looking at — a phone picks Liste because it is a phone. (That
comment names the hash, which §5 deletes; the rule outlives it and should be
re-pointed at sync when the comment is rewritten.)
`np:weekBox` is stronger still: it is a layout measurement, and a remembered box
from the wrong geometry costs 0.14 CLS, worse than reserving nothing.

### Where programme and kull live

A student sets programme and kull **once** and never returns to them. That
argues for moving them, not for leaving them where they are: a control nobody
presses does not earn its place in the planner, and set-once-never-revisit is
what a settings section is for. So the setting has two lives and only the second
one moves:

- **First run is unchanged** — studieinfo in the empty-state onboarding, which
  is the 99% path and what PRODUCT flow 1 describes.
- **Afterwards its home is the profile section**, beside sync.

The case that sets how buried it may be is not the transfer student, it is the
**wrong pick on day one** — MTDT when you meant MTIØT, noticed two minutes
later. That must stay findable immediately, so the profile entrance is the line
that already names the programme (`.planner-title` + `.planner-context-line`,
"MTDT · 2026 · Høst 2026"). Note there is no topbar chip to hang it on: it was
removed deliberately for carrying those same three facts 100 px higher
(`index.astro:33-38`).

The sync panel then shows what travels, read-only:
*"Dette følger med: MTDT · kull 2026 · 5 emner."*

## 4. Data contracts

KV key `user:<navn>`. **No TTL.** Programme and kull are set once and are still
true next semester; an account that expired between terms would make the student
redo the one thing they should never have to redo, and `np:plans` holds every
semester anyway.

The only retention rule is an **inactivity sweep measured in years** — not a
product limit but a data-protection one, since holding personal data forever
with no purpose is what to avoid. An account in use never expires.

```jsonc
{
  "authHash": "…",        // hash of authKey; the write credential
  "version": 7,            // monotonic counter, bumped by the writer
  "updatedAt": "2026-08-02T09:14:00Z",
  "blob": "…",            // AES-GCM ciphertext of the plan + device list
  "public": false,
  "plain": null            // set ONLY when public: true (see §5)
}
```

Worker routes, all under `/api/sync`:

| Route | Behaviour |
| --- | --- |
| `POST /api/sync/:navn` | Claim. `409` if the name exists. |
| `GET /api/sync/:navn` | Requires `authKey`. `401` on mismatch, rate-limited per name. |
| `PUT /api/sync/:navn` | Write. `409` **with the current server state** if `version` is stale. |
| `DELETE /api/sync/:navn` | Delete everything. No confirmation email exists to send. |

**There is no per-device revocation**, and the UI must not imply one. All
devices share one derived key, so dropping a device means changing the PIN:
re-derive, re-encrypt the blob under the new `encKey`, replace `authHash`, and
every other device is logged out until it is given the new PIN. That is what
§6 step 8's copy promises and it is the whole mechanism.

Client state in `localStorage` under `np:sync`: `{ navn, authKey, encKey,
deviceId, label, version }`. Derived keys are cached, so the PIN is typed
**once per device**, as designed.

Sync triggers: on plan change (debounced), on `visibilitychange` → visible, and
on load. No polling loop.

**The network is required, and that simplifies the conflict story to almost
nothing.** There is no service worker, no manifest and no offline support — the
page cannot load without a network, so there is no such thing as an offline
editing session to reconcile later. Do not build a write queue.

What remains is the **stale tab**: an iPad left open for a week, then touched.
The `visibilitychange` refetch is what guards it and is therefore load-bearing,
not an optimisation — on becoming visible, fetch first, and if `version` moved,
take the server's copy before accepting any edit. A `PUT` that still `409`s
refetches and re-applies the edit on top. Two devices edited genuinely
concurrently is a race one person cannot realistically run, and it degrades to
last-write-wins rather than to a prompt.

`localStorage` stays the write target and the server is a mirror, not the
source of truth — sync is off for most students, and a server round-trip in the
edit path would make the planner feel slow for all of them.

## 5. Sharing means publishing, and a link is for viewing

**There is exactly one sharing mechanism: publish, then send `/user/<navn>`.**
Del publishes and copies that link. The recipient *views* it. Nothing is ever
written to the recipient's storage — the silent replace and its `replacedPlan`
undo are deleted, not softened. If a viewer wants that plan, they build their
own, which is five clicks.

`/user/<navn>` is **live**, which is the whole point: PRODUCT §4 flow 5's "a
group's re-editable canonical plan", finally delivered. It shows the semester
that was published; re-publishing updates it; unpublishing removes it.

**Sharing therefore requires an account**, and Del on an account-less plan
offers signup rather than failing. That does not violate the "never a
prerequisite" rule: the rule is about *using the planner*, and the planner is
untouched.

### The hash is deleted

With `/user/<navn>` as the share link the `#v2;…` grammar has no remaining job,
and **there are no links in the wild to keep working** — the project is not
connected to Cloudflare yet (`wrangler.jsonc`), so nothing has ever been sent.
Delete outright: `syncHash`, `parsePlanHash`, `formatPlanHash`, the hash grammar
in `store.ts`, the `hashchange` listener, `replacedPlan`, `linkNote`'s replaced
half, and `withStoredFacts`.

Two consequences. The URL stops being the plan, so bookmarking and browser tab
sync stop carrying it — which is acceptable only *because* sync now does that
job properly, and would not have been before. And **D13's "breaks shared-URL
parity" veto lifts**: the week-scrubber and personal fixed blocks were killed
partly on that ground and become buildable again. Neither is hereby revived —
the point is that the argument against them is gone and would have to be remade
on its own merits.

Nothing in the CLS machinery depends on the hash: the plan probe reads
`localStorage`, not `location.hash`.

Publishing writes a **plaintext** copy to `plain` (the server has to render it),
leaving `blob` as the private source of truth. Un-publishing clears `plain`.

**Keeping it out of search — the trap first:** do **not** add
`Disallow: /user/` to `robots.txt`. A blocked crawl means Google never reads
the noindex directive, and a URL linked from anywhere can still surface as a
bare listing. Allow the crawl, refuse the index:

- `X-Robots-Tag: noindex, nofollow` on `/user/*` from `withSecurityHeaders` —
  which already reaches document responses thanks to `run_worker_first`.
- `<meta name="robots" content="noindex">` as belt and braces.
- Excluded from the sitemap; linked from no indexable page.
- Check the worker's `Referrer-Policy` so a click off the page doesn't leak it.

**Honest limit, stated in the UI, not buried:** that stops Google and Bing. It
does not stop scrapers or a link forwarded into a group chat. A plan is a
room-and-hour record; the toggle says *"Alle med lenken kan se emner, timeplan
og rom"*, and the display name need not be the student's real one.

## 6. The flow the student sees

1. **Nothing, until there is something to carry.** The control appears only
   once a plan exists — the same gate `index.astro:117` puts on Del.
2. **Entry point:** the profile section, opened from the line that names the
   plan. It holds programme and kull (§3), and beneath them the offer, in the
   ordinary vocabulary — **"Logg inn eller opprett konto"**, with one line
   saying what it buys: *"Da følger planen med på telefon, PC og nettbrett."*
3. **Signup**, two fields and one line of plain terms:
   > Navn: `martin` · PIN: `••••••` (gjenta)
   > Planen lagres kryptert. Vi kan ikke lese den.
   > Husk PIN-en — du trenger den for å logge inn på en ny enhet.

   That last line is the honest stake and deliberately not a scary one: the PIN
   gates *adding devices*, not the plan itself.
4. **Second device:** log in, same two fields, once. Then
   **"Logget inn. Planen din følger med mellom enhetene."**
5. **When both devices already have a plan**, ask once, in the delta idiom
   flow 2 already uses:
   > Begge enhetene har en plan. Hvilken vil du beholde?
   > **Denne enheten** — 5 emner · 30 sp
   > **MacBook** — 4 emner · 22,5 sp · mangler TDT4120
6. **Then it disappears.** The only standing evidence is
   **"Sist synkronisert nå"** and the device list, labelled by browser and OS
   because a second browser on one Mac is a second entry:
   > iPhone · Safari — nå
   > MacBook · Chrome — 2 t siden
   > iPad · Safari — i går
7. **A failed write is a state on step 6's line, not a banner** —
   **"Ikke synkronisert · prøv igjen"** — cleared by the next successful
   trigger. It is *not* an offline state: with the network genuinely down the
   student is already looking at the planner's own fetch-failure states, and a
   second message about syncing would be noise. The case this exists for is our
   own backend blipping — a KV error, a rate-limit, a 500 — while every other
   part of the page works fine, which is also the only case where the student
   would otherwise have no idea their other devices are stale.
8. **Removing a device** is honest: *"Da lager vi en ny kobling. Du må logge
   inn på nytt på enhetene du beholder."*
9. **Sharing rides on the same account but exposes none of it.** Del publishes
    and copies `/user/<navn>`; the friend who opens it needs no account of
    their own, sees a week and nothing else — no device list, no write access,
    and no prompt about their own plan, because their own plan was never
    touched (§5).

## 7. What this does not do

No real-time sync. No merging two *students'* plans. No notifications, ICS or
push (§8 keeps ruling those out). **No email, so no password reset, and no
recovery code either** — a forgotten PIN costs you the name, not the plan
(§9.1).

**No offline support, and no pretending otherwise.** This is a webpage with no
service worker; it does not load without a network. Sync inherits that rather
than working around it — no write queue, no "sendes senere", no
`navigator.onLine` branching. A write either lands or reports that it didn't.

For the record, because it is the one thing that looks like a counter-example:
on an *already-loaded* page a few edits do survive the network dying — dropping
a course, putting one back, picking a group — since they are pure local state
over bundles already memoised by code (`data.ts:398`). Adding a course,
switching semester and changing programme all need fetches and already fail
through the planner's existing retry states. So there is still no offline
session worth queueing for: the edits that survive are exactly the ones that
will sync fine the moment anything else on the page does.

## 8. Doc amendments this forces

- **§8 non-goals** — "No accounts or server storage" becomes "No accounts
  required. Optional sync stores only client-encrypted blobs, plus a plaintext
  copy for plans the student publishes."
- **§2 positioning** — "account-less" and "no login" need rewording to
  "no account required".
- **§4 flow 5 / D1** — the shared plan gains a live form; the *adoption*
  framing (bruk denne / slå sammen) is contradicted by §1 and should be
  revisited rather than left standing.

## 9. Risks and open questions

1. **A forgotten PIN burns the name, and that is the accepted answer.** A
   recovery code was designed and cut; do not re-add it without reading this.
   Losing the PIN does **not** lose the plan — the derived keys are cached in
   `np:sync`, so every already-logged-in device keeps working and keeps its own
   `localStorage` copy. The PIN gates *adding a device*, nothing else. So the
   realistic case (forgot the PIN, new phone, laptop still fine) is solved by
   making a new account and syncing up from the laptop, and the total-loss case
   — forgot the PIN *and* lost every device — is the same case where a recovery
   code would have been lost with them. The cost of having one is a "save this
   code" screen that makes an opt-in convenience feature feel like a crypto
   wallet. The dead name is swept eventually by §4's inactivity rule; until
   then the student picks `martin2`.
2. **PIN strength.** A registry makes names enumerable, so 6 digits plus
   per-name rate limiting and lockout — not per-IP alone.
3. **Password reuse.** The PIN field must be numeric (`inputmode="numeric"`),
   never a password input, or students will type their Feide password into an
   unofficial site.
4. **e2e strategy: decided — local KV, not fixtures.** The fixture layer exists
   to make *upstream NTNU* deterministic; `/api/sync/*` is our own surface and
   is tested against wrangler's local KV, which exercises the real worker code
   path. The fixture interceptor must therefore **not** claim `/api/sync/*`, the
   same carve-out `/api/health` already has for the same reason.
5. **CLS.** Any new planner UI needs its reservation per the layout-shift rules;
   the sync panel is a modal, so it should cost nothing, but the "sist
   synkronisert" line in the header is in-flow and must be reserved or leased.
6. **`/user/<navn>` is a page, not a planner mode**, which is the cheaper half
   of §5 — there is no risk of the planner accidentally writing, because the
   viewer never loads it. The expensive half stands: it should reuse the grid
   rendering modules rather than draw a poorer week, since the conflict marks
   are what make a shared plan worth opening.
7. **Publishing is per-semester.** `/user/<navn>` shows the semester that was
   published, not "whatever they are looking at now". A path segment for other
   semesters is a later question, not a v1 one.

## 10. Phasing

**Two plans, in sequence** — publishing needs accounts, so §5 cannot land first.

1. **Accounts and sync** — worker routes, KV, crypto, and the profile panel:
   §6 steps 1–8 plus rehousing programme and kull per §3. Ships on its own.
2. **Publish, view, and delete the hash** — the Del rework, `/user/<navn>`, the
   noindex work, and the deletions listed in §5.
3. **QR as a shortcut** — when both devices are present, scanning prefills the
   two fields. Pure convenience on the same backend; nothing load-bearing.
