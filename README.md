# Before You Pay

**Check before you pay.**

Upload a screenshot of an offer, message, invoice, listing or payment request — or paste a
link — and the app analyses it for potential scam warning signs, then returns a risk score,
an explanation of what was flagged, and a clear recommended action.

The tool is deliberately hedged: it reports *warning signs* and never asserts that something
is a scam.

---

## Running it locally

Requires **Node.js 22.5 or newer** (the app uses Node's built-in `node:sqlite` driver, so
there is no database server to install and no native module to compile).

```bash
npm install
cp .env.example .env.local     # then add your ANTHROPIC_API_KEY
npm run dev                    # http://localhost:3000
```

For a production build:

```bash
npm run build
npm start                      # http://localhost:3000
```

The SQLite database is created automatically on first run at `./data/before-you-pay.db`.

### Testing a real screenshot analysis

1. Put your key in `.env.local`:

   ```bash
   echo 'ANTHROPIC_API_KEY=sk-ant-your-real-key' >> .env.local
   ```

   Next.js loads `.env.local` automatically for both `npm run dev` and `npm start`. Nothing
   else needs configuring — `AI_PROVIDER` switches to `anthropic` on its own once a key is
   present.

2. Start the app and open <http://localhost:3000>:

   ```bash
   npm run dev
   ```

3. Confirm you are **not** in demo mode: the home page's yellow "Running in demo mode" strip
   should be gone. If it is still there, the key was not picked up — restart the dev server
   after editing `.env.local`.

4. Go to **Scan Screenshot**, upload a real screenshot of a suspicious message, listing or
   invoice, and submit. A real scan takes a few seconds. On the results page you should see
   fields the model actually read out of your image (seller name, price, payment method) —
   not the generic "Demo analysis" summary, and no "Limits of this check" note about the
   screenshot not being read.

If something goes wrong, the server console names the cause: a rejected key logs
`[ai:anthropic] auth rejected ... Check that ANTHROPIC_API_KEY is set correctly`.

### Setting up Stripe

Payments are optional. Without the `STRIPE_*` variables the app runs fine — the Pricing page
renders, everyone stays on Free, and the upgrade button says payments are not configured.

To turn them on:

1. **Create the product.** In the Stripe Dashboard, add a Product called "Pro" with a
   **recurring** price of $9.99/month. Copy the **price** id (`price_…`, not the product id)
   into `STRIPE_PRICE_ID`.
2. **Copy your secret key** (Developers → API keys) into `STRIPE_SECRET_KEY`. Use a `sk_test_…`
   key while developing.
3. **Point a webhook at the app.** The endpoint is `POST /api/billing/webhook`, subscribed to
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated` and `customer.subscription.deleted`. Locally:

   ```bash
   stripe listen --forward-to localhost:3000/api/billing/webhook
   ```

   Copy the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET`. In production, create the
   endpoint in the Dashboard and copy its signing secret.

**No publishable key is required.** The app uses hosted Stripe Checkout: the server creates
the session and returns a URL for the browser to follow, so Stripe.js never loads and no
Stripe key of any kind reaches the client.

### Running without an API key

If `ANTHROPIC_API_KEY` is not set, the app starts in **demo mode**: the whole flow works, but
screenshots are not actually read. The offline analyser only applies keyword rules to the
notes you type alongside an upload, and every page and result says so. The link checker is
fully functional in demo mode — it is deterministic and makes no AI calls.

---

## Environment variables

