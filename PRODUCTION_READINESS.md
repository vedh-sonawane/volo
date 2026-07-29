# Volo — Production Readiness

Status of the productionization effort. Volo's core agent (understanding, planning,
research, capability reasoning, approval gates, honest execution, Stripe test
payments, sandbox) is complete and tested. This document tracks the SaaS layer.

**Guiding principles preserved throughout:** approval gates, capability awareness,
honest execution reporting, sandbox/live separation, per-user data isolation, and
"never pretend a capability exists."

Legend: ✅ done & tested · 🟡 scaffolded / partial · ⛔ blocked on external setup · ⬜ not started

---

## Completed this phase — Authentication + multi-tenancy (the foundation)

Everything below is built, typechecked, and covered by `scripts/test-auth.mjs`
(27 checks) plus a green full suite (275 checks) and a clean production build.

- ✅ **Email + password auth** — register / login / logout / `me`, scrypt password
  hashing (salted, constant-time; `src/lib/auth/passwords.ts`), generic login
  errors (no account enumeration).
- ✅ **Session management** — opaque 256-bit bearer tokens; only their SHA-256 hash
  is stored; httpOnly + SameSite=Lax + Secure-in-prod cookie; expiry + destroy;
  "sign out other devices" on password change (`src/lib/auth/store.ts`, `session.ts`).
- ✅ **Account management** — change name / email / password / **delete account**
  (cascades across all tables; `src/lib/auth/admin.ts`, `/api/auth/account`).
- ✅ **Protected routes** — `withAuth` guard on every data route (`src/lib/auth/guard.ts`);
  edge `middleware.ts` redirects unauthenticated page loads to `/login`.
- ✅ **Strict per-user data isolation** — a request-scoped `AsyncLocalStorage`
  (`src/lib/auth/context.ts`) scopes **every** task/config/secret read+write to the
  signed-in user. Tests prove no task/config/secret leaks between accounts, and a
  shared-process cache can't leak (owner check in `src/lib/store.ts`).
- ✅ **Env-secret gating** — authenticated users never inherit the host's `.env`
  secrets; only the local/default scope may (single-user dev). (`src/lib/config`).
- ✅ **Terms & Privacy** — `/terms`, `/privacy`, and required consent checkbox at
  signup (enforced server-side in `/api/auth/register`).
- ✅ **Premium onboarding** — `/welcome` multi-step flow (name/timezone, use-cases,
  communication style, control level), skippable, saved per user, never re-shown.
- ✅ **Personalized greeting** — time-aware "Good morning/afternoon/evening/night,
  _Name_" (italic name, display serif) on the dashboard.
- 🟡 **Email verification & password reset** — tokens are issued + single-use
  validated (`createAuthToken`/`consumeAuthToken`), but **delivery** needs a
  transactional email sender (see ⛔ below). The flow is wired; only sending is
  pending.

---

## Completed — Phase 2: Generic OAuth + Integration framework

Built, typechecked, and covered by `scripts/test-oauth.mjs` (30 checks). Full suite
green (305 checks across 10 suites); production build clean (OAuth routes compiled).

- ✅ **Generic OAuth framework** — `/api/auth/oauth/[provider]/start` + `/callback`,
  fully **pluggable** (`src/lib/auth/oauth/providers.ts` — Google, GitHub;
  add a provider = one entry). Authorize-URL generation, **PKCE (S256)**, encrypted
  **state cookie + constant-time CSRF** validation, code→token exchange, **token
  refresh**, and disconnect (`src/lib/auth/oauth/flow.ts`).
- ✅ **Secure token storage** — `user_integrations` table (userId, provider, status,
  scopes, connectedAt, lastUsed, encryptedCredentials, expiry). Access/refresh tokens
  are **AES-256-GCM encrypted at rest** (proven by test), scoped per user, refreshed
  transparently, and **never** returned to the client or the model (`integrations.ts`).
- ✅ **Sign-in with provider AND connect-integration** — the same callback supports
  `mode=login` (create/link account + session) and `mode=connect` (attach scoped tokens
  to the current user).
- ✅ **Integrations dashboard** (`/settings` → Integrations) — connected/available per
  provider, granted permissions, per-capability Connect buttons, Disconnect, and honest
  "OAuth not configured" when a provider's app credentials are absent.
- ✅ **Capability wiring** — `capabilitySnapshot()` now reflects real connection state,
  so the planner knows (e.g. Gmail connected → send via Gmail). First real integration
  action shipped: **`GmailSendAction`** (real Gmail API send, mocked in tests), wired
  into `resolveActionProvider` ahead of SMTP/draft.
- ⛔ **Operator setup still required** to actually connect (no fakes): register the
  OAuth apps and set env creds (`GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`)
  + redirect URIs. Until then the UI honestly says
  "OAuth not configured." **Step-by-step guide provided separately.**

