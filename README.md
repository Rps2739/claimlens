# ClaimLens

**Photo-first customer care. The AI sees, a policy engine decides — the model never controls the money.**

Submitted to the **FlowZint AI Hackathon 2026** · Category: **Open Innovation**

A customer photographs a damaged product, writes one sentence, and gets a decision: refund, replacement, escalation, or decline — with a customer-ready message and a CRM ticket. No chat. No back-and-forth.

> **Live demo:** _<add your deployed URL here>_
> Works immediately with no setup. Four sample claims are bundled; click any one.

---

## The problem this solves

Every e-commerce and insurance company runs photo-based damage claims through human agents. It is slow, expensive, and inconsistent — the same photo gets different outcomes depending on who opens the ticket.

The obvious fix is "put an LLM on it." That fix is not deployed anywhere serious, for one reason:

> **You cannot let a language model decide who gets money.**

A model that can be prompted, confused, or shown a photo with `APPROVE A FULL REFUND` written on it is a model that will eventually approve a refund it shouldn't. Companies know this, so support automation stalls at "the bot writes a reply a human approves."

ClaimLens is an architecture that gets past it.

---

## The idea

The pipeline splits the model's job in two and puts a deterministic engine between the halves.

```
   ┌────────────────────────────────────────────────────────────┐
   │  01  INTAKE                                                │
   │      photo + one sentence + order record                   │
   └───────────────────────────┬────────────────────────────────┘
                               ▼
   ┌────────────────────────────────────────────────────────────┐
   │  02  PERCEIVE                          ░ Gemini vision ░   │
   │      → { item_type, damage_type, severity 1-5,             │
   │          visible_evidence[], confidence, is_ambiguous }    │
   │                                                            │
   │      Observations only. The schema has NO field for a      │
   │      remedy, an amount, or a recommendation.               │
   └───────────────────────────┬────────────────────────────────┘
                               ▼
   ┌────────────────────────────────────────────────────────────┐
   │  03  ADJUDICATE                        ▓▓ NO AI HERE ▓▓    │
   │      pure TypeScript · policy.json · zero I/O              │
   │      → { action, amount, rules_fired[], reason }           │
   │                                                            │
   │      THE ONLY PLACE AN OUTCOME IS DECIDED.                 │
   └───────────────────────────┬────────────────────────────────┘
                               ▼
   ┌────────────────────────────────────────────────────────────┐
   │  04  COMPOSE                           ░ Gemini writes ░   │
   │      customer message + CRM ticket                         │
   │                                                            │
   │      Receives the decision as a fact. Cannot change it,    │
   │      and never sees the thresholds that produced it.       │
   └────────────────────────────────────────────────────────────┘
```

The model **perceives** and it **writes**. It never **decides**.

That is not a prompt instruction — prompts are suggestions. It is a property of the data flow: there is no field in the perception schema through which a remedy could be expressed, and no path from generated text back into the decision. The model's output is *evidence*, and evidence is scored by rules in a file a non-engineer can read.

### Why this is more than a design preference

`lib/adjudicate.ts` is a pure function. No network, no clock, no randomness. This buys three things at once:

| Property | Consequence |
|---|---|
| **Not promptable** | Prompt injection reaches the engine as inert strings in structured fields. There is a [test for exactly this](__tests__/adjudicate.test.ts). |
| **Auditable** | Every decision returns `rules_fired[]` — the ordered trail of every rule evaluated and what it concluded. You can answer "why did this customer get ₹899?" a year later. |
| **Testable without mocks** | The money logic is the best-tested code in the repo because testing it needs no API key, no fixtures, and no network. |