All of these are **server-side only**. None is prefixed `NEXT_PUBLIC_`, so none is ever
compiled into the browser bundle.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | **Yes, for real screenshot analysis** | — | API key for the vision model. Without it the app runs in demo mode. |
| `AI_PROVIDER` | No | `anthropic` if a key is set, else `mock` | Which provider the AI service layer uses: `anthropic` or `mock`. |
| `ANTHROPIC_MODEL` | No | `claude-opus-5` | Vision model id. |
| `ANTHROPIC_BASE_URL` | No | Anthropic's API | Read by the SDK itself. Only used to point the app at a stub; leave unset normally. |
| `STRIPE_SECRET_KEY` | For payments | — | Secret API key (`sk_test_…` / `sk_live_…`). |
| `STRIPE_PRICE_ID` | For payments | — | The recurring $9.99/month Price for Pro (`price_…`). |
| `STRIPE_WEBHOOK_SECRET` | For payments | — | Signing secret for the webhook endpoint (`whsec_…`). |
| `APP_URL` | No | request origin | Base URL for Checkout return links. Only needed behind a proxy. |
| `STRIPE_API_BASE` | No | Stripe's API | Test-only override; `npm run test:billing` points it at a stub. |
| `DATABASE_PATH` | No | `./data/before-you-pay.db` | SQLite file location. Created on first run. |
| `RATE_LIMIT_MAX` | No | `10` | Analyses allowed per window, per user or per IP. |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Length of the rate-limit window, in milliseconds. |

`ANTHROPIC_API_KEY` is the only one needed to analyse screenshots; the three `STRIPE_*`
variables are needed to take payments. Everything else has a working default. It belongs in `.env.local`
(gitignored) or in your host's secret manager — never in `next.config.ts`, never in a
`NEXT_PUBLIC_` variable, and never in a file that is committed.

---

## Tests

```bash
npm run typecheck      # tsc --noEmit
npm run test:unit      # AI response parsing, risk scoring bands, schema migration
npm run build
npm run test:vision    # the real vision path, against a local stub (no credits spent)
npm run test:billing   # the whole paid flow, against local stubs (no charges made)
npm run test:backfill  # the one-off period backfill, against seeded Pro data
npm start              # then, in another terminal:
npm run test:smoke     # end-to-end HTTP checks against a running server
```

`test:billing` walks the complete flow end to end: upload → vision analysis → risk score →
warnings → usage count → free limit reached → Checkout → Pro. Stripe and Anthropic are both
stubbed locally, but our own logic is not: webhook payloads are signed with Stripe's own
signing helper and checked by the real `stripe.webhooks.constructEvent`, and the suite asserts
that a **forged** signature and an **unsigned** payload are both rejected and grant nobody Pro.
It also covers duplicate deliveries, cancellation lapsing the entitlement, and that no secret
appears in the rendered HTML or the server log.

Two of its sections are worth knowing about. **Concurrency** fires eight simultaneous scans
from a fresh Free account and asserts exactly three succeed — with the reservation removed,
five get through, so the check genuinely bites. **Billing-period allowance** asserts the
window switches to Stripe's period on upgrade and that scans from before the paid period do
not count against it.

`test:unit` also covers the one path that touches real user data: it builds a database with
the previous release's schema, holding a live Pro subscriber, then opens it with the current
code and asserts the column and table are added in place, existing rows survive, and the
subscriber keeps Pro. Every other suite starts from an empty database, so that path would
otherwise go unexercised.

`test:vision` is the one to run after changing anything in `src/lib/ai/`. It starts a stub
Anthropic endpoint, points the app at it with `ANTHROPIC_BASE_URL`, uploads a real PNG, and
asserts on **both** sides of the call: that the screenshot bytes really are attached to the
request as base64 with the right media type and model, and that the model's reply — its
observations, its evidence wording, its caveats — is what produced the score and the warning
signs. It also covers a refusal, a truncated reply and a rejected key. It needs no API key
and spends nothing.

`test:smoke` drives the real HTTP surface: the scan loop, risk bands, upload validation,
signup/login/logout, cross-user authorisation and rate limiting. Point it elsewhere with
`BASE_URL=... npm run test:smoke`. Start from a fresh database so the history and
rate-limit assertions are meaningful.

---

## How it works

```
Upload  ->  validate  ->  AI extraction  ->  risk engine  ->  persist  ->  results page
```

