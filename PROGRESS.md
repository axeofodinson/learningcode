# WRECKAGE — progress

## Session 01 — the predict → run → compare → consolidate loop

### What works

The whole loop, end to end. Open `index.html`, read the machine, write a
prediction, submit it, run it, see both outputs side by side, read the
explanation.

- **Schema.** `migrations/001_init.sql` creates all five tables from spec
  section 7, enables RLS on each, and adds permissive `anon`/`authenticated`
  policies plus explicit table grants. Re-runnable. Seeds one machine.
- **Machine 1** — `javascript-basics` #1, *Three pushes, one object*. Not
  broken (hard rule 3). Fifteen lines. The mechanism is reference semantics:
  one object pushed three times, so all three slots alias, then `map` with a
  spread to show what an actual copy looks like. `expected_output` is the real
  output, verified by execution, not by hand.
- **Four states**, gated in that order: Read → Submitted → Result →
  Consolidation. Submit is disabled while the textarea is empty. Run does not
  exist until a prediction is submitted. The prediction goes read-only on
  submit.
- **Execution.** `console.log` swapped for a collector, source run through
  `new Function`, original restored in a `finally`. A thrown error is caught
  and becomes the output line (`Name: message`).
- **Consolidation.** Forced open on a miss (hard rule 2). On a match it is a
  collapsed `<details>` you can expand.
- **Persistence.** `POST /attempts` on submit (`machine_id`, `stage='predict'`,
  `prediction`, `started_at` = when the source rendered), `PATCH` on run
  (`actual_output`, `matched`). Raw `fetch` against PostgREST, no
  `supabase-js`. Fire-and-forget: every failure path still shows the result.
- **Debug panel.** 500-event in-memory ring, monotonic `seq`, categories
  `nav|predict|run|paste|error|net`. Toggled by the corner button or
  <kbd>Ctrl</kbd>+<kbd>`</kbd>. Global `error` and `unhandledrejection`
  handlers. Every REST call logs table, op, HTTP status, row count, ms and
  error body through one wrapper. Copy-all with a `document.execCommand`
  fallback for `file://`, where `navigator.clipboard` is not available.
- **Zero dependencies, zero build step, no CDN.** One HTML file plus a
  gitignored `config.js`.

### What was verified, and how

Two headless-Chromium suites (Playwright, installed globally in the dev
environment — *not* a project dependency) against a stub PostgREST server that
serves the seed **parsed out of `001_init.sql`**, so the tests check the real
seeded values rather than a copy that could drift.

**66/66 checks pass over `http://`, 8/8 over `file://`. Zero console errors and
zero page errors in every scenario.**

| Scenario | What it proves |
|---|---|
| A — wrong prediction | Full loop. Gate holds (result hidden until run). POST body correct, PATCH targets the returned row id and carries `matched=false`. `seq` monotonic and gap-free. Copy-all lands on the clipboard. |
| B — correct prediction | `matched=true`, consolidation collapsed rather than forced, expands on click. Paste into the field is logged as a `paste` event. |
| C — insert returns 500 | Result and consolidation still shown. Failure logged as `insert attempts → 500 · FAILED`, and the missing attempt id is logged as an error. |
| D — host unreachable | Banner instead of a blank page; `network failure` in the log; debug panel works with no backend at all. |
| E — 200 with zero rows | The RLS-shaped failure. Log says `EMPTY, no error (check RLS)` and the banner names RLS. |
| F — no `config.js` | Banner points at `config.example.js`. Panel still works. |

The migration was **run against a real PostgreSQL 16 cluster**, not just read:
applies clean, is idempotent (two runs, still one machine row), all five tables
report `rowsecurity = t`, and acting as `set role anon` I could read `machines`
and insert into `attempts`, `events`, `hypotheses` and `schedule` — so the
policies and grants both work. `source_code` was then pulled back out of
Postgres, executed, and its output compared to the stored `expected_output`:
identical. The dollar-quoting survives the round trip.

The `file://` suite matters separately because that is the actual workflow —
it is cross-origin to Supabase (preflight) and has no clipboard API.

### Next

Session 2: corrections — comparison policy, worker runner. (Done; see below.)

### Surprising / worth knowing

- **The spec has five tables, not six.** The session brief said "all six tables
  from section 7" and then listed five, which is what section 7 contains. Built
  five. Flagging in case a sixth was intended and got lost.
- **`WRECKAGE_v1.md` did not exist in the repo** — the repo was empty at session
  start. Committed the spec verbatim so the reference the brief points at is
  actually there.
- **Exact-match comparison is too strict, as expected.** `prediction.trim() ===
  actual.trim()`. Trailing whitespace on one line, `"3 3"` vs `"3  3"`, or
  quoting a string marks a real understanding as a miss. This will cause false
  misses and needs fuzzier comparison — probably line-wise, whitespace-collapsed,
  with an "I was basically right" override that is itself a logged event.