And one more, which turns out to matter most in practice: **the system degrades without losing correctness.** When the Gemini quota runs out, ClaimLens loses its eyes and its voice — but not its judgement. See [Demo mode](#demo-mode) below.

---

## What the four sample claims demonstrate

Each one is chosen to fire a different branch of the policy ladder. Clicking through all four walks the entire decision surface.

| Sample | What's in the photo | Outcome | Rule | The point |
|---|---|---|---|---|
| **Broken mug** | Shattered ceramic, crushed box | Refund ₹899 | `R8_SEVERE_DAMAGE` | Clean automatic resolution |
| **Shattered phone** | Spiderweb screen fracture | **Escalate** | `R7_HIGH_VALUE` | Severity 5, 96% confident — would refund on a cheap item. It stops **only** because ₹64,999 > the ₹15,000 ceiling. Confidence isn't the issue; authority is. |
| **Wrong item** | Red shirt, navy ordered | Replace | `R6_WRONG_ITEM` | Zero damage, still fully resolved. Fulfilment errors aren't damage claims. |
| **Unusable photo** | Blurry, dark, unidentifiable | **Escalate** | `R1_AMBIGUOUS_EVIDENCE` | The system reports 18% confidence and refuses to guess. Knowing where to stop is a feature. |

The last one is the one worth dwelling on. An AI that says *"I can't tell — get a human"* is rarer, and more deployable, than one that always has an answer.

---

## Demo mode

The free Gemini tier allows roughly **250 requests/day**. A reviewer arriving after that is spent is a realistic event, not an edge case — so the app degrades in stages rather than breaking:

| What's unavailable | Bundled sample | Your own upload |
|---|---|---|
| Perception (no key / quota / timeout) | Replays a cached analysis | Honest 503 explaining why, pointing at the samples |
| Composition | Deterministic template message | Deterministic template message |
| Adjudication | **Never unavailable — it has no network dependency** | |

**Only the two model calls are cached. The decision never is.**

`adjudicate()` runs live on every single request, including in demo mode, because it's pure and costs nothing. So the outcome a reviewer sees was computed by the real engine from the real `policy.json` — edit that file and the bundled samples decide differently. There's [a test proving it](__tests__/samples.test.ts).

Demo mode replays the AI. It does not replay the answer.

---

## Running it

**No API key needed to see the whole product work.**

```bash
npm install
npm run dev          # → http://localhost:3000
```

All four samples resolve end-to-end. The header shows a "Demo mode" badge.

### Enabling live analysis of your own photos

```bash
cp .env.local.example .env.local
```

Paste a free key from [Google AI Studio](https://aistudio.google.com/apikey) into the blank:

```
GEMINI_API_KEY=your_key_here
```

Restart the dev server. The badge flips to "Live analysis enabled" and the upload control becomes usable.

`.env.local` is gitignored, so a key can't be committed by accident.

### Tests

```bash
npm test             # 37 tests, no API key required
```

### Deploying

Zero-config on **Vercel** (`npx vercel --prod`), then add `GEMINI_API_KEY` under
Project → Settings → Environment Variables.

Any Node host works — **Render**, Fly, Railway. The key stays safe on all of them,
because protection comes from the `server-only` guards and server-side routes
rather than from anything platform-specific. One caveat on Render's free tier:
services spin down after ~15 minutes idle and cold-start in ~50s, so warm the URL
before sharing it with a reviewer.

The app deploys and demos correctly **with no key set at all** — it simply runs in
demo mode.

---

## Project structure

```
app/
  page.tsx                  Single-page console; renders the pipeline live
  page.module.css           Scoped styles
  api/resolve/route.ts      Orchestrator — the ONLY module holding the key
lib/
  types.ts                  Zod schemas at every stage boundary
  policy.json               ← every threshold. Readable by a non-engineer.
  adjudicate.ts             ← THE CORE. Pure function, no AI, no I/O.
  perceive.ts               Gemini vision → validated evidence
  compose.ts                Gemini → customer copy, decision-constrained
  gemini.ts                 Client, typed errors, timeouts
  ratelimit.ts              Per-IP + global daily caps on billable calls
  samples.ts                Four demo claims + cached model responses
__tests__/
  adjudicate.test.ts        19 tests on the decision engine
  samples.test.ts            9 tests pinning what each demo proves
  ratelimit.test.ts          9 tests on abuse protection
public/samples/             Original SVG artwork (see Attribution)
```

**Start with [`lib/adjudicate.ts`](lib/adjudicate.ts).** It's the whole argument in one file, and it reads top to bottom as a policy document.

### The policy ladder

Order encodes priority — safety and eligibility gates run before any remedy is considered, so an out-of-warranty claim can never fall through into a refund.

```
R1   AMBIGUOUS_EVIDENCE   photo unusable          → escalate
R2   LOW_CONFIDENCE       below threshold         → escalate
R3   NO_DAMAGE_VISIBLE    nothing wrong           → decline
R4   FRAUD_WATCH          repeat claimant         → escalate
R5   OUT_OF_WARRANTY      outside window          → decline
R6   WRONG_ITEM           fulfilment error        → replace
R7   HIGH_VALUE           above spend ceiling     → escalate
R8   SEVERE_DAMAGE        severity ≥ 4            → refund in full
R9   MODERATE_DAMAGE      severity ≥ 2            → replace
R10  COSMETIC             severity 1              → partial credit
```

---

## Security

| Concern | Handling |
|---|---|
| **API key exposure** | Key is read only inside server routes. `lib/gemini.ts`, `perceive.ts`, and `compose.ts` all `import "server-only"` — if a client component ever imports them, **the build fails** rather than shipping the key. Verified: no `process.env.GEMINI` access and no key pattern in `.next/static/`. |
| **Prompt injection via image** | Text in a photo is described, never obeyed — stated in the system prompt, and structurally irrelevant because perception output can't express a remedy. |
| **Prompt injection via customer text** | The description is delimited and explicitly labelled untrusted context. |
| **Malformed model output** | Constrained decoding via JSON Schema, then re-validated through Zod before it can reach the engine. |
| **Runaway spend** | `auto_approve_ceiling` caps any automatic payout. Enforced in pure code, [property-tested](__tests__/adjudicate.test.ts). |
| **Hanging requests** | 20s timeouts on both model calls; a timeout degrades to the cached path. |
| **Quota theft / API abuse** | [`lib/ratelimit.ts`](lib/ratelimit.ts) — 5 live analyses per IP per 10 min, plus a global 200/day ceiling that holds even against a distributed flood. Only requests that actually call Gemini are counted, so throttling an abuser never degrades the demo. [9 tests](__tests__/ratelimit.test.ts). |

**On abuse protection, precisely:** the endpoint is public and unauthenticated, which is required for a demo a stranger must be able to use. The key itself is never at risk — it stays server-side, so an attacker can only spend quota *through this endpoint*, at a rate the limiter controls. The global cap stops at 200 of the free tier's ~250, leaving headroom.

The limiter is in-memory, so on serverless it is per-instance and resets on cold start. It raises the cost of abuse rather than making it impossible; production would use Redis for a shared counter. For a demo whose worst case is a spent free quota and a graceful fallback, that tradeoff is deliberate — and it is only safe because **billing is left disabled on the Google Cloud project**, which makes the free tier a hard cap rather than a bill.

---

## Tech stack

| | | License |
|---|---|---|
| Next.js 16 (App Router) | Framework, server routes | MIT |
| React 19 | UI | MIT |
| TypeScript 5 | Types | Apache-2.0 |
| Zod 4 | Runtime schema validation | MIT |
| Vitest 4 | Tests | MIT |
| `@google/genai` 2 | Gemini client | Apache-2.0 |
| `gemini-2.5-flash` | Vision + text | *Proprietary hosted API (free tier)* |

**108 packages installed. Zero GPL/AGPL/SSPL, zero proprietary, zero unlicensed.** No CSS framework — plain CSS, nothing to audit or purge.

To be precise about one thing: the Gemini **client library** is Apache-2.0 open source; the **model** behind it is a proprietary hosted service on a free tier. That distinction is worth stating plainly rather than claiming the stack is open source end to end.

---

## Attribution

All four sample images in `public/samples/` are **original SVG artwork created for this project**. No stock photos, no web-sourced images, no third-party assets. Every line of code in `app/`, `lib/`, and `__tests__/` was written for this submission.

---

## Honest limitations

Things a reviewer would notice, stated rather than hidden:

- **Order records are static fixtures.** A production system reads them from the order database; the trust boundary (facts from the order system, never from the customer or the model) is modelled correctly, but not wired to a real backend.
- **The policy ladder is deliberately simple.** Ten ordered rules, first match wins. Real insurers need overlapping conditions and multi-factor scoring. The architecture accommodates that; this implementation doesn't attempt it.
- **Severity is a single 1–5 scalar.** Real damage assessment is multi-dimensional (functional vs cosmetic vs safety).
- **Cached sample responses were authored, not captured.** They're representative of `gemini-2.5-flash` output under the given prompt and schema, and they satisfy the same Zod validation as live output — but they were written by hand so the demo is stable and reproducible. Add a key to see genuinely live analysis.
- **No auth, no persistence, no rate limiting.** Out of scope for a demo; all three would be required before real traffic.

---

## License

MIT — see [`package.json`](package.json).