The split between **extraction** and **scoring** is the important part. The AI provider only
ever reports *what it sees* — structured fields plus observations drawn from a fixed catalog
of signal codes, each with a confidence. It never returns a score. Scoring happens afterwards
in `src/lib/risk/engine.ts`, which is deterministic and provider-independent, so swapping AI
vendors cannot silently change how risk is calculated. Observations carrying a code that is
not in the catalog are discarded rather than trusted.

### The vision call

`src/lib/ai/anthropic.ts` is the only place that talks to Anthropic. Each scan is a single
non-streaming `messages.create` call carrying the screenshot as a base64 `image` block
followed by the text instruction — image first, which is how Claude reads this kind of prompt
most reliably.

- **Model** — `claude-opus-5` by default, overridable with `ANTHROPIC_MODEL`.
- **`max_tokens: 16000`** — thinking is on by default on this model tier and its tokens count
  against the ceiling, so a low value truncates the JSON mid-object. If a reply ever does hit
  the cap the app reports it rather than failing to parse.
- **`effort: "medium"`** — a person is waiting on a spinner, and extraction from one
  screenshot is bounded work. Raise it to `"high"` in that file to spend more per scan on the
  model's judgement.
- **Image limits** — the API accepts PNG, JPEG, WebP and GIF up to 10 MB *base64-encoded* and
  8000x8000 px. The 7 MB upload cap keeps encoded images under that ceiling; oversized or
  otherwise rejected images surface as a plain "try a smaller or clearer screenshot".
- **Refusals** — a refusal is an HTTP 200 with no usable content, so `stop_reason` is checked
  before the content blocks are read.

### Plans, usage and entitlement

| | Free | Pro |
| --- | --- | --- |
| Price | $0 | $9.99/month |
| Screenshot analyses | 3 per calendar month | 100 per billing period |
| Link checks | Unlimited | Unlimited |

Only screenshot analyses are metered, because those are what call the vision model. Link
checks are deterministic and cost nothing to run.

**Allowances follow the billing period on Pro, and the calendar month otherwise.** A
subscriber's window is the period Stripe is billing them for; everyone else has no billing
period, so the UTC calendar month is used. This matters: on a pure calendar month, someone
subscribing on the 28th would get a full 100 analyses for the last few days of that month and
another 100 on the 1st — two allowances for one payment. Upgrading therefore starts a fresh
allowance immediately, which is what the payment buys. If a stored period has elapsed, or a
subscription is not active, the calendar month is used instead.

**Usage is counted from the `scans` table itself** rather than a running counter, so the
number a user sees can never drift from the scans they actually have. A scan row is only
written after the analysis succeeds, so rejected uploads and failed calls are not charged.