- **`console.log` formatting is mine, not the browser's.** Strings print raw,
  objects go through `JSON.stringify`, so an object prints `{"n":3}` where
  DevTools shows `{n: 3}` and Node shows `{ n: 3 }`. Machine 1 only logs
  primitives so it does not bite yet, but any machine that logs an object will
  make the prediction target ambiguous. Decide on one canonical format before
  authoring such a machine.
- **`new Function` runs on the main thread, so an infinite loop hangs the tab.**
  Fine for a hand-authored clean machine; a real hazard from Machine 2 onward,
  when machines are deliberately broken. A worker with a timeout is the fix, and
  session 3 is when it starts to matter.
- **Only `console.log` is captured** — not `warn`, `error`, `info`, or the value
  of the last expression.
- **`revealed` is never set.** The column exists but nothing writes it; there is
  no separate escape hatch yet, since consolidation currently fires
  automatically on a miss. It becomes real when reveal-before-run exists.
- **Events are in-memory only.** Nothing writes the `events` table yet. The ring
  buffer has the right shape (`session_id`, `seq`, `category`, `payload`) so
  persisting it later is a copy, not a redesign. `seq` deliberately does **not**
  reset when the buffer is cleared.
- **`elapsed_ms` is recorded on every prediction** (source render → submit) but
  nothing acts on it. That is the raw signal the sub-5-second heuristic needs;
  the heuristic itself is deliberately not built.
- **Commit SHA is a hand-filled `<meta>` tag**, empty by default and displayed as
  `unknown (no build step)`. Any automatic version of this is a build step, which
  the spec rules out.
- **The anon key is public.** Risk R5, accepted for v1. Anyone with the URL and
  the key can read and write every table. Add Supabase auth before the URL goes
  anywhere.

### Setup

1. Run `migrations/001_init.sql` in the Supabase SQL Editor.
2. `cp config.example.js config.js` and fill in `SUPABASE_URL` and
   `SUPABASE_ANON_KEY`. `config.js` is gitignored.
3. Open `index.html`.

---

## Session 02 — corrections: comparison policy, worker runner

Corrections only. No new features.

### What works

- **Comparison policy v1.** `prediction.trim() === actual.trim()` is gone. Both
  sides are split on newline, each line is trimmed, trailing empty lines are
  dropped, and the resulting arrays are compared element-wise and exactly.
  Interior blank lines are significant. Leading blank lines are significant.
  Whitespace *inside* a line is significant — `3 3` and `3  3` are still
  different outputs, deliberately. The policy is two small pure functions,
  `normalizeOutput` and `outputsMatch`, with the rule written above them.
- **`match_policy`.** New nullable `text` column on `attempts`, added by editing
  `migrations/001_init.sql` directly — no 002, since nothing is deployed. Both
  attempt writes (the `POST` on submit and the `PATCH` on run) carry
  `match_policy: 'v1'` from a single `MATCH_POLICY` constant. When the policy
  changes, that constant changes with it and old `matched` values keep the
  meaning they were written with.
- **Execution moved off the main thread.** `new Function` on the main thread is
  replaced by a classic Worker built from a blob URL, with a hard
  `RUN_TIMEOUT_MS = 2000` timeout in one named constant at the top of the
  script. On timeout the worker is terminated and the run resolves with a real
  result — `actual_output` is `"Did not terminate within 2000ms."`, the verdict
  reads *The machine did not terminate*, consolidation opens, and the attempt
  row is still written with `matched=false` and `match_policy='v1'`. Not a
  crash, not an empty output.
- **Identical collector semantics.** The collector inside the worker is
  character-for-character the session-01 collector: same `formatArg`, same
  `join(" ")`, same error-becomes-the-last-output-line rule, still only
  `console.log`. `runSource` returns a Promise now, so the run handler is
  asynchronous; the run hint reads "Running…" while a machine is in flight.
- **Log formatting documented.** One line of help text under the prediction
  textarea: strings print raw without quotes, objects and arrays print as JSON,
  so `{"n":3}` and not `{n: 3}`. No behaviour change, no CSS added.

### What was verified, and how

**Before building the worker**, a spike checked whether Chromium would allow it
over `file://`, since a page opened from disk is on an opaque origin. Result
matrix, headless Chromium, default launch flags:

| construction | `file://` | `http://` |
|---|---|---|
| classic worker from a blob URL | **works** | works |
| worker from a `data:` URL | works | works |
| **module** worker from a blob URL | `onerror`, no message | works |
| blob worker with a syntax error | `onerror` with the real `SyntaxError` | same |

So the runner uses a **classic** blob worker. A module worker would have been
blocked; that is the one thing on the opaque `file:` origin that does not work.
Separately verified over `file://`: during a `while (true) {}` spin the main
thread kept ticking (19 ticks in 1000ms), `terminate()` returned in 0.10ms, and
a fresh worker constructed straight afterwards still ran.

