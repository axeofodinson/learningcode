-- WRECKAGE — 001_init
-- Run this in the Supabase SQL Editor.
--
-- Creates every table from section 7 of WRECKAGE_v1.md, enables RLS on all of
-- them, and adds permissive anon policies. This is deliberate for v1: single
-- user, private URL, no auth. It is risk R5 in the spec — anyone with the
-- deployed URL and the anon key can read and write. Add Supabase auth and
-- tighten these policies before the URL is shared anywhere.
--
-- Safe to re-run: creates are guarded, policies are dropped first, and the
-- seed uses on conflict do nothing.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists machines (
  id              uuid primary key default gen_random_uuid(),
  topic           text not null,
  ordinal         int  not null,
  title           text not null,
  language        text not null default 'javascript',
  source_code     text not null,
  expected_output text not null,
  is_broken       boolean not null default false,
  bug_note        text,                -- hidden until consolidation
  explanation     text,                -- shown at consolidation
  created_at      timestamptz default now(),
  unique (topic, ordinal)
);

create table if not exists attempts (
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

create table if not exists hypotheses (
  id            uuid primary key default gen_random_uuid(),
  attempt_id    uuid references attempts(id),
  text          text not null,
  created_at    timestamptz default now()
);

create table if not exists events (
  id            uuid primary key default gen_random_uuid(),
  session_id    text not null,
  seq           bigint not null,     -- monotonic, NOT a timestamp
  category      text not null,       -- nav | predict | run | paste | idle | error
  payload       jsonb,
  created_at    timestamptz default now()
);

create table if not exists schedule (
  machine_id    uuid primary key references machines(id),
  due_at        timestamptz not null,
  interval_days int not null default 1,
  last_result   text
);

-- ---------------------------------------------------------------------------
-- RLS — permissive for v1 (risk R5)
-- ---------------------------------------------------------------------------

alter table machines   enable row level security;
alter table attempts   enable row level security;
alter table hypotheses enable row level security;
alter table events     enable row level security;
alter table schedule   enable row level security;

drop policy if exists anon_all_machines   on machines;
drop policy if exists anon_all_attempts   on attempts;
drop policy if exists anon_all_hypotheses on hypotheses;
drop policy if exists anon_all_events     on events;
drop policy if exists anon_all_schedule   on schedule;

create policy anon_all_machines   on machines   for all to anon, authenticated using (true) with check (true);
create policy anon_all_attempts   on attempts   for all to anon, authenticated using (true) with check (true);
create policy anon_all_hypotheses on hypotheses for all to anon, authenticated using (true) with check (true);
create policy anon_all_events     on events     for all to anon, authenticated using (true) with check (true);
create policy anon_all_schedule   on schedule   for all to anon, authenticated using (true) with check (true);

-- Table privileges are separate from RLS. Supabase normally grants these by
-- default; stated explicitly so a missing grant cannot masquerade as an RLS
-- failure (an empty result with no error, which the debug panel is built to
-- make visible).
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete
  on machines, attempts, hypotheses, events, schedule
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed — Machine 1. Not broken (spec hard rule 3: the first Machine in a
-- topic is never broken).
-- ---------------------------------------------------------------------------

insert into machines (topic, ordinal, title, language, source_code, expected_output, is_broken, explanation)
values (
  'javascript-basics',
  1,
  'Three pushes, one object',
  'javascript',
$src$const rows = [];
const row = { n: 0, label: "" };

for (let i = 1; i <= 3; i++) {
  row.n = i;
  row.label = "item-" + i;
  rows.push(row);
}

console.log(rows.length);
console.log(rows[0].label);
console.log(rows[0] === rows[2]);

const copies = rows.map(r => ({ ...r }));
copies[0].n = 99;
console.log(rows[0].n, copies[1].n);$src$,
$out$3
item-3
true
3 3$out$,
  false,
$exp$There is only one object in this program. `row` is created once, before the loop, and `rows.push(row)` stores a reference to it rather than a copy of it. So after three iterations `rows` has a length of 3, but all three slots point at the same object — which is why `rows[0] === rows[2]` is true. Each iteration overwrites that single object's fields, so the last write wins and every slot reads back as the state left by `i = 3`: `rows[0].label` is "item-3", not "item-1". The final two lines separate the two ideas. `rows.map(r => ({ ...r }))` builds genuinely new objects by spreading each one's fields into a fresh object literal, so `copies` holds three independent objects that happen to have identical contents. Assigning `copies[0].n = 99` therefore changes only that copy: `rows[0].n` is still 3, and `copies[1].n` is still 3, printing "3 3". The mechanism to hold onto is that a variable bound to an object holds a reference, and assignment, `push`, and argument passing all copy the reference, never the object. Making a copy is something you have to ask for explicitly.$exp$
)
on conflict (topic, ordinal) do nothing;