**The limit is enforced with a reservation, not a bare count.** Counting completed scans is
enough to *display* usage but not to *enforce* a cap: an analysis takes seconds, and two
requests that both check before either writes would both be allowed. So a request first
claims a row in `scan_reservations` inside a single `BEGIN IMMEDIATE` transaction — the count
and the insert are one atomic step, so racing requests are serialised and the second sees the
first's claim. The allowance is spent by completed scans *plus* live reservations. The slot is
released once the scan row is written (it now counts in the reservation's place) or as soon as
the attempt fails, and a reservation left behind by a dead process lapses after five minutes.
The quota is claimed *before* the vision model is called, so an over-limit request costs
nothing.

**Nothing but Stripe can grant Pro.** `POST /api/billing/webhook` verifies the Stripe
signature over the raw request body and discards anything unsigned or forged; the app never
marks an account Pro because the browser said so. Entitlement is then re-derived on every
request from the stored status *and* period end (`src/lib/billing/subscription.ts`), so a
stale row cannot keep someone on Pro indefinitely — if a webhook is ever missed, access
lapses on its own at the period end. Webhook deliveries are de-duplicated by event id, and a
failed apply releases its claim so Stripe's retry is not mistaken for a duplicate.

The Checkout return page (`/billing/success`) reconciles immediately rather than waiting for
the webhook, but it does not trust the redirect: it reads the session back from Stripe and
grants Pro only if Stripe says it is paid **and** it belongs to the signed-in user.

### Backfilling billing periods (one-off)

Subscribers who existed before allowances moved to billing periods have no stored period, so
they fall back to the calendar month until their next Stripe webhook fills it in — at renewal,
or on any subscription change. To move them across immediately, read the period straight from
Stripe:

```bash
# 1. Dry run first. This is the default: it writes nothing.
STRIPE_SECRET_KEY=sk_live_... DATABASE_PATH=./data/before-you-pay.db \
  npm run backfill:periods

# 2. Happy with the plan? Apply it.
STRIPE_SECRET_KEY=sk_live_... DATABASE_PATH=./data/before-you-pay.db \
  npm run backfill:periods -- --apply
```

Required environment:

| Variable | Required | Notes |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | **Yes** | The script exits 2 without it. Read-only use — it only retrieves subscriptions. |
| `DATABASE_PATH` | Only if you override it | Must be the same database the app runs against. Defaults to `./data/before-you-pay.db`. |

`STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET` are **not** needed — the script never creates a
checkout or verifies a webhook.

If the app runs from a `.env.local`, load it rather than retyping the key:

```bash
set -a && . ./.env.local && set +a && npm run backfill:periods -- --apply
```

Flags: `--force` re-reads every active Pro row rather than only those missing a period (useful
if stored periods have gone stale); `--quiet` prints only errors.

**What it does and does not do.** It is deliberately narrow: it writes the two period columns
and nothing else, so it can neither grant nor revoke access. Free users are never selected.
Rows it cannot resolve — no `stripe_subscription_id`, a subscription deleted at Stripe, or one
Stripe now reports as cancelled — are reported and skipped rather than guessed at; retiring an
entitlement is a webhook's job, not a backfill's. One bad row does not stop the run, and the
script exits non-zero if any row failed so a deploy step notices.

It is safe to run more than once: only rows missing a period are considered, so a second run
finds nothing to do. `npm run test:backfill` exercises all of this against seeded Pro data.

### Scoring

Score runs 0–100: **0–30 Low Risk**, **31–60 Medium Risk**, **61–100 High Risk**.

- Each signal in `src/lib/risk/signals.ts` has a weight, scaled by the analyser's confidence.
- Observations below 0.25 confidence are dropped as noise.
- **Corroboration bonus** — independent warning signs reinforce one another, so signs beyond
  the second add a small bonus (capped).
- **Critical floors** — a few signals are decisive on their own. A confident gift-card demand
  puts the result in the High Risk band whatever else is or isn't present.
- **Mitigating signals** carry negative weights (e.g. payment staying inside a platform
  checkout), but they cannot pull a result below a critical floor.

### Link checker

The link checker inspects the URL **as a string**. It never fetches a link the user suspects
is hostile. It flags raw-IP hosts, punycode, credentials in the address, unusual ports,
throwaway TLDs, stacked subdomains, shorteners, brand names in the wrong part of the address,
hyphen padding and sign-in-shaped paths.

Deeper checks (blocklist feeds, domain age, Safe Browsing) plug in behind the
`ReputationProvider` interface in `src/lib/link/reputation.ts` — the MVP ships a no-op
implementation that declares its own limits in the results.

---

## Security notes

- **Screenshots are never stored.** An upload is held in memory for the length of the request,
  sent to the AI provider, and dropped. Only the extracted findings are persisted. The preview
  on the upload page is a local object URL that never leaves the browser until you submit.
- **All AI calls are server-side.** The API key lives only in the server environment; it is
  never sent to the client, never logged, and upstream error bodies are never forwarded to the
  user (only a status code is logged, for operators).
- **Uploads are validated twice.** Declared MIME type *and* magic bytes must both be an
  allowed image format (PNG, JPEG, WebP, GIF), with a 7 MB limit (which keeps the
  base64-encoded image under the vision API's 10 MB per-image ceiling).
- **Authorisation is enforced in the query.** Ownership is part of the `WHERE` clause, so
  there is no code path that returns another user's scan. A scan belonging to someone else is
  indistinguishable from one that does not exist — both 404 — so scan ids cannot be probed.
- **Passwords** are hashed with scrypt and a per-user salt. Login runs a hash comparison even
  when the account does not exist, so a missing account and a wrong password take similar time.
- **Sessions** are opaque 256-bit ids in an `httpOnly`, `sameSite=lax` cookie, `secure` in
  production, backed by server-side rows that are checked for expiry on every request.
- **Rate limiting** on the analysis endpoints, keyed per user or per IP.
- Anonymous visitors get an opaque guest id so they can read back a scan they just ran — and
  only that scan. Signing up transfers those scans to the new account.

---

## Project layout

```
src/
  app/
    page.tsx                 Home
    scan/                    Screenshot scanner
    link/                    Link checker
    results/[id]/            Results page
    history/                 Scan history (authenticated)
    login/ signup/           Authentication
    pricing/                 Plan comparison
    account/                 Plan, subscription status and monthly usage
    billing/success/         Checkout return, reconciled against Stripe
    api/
      analyze/image          Screenshot analysis endpoint (quota enforced here)
      analyze/link           Link analysis endpoint
      scans/  scans/[id]     History list and single scan
      auth/*                 Signup, login, logout, current user
      billing/*              Checkout, webhook, portal, status
  lib/
    ai/                      Provider interface, Anthropic impl, offline mock, response parser
    risk/                    Signal catalog and the scoring engine
    link/                    URL heuristics and the reputation plug point
    billing/                 Plans, Stripe client, entitlement, usage counting
    db.ts auth.ts scans.ts   SQLite schema, sessions, scan persistence
    validation.ts            Upload and URL validation (shared client/server)
    rate-limit.ts            Fixed-window limiter
  components/                UI components
scripts/
  smoke-test.mjs             End-to-end HTTP tests
  unit-test.mjs              Parser and scoring tests
  verify-vision.mjs          The vision path, against a stub
  verify-billing.mjs         The paid flow end to end, against stubs
  verify-backfill.mjs        The period backfill, against seeded Pro data
  backfill-subscription-periods.mjs
                             One-off: populate billing periods from Stripe
```

### Swapping the AI provider

1. Implement `AiProvider` (`src/lib/ai/provider.ts`) in a new file under `src/lib/ai/`.
2. Add a branch in the factory in `src/lib/ai/index.ts`.

Nothing in the pages, the API routes or the risk engine needs to change.

---

## Limitations

This is an MVP. It highlights patterns that commonly appear in scams so a user knows what to
verify; it cannot confirm that a seller is genuine and it cannot prove that anyone is
committing fraud. A low score is not an endorsement.

- The rate limiter is per-process and in-memory — a multi-instance deployment needs a shared
  store behind the same function signature.
- The link checker does no domain-reputation lookup yet (see the plug point above).
- Scan history has no pagination; it returns the 50 most recent scans.
- Signed-out visitors get the Free allowance tracked against a guest cookie, so clearing
  cookies resets it. Accounts are the real enforcement boundary; requiring sign-in to scan
  would close the gap at the cost of the current no-signup-needed first run.
- Reservations make the limit safe against concurrent requests within one database. The
  `BEGIN IMMEDIATE` transaction also holds across processes sharing the same SQLite file; a
  deployment that shards users over separate databases would need the reservation to live
  wherever that sharding is resolved.
- A reservation held by a process that dies is not released until it lapses (five minutes), so
  in that window the slot stays spent.
