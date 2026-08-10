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

Session 2: log view reading from `attempts` and `events`.

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
