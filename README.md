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
| `ANTHROPIC_API_KEY` | For real screenshot analysis | — | API key for the vision model. Without it the app runs in demo mode. |
| `AI_PROVIDER` | No | `anthropic` if a key is set, else `mock` | Which provider the AI service layer uses: `anthropic` or `mock`. |
| `ANTHROPIC_MODEL` | No | `claude-sonnet-5` | Vision model id. |
| `DATABASE_PATH` | No | `./data/before-you-pay.db` | SQLite file location. Created on first run. |
| `RATE_LIMIT_MAX` | No | `10` | Analyses allowed per window, per user or per IP. |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Length of the rate-limit window, in milliseconds. |

---

## Tests

```bash
npm run typecheck      # tsc --noEmit
npm run test:unit      # AI response parsing + risk scoring bands
npm run build && npm start
npm run test:smoke     # end-to-end HTTP checks against a running server
```

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
  allowed image format (PNG, JPEG, WebP, GIF), with an 8 MB limit.
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
    api/
      analyze/image          Screenshot analysis endpoint
      analyze/link           Link analysis endpoint
      scans/  scans/[id]     History list and single scan
      auth/*                 Signup, login, logout, current user
  lib/
    ai/                      Provider interface, Anthropic impl, offline mock, response parser
    risk/                    Signal catalog and the scoring engine
    link/                    URL heuristics and the reputation plug point
    db.ts auth.ts scans.ts   SQLite schema, sessions, scan persistence
    validation.ts            Upload and URL validation (shared client/server)
    rate-limit.ts            Fixed-window limiter
  components/                UI components
scripts/
  smoke-test.mjs             End-to-end HTTP tests
  unit-test.mjs              Parser and scoring tests
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
