# verify

Headless-Chromium verification for WRECKAGE. Not a project dependency: no
`package.json`, no `node_modules`, no install step. It resolves Playwright from
the global install in the dev environment.

    node verify/suite.js http     # served over http://
    node verify/suite.js file     # opened over file:// — the real workflow

Both must pass. `file://` matters separately: it is cross-origin to Supabase
(so every request is preflighted), has no `navigator.clipboard`, and puts the
page on an opaque origin, which is what makes the Worker runner worth
re-checking there rather than assuming.

- `harness.js` — stub PostgREST, scenario workspaces, and the seed **parsed out
  of `migrations/001_init.sql`** so a test can never assert against a stale copy
  of the machine.
- `suite.js` — scenarios A–M. A–F are the session-01 loop and failure modes;
  G–M are the session-02 comparison policy, `match_policy`, the worker runner
  and its timeout.
- `old-runner.js` — generated, not hand-written. Run `node
  verify/make-old-runner.js` to regenerate it from the pinned session-01 commit.

Machine sources used by tests (the non-terminating one, for instance) are
fixtures inside `suite.js`. They are never seeded and never written to the
database.

## Re-checking the migration

The suite does not touch PostgreSQL. To re-verify `001_init.sql`, apply it to a
scratch cluster two or three times over and confirm it stays clean and that
`machines` still holds exactly one row.
