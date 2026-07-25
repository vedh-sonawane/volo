# Volo

**Tell us what you want done. We figure out the steps.**

Volo is an objective-to-outcome execution engine — not a chatbot. You give it an
_objective_ ("Find me the best driving instructor near me under $60/hour with
availability next week"), and it plans, researches the open web, extracts and
compares real options, and reports an outcome **with sources** — while being
scrupulously honest about what it did and did not do.

> **Free-first by design.** Volo runs end-to-end at **zero cost** with **no API
> keys, no paid services, and no credit card**. The defaults use a built-in
> deterministic engine and a free web-research provider. Optional local AI
> (Ollama) can enrich results, but is never required.

---

## Quick start

```bash
# 1. Install (one-time)
npm install

# 2. (optional) copy env defaults — everything works without this
cp .env.example .env

# 3. Run
npm run dev
# open the printed URL (http://localhost:3000 or the next free port)
```

That's it. Type an objective, or click an example, and watch it execute.

### Try it offline / deterministically

The free DuckDuckGo endpoint can rate-limit under heavy testing. For a fully
offline, deterministic demo (great for development and screenshots), use the
built-in **mock research provider**:

```bash
# Windows PowerShell
$env:RESEARCH_PROVIDER="mock"; npm run dev
# macOS / Linux
RESEARCH_PROVIDER=mock npm run dev
```

The mock returns realistic fixture pages for instructors, restaurants, laptops,
returns guides, and flights, and runs them through the **same** extraction
pipeline as the live provider — so what you see is real behaviour, clearly
labelled as `mock` in the UI.

---

## What Volo does (and won't do)

| It will… | It won't… |
| --- | --- |
| Search the web for free (DuckDuckGo, no key) | Use any paid search/AI/DB/hosting service |
| Fetch public pages and extract readable content | Fabricate a value it didn't find on a page |
| Extract **structured, evidence-backed** options | Claim to have done something it didn't |
| Compare options against your constraints | Send, submit, book, or buy without approval |
| Prepare an email draft or booking steps | Ever silently spend money |
| Report failures honestly, with explanations | Pretend a rate-limited search "found nothing useful" |

Every consequential action (send email, submit form, book, buy) is a **gated
approval** — Volo prepares it, then stops and asks. In the free version those
actions produce a safe artifact (a downloadable `.eml` draft, or exact booking
steps) instead of performing an external side effect.

---

## Configuration

All configuration is via environment variables and is **optional**. See
[`.env.example`](./.env.example) for the full list. Highlights:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MODEL_PROVIDER` | `rule` | `rule` (deterministic, no AI) or `ollama` (local, free) |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Local Ollama endpoint (only if `ollama`) |
| `OLLAMA_MODEL` | `llama3.2` | Local model name |
| `RESEARCH_PROVIDER` | `duckduckgo` | `duckduckgo` (free live) or `mock` (offline) |
| `RESEARCH_MAX_FETCHES` | `6` | Max pages fetched per task (polite + fast) |
| `VOLO_DB_PATH` | `./.data/volo.db` | Local SQLite database file |

**No key in this list is required, and none costs money.**

### Optional: local AI with Ollama (free)

```bash
# install Ollama from https://ollama.com, then:
ollama pull llama3.2
# run Volo pointed at it:
MODEL_PROVIDER=ollama npm run dev
```

With a model available, Volo enriches the final summary prose. All **facts**
still come from real fetched pages — the model is told to use only provided
evidence and never invent prices, names, or availability. If Ollama isn't
running, Volo transparently falls back to the deterministic engine.

---

## How it works

```
Objective ─▶ Understand ─▶ Plan ─▶ Research ─▶ Extract ─▶ Compare ─▶ Report
             (constraints)  (steps) (search +   (structured (rank vs   (outcome +
                                     fetch)      rows)       budget)    sources)
```

1. **Understand** — deterministic parsing of budget, location, timing, count,
   party size, and domain from your natural-language objective.
2. **Plan** — a typed, step-by-step execution plan (with parallel searches).
3. **Research** — free web search + fetch of the most relevant public pages.
4. **Extract** — evidence-backed structured rows; every field is scoped to its
   own option (no borrowing a neighbour's price/contact).
5. **Compare** — filter against hard constraints (e.g. budget), rank
   transparently, explain the ranking.
6. **Report** — a human outcome, top picks, honest limitations, and any actions
   that need your approval.

You watch all of this happen live via a streamed execution timeline.

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full design,
provider abstractions, and the tool/approval model.

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (also full type-check) |
| `npm start` | Run the production build |

## Tech stack (all free / open-source)

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind v4** for the design system
- **better-sqlite3** for local persistence (no external DB)
- **cheerio** for HTML extraction
- Research: **DuckDuckGo** HTML/Lite endpoints (no key) or the offline **mock**
- Model: built-in **rule** provider or local **Ollama** (optional)

## License

MIT — see below. Provided for educational and personal use. Respect the terms of
service and `robots.txt` of any site you fetch; Volo fetches only public pages
and is intentionally low-volume.