**116/116 checks pass over `http://`, 116/116 over `file://`. Zero console
errors and zero page errors in every scenario.**

Scenarios A–F are the session-01 loop and failure modes; G–M are new.

| Scenario | What it proves |
|---|---|
| A–F | Unchanged from session 01: full loop, gate, POST/PATCH shape, monotonic `seq`, insert-500, unreachable host, empty-200/RLS, missing `config.js`. |
| G | The policy itself, 19 cases: trailing whitespace and trailing blank lines ignored on either side; interior and leading blank lines significant; interior whitespace *not* collapsed; order and line count significant. |
| H | Trailing whitespace per line, through the real UI → now a match, `PATCH matched=true`. |
| I | Trailing blank lines, through the real UI → now a match. |
| J | An interior blank line, through the real UI → still a miss, consolidation forced. |
| K | `match_policy='v1'` in the POST body and the PATCH body, and the column present in the migration. |
| L | A `while (true) {}` fixture: times out at ~2s, worker terminated, "did not terminate" recorded as the output, attempt row written, main thread ticking throughout, debug panel and copy-all still work afterwards, and a fresh run still succeeds. |
| M | The old and new runners produce **byte-identical** output across 9 sources — the seed, a throw, an object, an array, multiple args, no output, a syntax error, a blank interior line, and non-`log` console methods. Same line counts. The worker's output also equals the migration's stored `expected_output`. |

The old runner in scenario M is not retyped: `verify/make-old-runner.js`
extracts it verbatim from commit `73d7f69`, so the comparison is against the
code actually replaced.

The edited migration was **re-applied to a real PostgreSQL 16 cluster**:

- Applies clean three times in a row; `machines` still holds exactly one row.
- `attempts.match_policy` is `text`, nullable, positioned after `matched`.
- All five tables still report `rowsecurity = t`; as `anon` I inserted and
  updated rows carrying `match_policy='v1'`, and a write that omits it still
  lands as `NULL`.
- Applied on top of a database built from the **session-01** migration, the
  `alter table attempts add column if not exists match_policy text` actually
  adds the column — so that line is not dead code, and 001 is re-runnable
  against either shape.
- `source_code` and `expected_output` pulled back out of Postgres are
  byte-identical to the file: the dollar-quoting still survives the round trip.

### Surprising / worth knowing

- **The session-01 Playwright suites did not exist.** They lived in `.verify/`,
  which is gitignored, so they were gone. Scenarios A–F here are reconstructed
  from the session-01 PROGRESS entry, not recovered. The suite now lives in
  **`verify/` (no dot) and is committed**, so session 03 can genuinely extend it
  rather than rebuild it. This is the one thing I added that the brief did not
  list; drop the directory if you disagree.
- **My first worker spike said `file://` was blocked, and it was wrong.** The
  spike constructed a worker whose only job was to reply to a message, and then
  never sent it one. Silent timeout, which reads exactly like an origin
  restriction. Worth remembering that the failure mode being tested for and a
  bug in the test look identical here.
- **`new Function` still exists — inside the worker.** Inlining the machine
  source into the worker script would turn a machine's syntax error into a
  worker load failure instead of a `SyntaxError: ...` output line, which would
  change `matched` outcomes. The brief required the collector semantics to be
  unchanged, so the source is still evaluated with `new Function`, just off the
  main thread. The change is *where* execution happens and that it can be
  killed, not how the source is evaluated.
- **Output produced before a hang is lost.** A machine that logs three lines and
  then spins reports only "Did not terminate within 2000ms." — the worker is
  terminated before it can post anything back. Streaming each line out of the
  worker as it is logged would fix it, and would also let a partial output be
  shown. Not built.
- **"It hangs" is not a predictable outcome.** On a timeout `matched` is forced
  to `false`, so a learner who correctly predicts that a machine never
  terminates is recorded as wrong. There is no way to express that prediction
  yet. This is adjacent to the "I was basically right" override and deliberately
  not built.
- **A module worker is the one thing `file://` refuses.** If a future session
  wants `import` inside the runner, it will not work from disk. Classic worker
  only.
- **`RUN_TIMEOUT_MS` is also a floor on a legitimately slow machine.** 2000ms is
  generous for hand-authored teaching machines, but a machine doing real work
  would be recorded as non-terminating. One constant to change if that day
  comes.
- **The comparison policy is still strict inside a line.** `3 3` vs `3  3` is
  still a miss, by explicit instruction. The false-miss complaint from session
  01 is only partly addressed: trailing whitespace and trailing blank lines no
  longer bite, quoting and interior spacing still do.
- **`window.WRECKAGE_INTERNAL` is a test seam.** `normalizeOutput`,
  `outputsMatch`, `runSource` and the three constants are exposed so the suite
  can exercise the policy and the runner directly instead of driving the whole
  UI for each of 19 comparison cases. It is inert in normal use.

### Next

Session 3: the log view reading from `attempts` and `events`.
