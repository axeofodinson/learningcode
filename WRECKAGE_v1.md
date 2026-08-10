# WRECKAGE — Spec v1

**One line:** A tool that builds engineering fundamentals by making you predict what code does before you run it, then diagnose why you were wrong.

**Owner:** Hassan. Single user. Not a product.

**Purpose:** Close the gap between shipped-software capability (which I have) and foundational understanding (which I don't, because nothing in my education covered it). The log this produces is also the only record of consistent work on a path with no semesters and no report cards.

---

## 1. The core loop (PRIMM)

Every unit of content is a **Machine** — a small, complete, runnable program.

| Stage | What happens | AI assistant mode |
|---|---|---|
| **Predict** | Read the source. Write what you think it outputs. Cannot proceed without submitting. | Concepts only. No code. |
| **Run** | Execute. See actual output next to your prediction. | Locked. |
| **Investigate** | Poke it. Change inputs, inspect state, answer "explain in plain English". | Concepts only. No code. |
| **Modify** | Make it do something different. Your own attempt required first. | Code allowed, after your attempt is in the window. |
| **Make** | Build a variant from scratch. | Code allowed. |

**The stage gate is the whole design.** By Modify, you have a mental model of *this specific program*, which is the precondition that makes AI-assisted code safe rather than corrosive. The restriction isn't willpower — it's a state machine.

### Hard rules

1. **No prediction, no run.** Not skippable. This is the single best-supported mechanic in the research: novices default to edit-and-test without hypotheses, and forcing a written prediction is the direct intervention against that.
2. **Consolidation is mandatory, not optional.** After every failed prediction, the canonical explanation is *shown*. Withholding it turns productive failure into unproductive failure. This overrides the earlier "never reveal solutions" rule, which was wrong.
3. **The first Machine in any topic is not broken.** Direct instruction establishes minimum vocabulary; breakage teaches only where a schema already exists. Bugs enter at Machine 2.
4. **No streaks, no XP, no leagues.** Engagement metrics diverge from learning outcomes, and for a single-user tool where the user is the author, they are pure self-deception.

---

## 2. Scaffold fading

Difficulty is removed from the *writing* and concentrated on the *reasoning*. Progression per topic:

1. **Predict output** — read only.
2. **Explain in Plain English** — describe what the code does, not line-by-line.
3. **Localize** — given a symptom, name the line and say why.
4. **Parsons** — correct lines given, wrong order. Rearrange.
5. **Completion** — most code given, gap to fill.
6. **Free write** — blank editor.

Bug localization is harder than bug fixing; once you know where it is, fixing is easy. So weight the early stages heavily and don't rush to the blank editor.

---

## 3. Spacing

The highest-effect-size intervention available (retrieval practice + spacing, g ≈ 0.74). This is the reason the app needs a database at all.

Every Machine gets a `due_at`. Failed prediction → short interval. Passed → longer. Resurfacing an old Machine is a first-class session type, not a review afterthought.

---

## 4. The log

**The log is the product, not a feature.** Two jobs:

**Evidence.** Active learning feels worse than passive learning even when it works better — you will feel like you're failing on days you're learning most. Without a visible record of accumulated capability, this app gets abandoned on feel. The log is the counterargument.

**Engagement detection, not enforcement.** Restriction produces backlash and gets bypassed; in one study half of 885 students used an in-product "see solution" escape at least once. Since I am both the user and the author, any lock I build I can pick. So don't lock — measure. Flag the shape of disengagement:

- Prediction submitted under ~5 seconds after source render
- Large paste into the prediction or editor field
- Hypothesis timestamp ordered *after* the fix
- Long idle then instantly correct

Flagged events are logged, not blocked. Response is a prompt to explain, not a refusal.

**Escape hatch exists and is open.** Gated behind submitting a prediction first, then reveals the canonical solution — which is also the consolidation phase. One mechanism, three jobs: relieves pressure, provides the required instruction, records the event.

---

## 5. Architecture

**Web app + Supabase. Not React Native.**

Rationale is specific, not generic: the last several months of the school app were consumed by the Expo/EAS pipeline, not by Supabase or by features. OTA channel misconfiguration, no logcat access, minutes-long rebuild cycles per hypothesis. A web app returns instant refresh, real breakpoints, network inspection, and live state — the same bugs become cheap instead of disappearing.

**Stack:** single HTML file, vanilla JS, zero dependencies, zero build step.

- **No CDN links.** External CDNs are blocked on my network. Anything needed gets committed to the repo.
- **No supabase-js.** Talk to PostgREST with raw `fetch`. It's ~20 lines, removes the dependency problem entirely, and means I understand what the client library would have been doing.
- Machines are written in **JavaScript** — the browser runs it natively with no toolchain, and state is inspectable without tooling.

**Debug panel from session 1.** Collapsible drawer, in-memory ring buffer (last ~500 events), sequence counter on every event, category tags, copy-all button. Never network-dependent — the school app's `debug_logs` table failed precisely when auth or network was the bug. This is the same object as the wreckage log viewed from the other side.

---

## 6. Build order

Each session ends with the app working. If a session ends broken, revert rather than patch forward.

| Session | Slice |
|---|---|
| 1 | Supabase schema + one page: load a working Machine, take a prediction, run, compare, write `attempts` row. Debug panel. |
| 2 | Log view reading from `attempts` and `events`. |
| 3 | Machine 2 — same program, seeded bug. Localize stage. |
| 4 | Consolidation screen after failure. |
| 5 | Spacing scheduler using `schedule`. |
| 6+ | LLM hypothesis grading, Parsons/completion stages, engagement detector, Machine authoring. |

**Success criterion:** three Machines completed within two weeks of session 1. Not "the engine is impressive." Sessions logged.

**Anti-goal:** building the engine becoming the thing I do instead of using it. Wanting to expand scope before Machine 1 exists is the exact shape this failure takes.

---

## 7. Schema

All tables created in session 1 even though only three are used, so growth doesn't require migrations later.

```sql
create table machines (
  id            uuid primary key default gen_random_uuid(),
  topic         text not null,
  ordinal       int  not null,
  title         text not null,
  language      text not null default 'javascript',
  source_code   text not null,
  expected_output text not null,
  is_broken     boolean not null default false,
  bug_note      text,                -- hidden until consolidation
  explanation   text,                -- shown at consolidation
  created_at    timestamptz default now(),
  unique (topic, ordinal)
);

create table attempts (
  id            uuid primary key default gen_random_uuid(),
  machine_id    uuid references machines(id),
  stage         text not null,       -- predict | investigate | modify | make
  prediction    text,
  actual_output text,
  matched       boolean,
  revealed      boolean not null default false,
  started_at    timestamptz,
  submitted_at  timestamptz default now()
);

create table hypotheses (
  id            uuid primary key default gen_random_uuid(),
  attempt_id    uuid references attempts(id),
  text          text not null,
  created_at    timestamptz default now()
);

create table events (
  id            uuid primary key default gen_random_uuid(),
  session_id    text not null,
  seq           bigint not null,     -- monotonic, NOT a timestamp
  category      text not null,       -- nav | predict | run | paste | idle | error
  payload       jsonb,
  created_at    timestamptz default now()
);

create table schedule (
  machine_id    uuid primary key references machines(id),
  due_at        timestamptz not null,
  interval_days int not null default 1,
  last_result   text
);
```

`seq` is a monotonic counter rather than a timestamp because ordering questions ("was the hypothesis written before or after the fix?") cannot be answered reliably at millisecond resolution.

---

## 8. Open risks

**R1 — PRIMM has never been evaluated on adult self-directed learners.** Every study is a classroom with a teacher present, K-12 or undergrad. No amount of further searching resolves this; only use does. If prediction accuracy doesn't improve over ~20 Machines, the loop isn't working for this population.

**R2 — Authoring cost per Machine is unmeasured.** This is the documented reason PRIMM implementations stall in practice, and I am a single author. Every schedule estimate is fiction until three Machines have been hand-built and timed. Do that before automating anything.

**R3 — Consolidation content has no author.** Productive failure requires an expert explanation after each failure. Writing it myself while being the learner is circular. Likely resolution: AI-generated explanations, reviewed against a runnable check — which makes this an evals problem, conveniently the AI skill actually worth learning.

**R4 — The engagement detector is currently hand-waving.** "Detect a paste" is trivial; "detect a hypothesis written after the fix" requires real event ordering. `seq` exists for this reason but the heuristics are unspecified.

**R5 — Anon key is public in client JS.** With permissive RLS, anyone with the deployed URL could write. Acceptable for a private single-user tool at v1; add Supabase auth before the URL is shared anywhere.

**R6 — Expertise reversal.** Prediction items that teach in week one are busywork by week six. Difficulty adaptation is needed earlier than feels necessary.

---

## 9. What was cut and why

- **"Never reveal the solution"** — removes the mechanism that makes productive failure productive. Replaced with mandatory consolidation.
- **Blanket AI ban** — stricter than the evidence supports, and untenable since professional work uses agents anyway. Replaced with stage-gated assistant modes.
- **Architectural enforcement (regex filters, output validators)** — wrong lever for a single-user app whose user wrote the filter. Replaced with detection and logging.
- **Gamification** — engagement evidence, not learning evidence.
- **React Native** — the pipeline cost exceeded any benefit for a personal tool.

---

## 10. Honest positioning

The stage-gated AI mode is a **safety floor, not the innovation.** The strongest evidence on guardrailed tutors (≈1,000 students) found they eliminate the harm unguarded AI does to later independent performance — but produce no positive effect over learning without AI at all. Guardrails prevent damage. PRIMM is what teaches.

Claiming otherwise would be building on a null result.