## Google ecosystem — remaining API actions  🟡
- ✅ Framework + token plumbing done; **Gmail send** + **Google Calendar create** +
  **GitHub repo read** are live.
- ⬜ Remaining as thin actions over the connected tokens (Phase 3): Google Drive /
  Docs / Sheets / Contacts / Tasks / Meet / Maps; GitHub issues. Each is a small
  provider that calls the provider API with `getAccessToken(userId, provider)` and declares its scope +
  capability — the connection, capability-awareness, and approval gating already exist.

## 2. Onboarding  ✅  (see Completed)

## 3. Profile & personalization  ✅  (see Completed)

## 4. Premium UI/UX redesign  🟡
- ✅ Dual theme (Paper/Ink), glassmorphism, display type, refined auth/onboarding.
- ⬜ Remaining polish pass across dashboard cards, empty/loading states, and the
  task workspace to a fully Linear/Stripe-grade bar.

## 5. Terms / Privacy / consent  ✅  (see Completed)

## 6. Integrations dashboard  ✅
- Settings → Integrations lists every provider with connect/disconnect, granted
  permissions, and honest "OAuth not configured" states (see Phase 2). SMTP/Stripe/
  research/model status also shown truthfully.

## 7. Stripe production architecture  🟡
- ✅ Stripe **test mode** fully supported and tested (real API, `sk_test_`, test
  cards, idempotency, honest `mode:"test"` reporting, live-key refusal).
- ⬜ **Live** support: split test/live key config, add **webhooks**
  (`/api/webhooks/stripe`, signature-verified) to track the payment lifecycle
  (prepared → awaiting_approval → approved → processing → completed/failed/cancelled),
  store `payment_intent` ids + receipts, refunds, and reconcile status from webhooks
  (never mark complete until Stripe confirms). The `ActionResult.mode` + idempotency
  foundation is already in place.

## 8. Real bookings  ⛔ / ⬜
- Architecture pattern exists (research → approval-gated action, never silent). Real
  execution ⛔ needs a booking provider integration/API per vertical; until then Volo
  honestly reports "unsupported" and prepares exact steps (current behavior).

## 9. Execution history dashboard  ⬜
- Data already persists per task (objective, plan, actions, approvals, results,
  confirmations). Remaining: a `/history` view rendering completed/failed/cancelled
  tasks with their receipts/references. (Low risk — read-only over existing data.)

## 10. Security audit  🟡
- ✅ Secrets AES-256-GCM encrypted at rest, server-only, never sent to client/model/logs.
- ✅ Passwords scrypt-hashed; sessions hashed; tokens single-use + hashed.
- ✅ Per-user authz on every data route; input validation on auth + actions;
  placeholder/live-key/financial-quote refusals; approval-gated consequential actions.
- ⬜ To add before public launch: **rate limiting** (login/register/refine/payment),
  CSRF hardening for cookie auth (SameSite=Lax helps; add per-form tokens or require
  a custom header on mutating requests), security headers/CSP, structured audit
  logging (without secrets), and dependency/secret scanning in CI.

## 11. Final quality check  🟡
- ✅ Full suite green (**305 across 10 suites**): actions, engine, routing, research,
  decision, runcontrol, paths, stripe, auth+isolation, **oauth+integrations**. `tsc`
  clean. Production build clean (middleware + all routes/pages compiled).
- ⬜ Add live end-to-end tests for real OAuth callbacks and Stripe webhooks once
  those external pieces are configured.

## Operator setup (env) for Phase 2 OAuth
Set these in `.env` (per the step-by-step guide) — until present, providers show
"OAuth not configured" and are never offered as working:
```
GOOGLE_CLIENT_ID= / GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID= / GITHUB_CLIENT_SECRET=
```
Redirect URI for each: `{origin}/api/auth/oauth/{provider}/callback`.

---

## What you must provide for the ⛔ items
1. **OAuth apps** (Google, GitHub) → client id/secret + redirect URLs.
2. **Google API enablement** + reviewed consent screens (for scopes).
3. **A transactional email sender** (any free SMTP works) to deliver verification /
   reset emails — the token flow is already built.
4. **Hosting with HTTPS + a domain** (OAuth callbacks and Secure cookies require it).
5. **Stripe live keys + a webhook secret** when you're ready to move real money.

## Known risks / notes
- **Single encryption key file** (`.data/volo.key`) protects all users' secrets on
  this host; production should use a KMS / per-deploy secret. Losing the key makes
  stored secrets unrecoverable (by design).
- **Existing local data** created before auth lives under the `local` scope and is
  not attached to any new account (a migration could claim it for the first user).
- **No email delivery yet** → verification/reset are issued but not sent; sign-up
  currently proceeds unverified. Gate sensitive actions on `emailVerified` once
  delivery is added.
