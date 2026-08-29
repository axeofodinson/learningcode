// WRECKAGE verification suite.
//
// Session 01 scenarios A-F are reconstructed here from PROGRESS.md: the
// originals lived in a gitignored .verify/ and did not survive the session.
// Session 02 adds G-L.
//
// Usage: node suite.js http    |    node suite.js file
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const path = require("path");
const fs = require("fs");
const H = require("./harness.js");

const TRANSPORT = process.argv[2] === "file" ? "file" : "http";

// Machine source fixtures. These live in the test, never in the DB or the seed.
const FIXTURES = {
  spin: {
    id: "99999999-9999-9999-9999-999999999999",
    topic: "javascript-basics", ordinal: 1, title: "Fixture: never terminates",
    language: "javascript",
    source_code: 'console.log("before the loop");\nwhile (true) {}\nconsole.log("unreachable");',
    expected_output: "(never)", is_broken: true, bug_note: null,
    explanation: "Fixture machine. It spins forever on purpose."
  }
};

async function openPage(browser, dir, opts = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleErrors = [], pageErrors = [];
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", e => pageErrors.push(String(e)));
  let statics = null, url;
  if (TRANSPORT === "file") {
    url = "file://" + path.join(dir, "index.html");
  } else {
    statics = await H.serveDir(dir);
    url = statics.url;
  }
  await page.goto(url);
  return { ctx, page, consoleErrors, pageErrors, close: async () => { await ctx.close(); if (statics) statics.close(); } };
}

const suites = [];
function scenario(name, fn) { suites.push({ name, fn }); }

// ---------------------------------------------------------------------------
// A — wrong prediction: the full loop, the gate, POST/PATCH shape
// ---------------------------------------------------------------------------
scenario("A · wrong prediction, full loop", async (browser, check) => {
  const stub = await H.startStub();
  const dir = H.workspace({ supabaseUrl: stub.url });
  const p = await openPage(browser, dir);
  try {
    await p.page.waitForSelector("#machine:not([hidden])");
    const seed = H.seedMachine();
    check.eq("source rendered from the migration seed",
      await p.page.textContent("#m-source"), seed.source_code);
    check("run section hidden before submit", await p.page.isHidden("#sec-run"));
    check("submit disabled while empty", await p.page.isDisabled("#btn-submit"));

    await p.page.fill("#prediction", "totally wrong");
    check("submit enabled once typed", !(await p.page.isDisabled("#btn-submit")));
    await p.page.click("#btn-submit");
    check("run section appears after submit", await p.page.isVisible("#sec-run"));
    check("prediction locked", await p.page.getAttribute("#prediction", "readonly") !== null);
    check("result still hidden before run", await p.page.isHidden("#sec-result"));

    await p.page.click("#btn-run");
    await p.page.waitForSelector("#sec-result:not([hidden])", { timeout: 10000 });
    check.eq("verdict is a miss", await p.page.textContent(".verdict"),
      await p.page.evaluate(() => document.querySelector(".verdict").textContent));
    check("verdict has miss class", (await p.page.getAttribute("#verdict", "class")).includes("miss"));
    check.eq("actual output matches the seed", await p.page.textContent("#out-actual"), seed.expected_output);
    check("consolidation forced open on a miss", await p.page.isVisible("#consolidation-direct"));
    check("optional consolidation hidden on a miss", await p.page.isHidden("#consolidation-optional"));

    check.eq("one POST", stub.calls.posts.length, 1);
    const post = stub.calls.posts[0];
    check.eq("POST machine_id", post.machine_id, seed.id);
    check.eq("POST stage", post.stage, "predict");
    check.eq("POST prediction", post.prediction, "totally wrong");
    check("POST has started_at", typeof post.started_at === "string");

    await p.page.waitForFunction(() => true);
    check.eq("one PATCH", stub.calls.patches.length, 1);
    check("PATCH targets the returned row id",
      stub.calls.patches[0].url.includes("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), stub.calls.patches[0].url);
    check.eq("PATCH matched=false", stub.calls.patches[0].body.matched, false);
    check.eq("PATCH actual_output", stub.calls.patches[0].body.actual_output, seed.expected_output);

    // seq monotonic and gap-free
    await p.page.click("#debug-toggle");
    const seqs = await p.page.$$eval(".ev-seq", els => els.map(e => Number(e.textContent)));
    check("debug panel rendered events", seqs.length > 0);
    check("seq monotonic and gap-free",
      seqs.every((v, i) => i === 0 ? true : v === seqs[i-1] + 1), JSON.stringify(seqs));

    check.eq("no console errors", p.consoleErrors, []);
    check.eq("no page errors", p.pageErrors, []);
  } finally { await p.close(); stub.close(); }
});

// ---------------------------------------------------------------------------
// B — correct prediction
// ---------------------------------------------------------------------------
scenario("B · correct prediction", async (browser, check) => {
  const stub = await H.startStub();
  const dir = H.workspace({ supabaseUrl: stub.url });
  const p = await openPage(browser, dir);
  try {
    await p.page.waitForSelector("#machine:not([hidden])");
    const seed = H.seedMachine();
    await p.page.fill("#prediction", seed.expected_output);
    await p.page.click("#btn-submit");
    await p.page.click("#btn-run");
    await p.page.waitForSelector("#sec-result:not([hidden])", { timeout: 10000 });

    check("verdict has match class", (await p.page.getAttribute("#verdict", "class")).includes("match"));
    check("consolidation collapsed, not forced", await p.page.isVisible("#consolidation-optional"));
    check("direct consolidation hidden on a match", await p.page.isHidden("#consolidation-direct"));
    check("details starts closed", !(await p.page.getAttribute("#consolidation-optional", "open")));
    await p.page.click("#consolidation-optional summary");
    check("details expands on click", (await p.page.getAttribute("#consolidation-optional", "open")) !== null);
    check.eq("PATCH matched=true", stub.calls.patches[0].body.matched, true);

    check.eq("no console errors", p.consoleErrors, []);
    check.eq("no page errors", p.pageErrors, []);
  } finally { await p.close(); stub.close(); }
});

// ---------------------------------------------------------------------------
// C — insert returns 500
// ---------------------------------------------------------------------------
scenario("C · insert 500, loop still completes", async (browser, check) => {
  const stub = await H.startStub({ mode: "insert500" });
  const dir = H.workspace({ supabaseUrl: stub.url });
  const p = await openPage(browser, dir);
  try {
    await p.page.waitForSelector("#machine:not([hidden])");
    await p.page.fill("#prediction", "anything");
    await p.page.click("#btn-submit");
    await p.page.click("#btn-run");
    await p.page.waitForSelector("#sec-result:not([hidden])", { timeout: 10000 });
    check("result still shown", await p.page.isVisible("#sec-result"));
    check("consolidation still shown", await p.page.isVisible("#sec-consolidation"));
    await p.page.click("#debug-toggle");
    await p.page.click("#dbg-copy");
    const text = await p.page.evaluate(() => window.WRECKAGE_LAST_COPY);
    check("failure logged as a 500", /insert attempts → 500/.test(text), text.slice(0, 400));
    check("missing attempt id logged as an error", /attempt row not created/.test(text));
    check.eq("no PATCH attempted", stub.calls.patches.length, 0);
    check.eq("no page errors", p.pageErrors, []);
  } finally { await p.close(); stub.close(); }
});

// ---------------------------------------------------------------------------
// D — host unreachable
// ---------------------------------------------------------------------------
scenario("D · host unreachable", async (browser, check) => {
  const dir = H.workspace({ supabaseUrl: "http://127.0.0.1:1" });
  const p = await openPage(browser, dir);
  try {
    await p.page.waitForSelector("#banner:not([hidden])", { timeout: 10000 });
    check("banner instead of a blank page", await p.page.isVisible("#banner"));
    await p.page.click("#debug-toggle");
    await p.page.click("#dbg-copy");
    const text = await p.page.evaluate(() => window.WRECKAGE_LAST_COPY);
    check("network failure logged", /network failure/.test(text), text.slice(0, 400));
    check("debug panel works with no backend", await p.page.isVisible("#debug"));
  } finally { await p.close(); }
});

// ---------------------------------------------------------------------------
// E — 200 with zero rows (the RLS shape)
// ---------------------------------------------------------------------------
scenario("E · 200 with zero rows names RLS", async (browser, check) => {
  const stub = await H.startStub({ mode: "emptyRows" });
  const dir = H.workspace({ supabaseUrl: stub.url });
  const p = await openPage(browser, dir);
  try {
    await p.page.waitForSelector("#banner:not([hidden])", { timeout: 10000 });
    check("banner names RLS", (await p.page.textContent("#banner")).includes("RLS"));
    await p.page.click("#debug-toggle");
    await p.page.click("#dbg-copy");
    const text = await p.page.evaluate(() => window.WRECKAGE_LAST_COPY);
    check("log says EMPTY, check RLS", /EMPTY, no error \(check RLS\)/.test(text), text.slice(0, 400));
  } finally { await p.close(); stub.close(); }
});

// ---------------------------------------------------------------------------
// F — no config.js
// ---------------------------------------------------------------------------
scenario("F · no config.js", async (browser, check) => {
  const dir = H.workspace({ supabaseUrl: null });
  const p = await openPage(browser, dir);
  try {
    await p.page.waitForSelector("#banner:not([hidden])", { timeout: 10000 });
    check("banner points at config.example.js",
      (await p.page.textContent("#banner")).includes("config.example.js"));
    await p.page.click("#debug-toggle");
    check("panel still works", await p.page.isVisible("#debug"));
  } finally { await p.close(); }
});

// ---------------------------------------------------------------------------
// G — comparison policy v1, exercised directly
// ---------------------------------------------------------------------------
scenario("G · comparison policy v1", async (browser, check) => {
  const stub = await H.startStub();
  const dir = H.workspace({ supabaseUrl: stub.url });
  const p = await openPage(browser, dir);
  try {
    await p.page.waitForSelector("#machine:not([hidden])");
    const m = async (a, b) => p.page.evaluate(([x, y]) => window.WRECKAGE_INTERNAL.outputsMatch(x, y), [a, b]);

    check("identical strings match", await m("3\nitem-3", "3\nitem-3"));
    check("trailing whitespace per line ignored", await m("3   \nitem-3\t\ntrue  ", "3\nitem-3\ntrue"));
    check("leading whitespace per line ignored", await m("  3\n   item-3", "3\nitem-3"));
    check("trailing blank lines ignored", await m("3\nitem-3\n\n\n", "3\nitem-3"));
    check("trailing blank lines ignored on the other side", await m("3\nitem-3", "3\nitem-3\n\n"));
    check("trailing whitespace-only lines ignored", await m("3\nitem-3\n   \n\t\n", "3\nitem-3"));
    check("interior blank line is significant", !(await m("3\n\nitem-3", "3\nitem-3")));
    check("interior blank line on the other side is significant", !(await m("3\nitem-3", "3\n\nitem-3")));
    check("leading blank line is significant", !(await m("\n3\nitem-3", "3\nitem-3")));
    check("interior whitespace is NOT collapsed", !(await m("3  3", "3 3")));
    check("line order matters", !(await m("item-3\n3", "3\nitem-3")));
    check("extra line is a miss", !(await m("3\nitem-3\ntrue", "3\nitem-3")));
    check("both empty match", await m("", ""));
    check("empty vs blank lines match", await m("\n\n\n", ""));
    check("empty vs content is a miss", !(await m("", "3")));

    check.eq("normalize drops only trailing blanks",
      await p.page.evaluate(() => window.WRECKAGE_INTERNAL.normalizeOutput(" a \n\n b \n\n\n")),
      ["a", "", "b"]);
    check.eq("policy constant is v1",
      await p.page.evaluate(() => window.WRECKAGE_INTERNAL.MATCH_POLICY), "v1");
    check.eq("timeout constant is 2000",
      await p.page.evaluate(() => window.WRECKAGE_INTERNAL.RUN_TIMEOUT_MS), 2000);
    check.eq("no page errors", p.pageErrors, []);
  } finally { await p.close(); stub.close(); }
});

// ---------------------------------------------------------------------------
// H — trailing whitespace through the real UI: now a match
// ---------------------------------------------------------------------------
scenario("H · trailing whitespace per line → match (UI)", async (browser, check) => {
  const stub = await H.startStub();
  const dir = H.workspace({ supabaseUrl: stub.url });
  const p = await openPage(browser, dir);
  try {
    await p.page.waitForSelector("#machine:not([hidden])");
    const seed = H.seedMachine();
    const padded = seed.expected_output.split("\n").map((l, i) => l + (i % 2 ? "\t " : "   ")).join("\n");
    check("fixture really differs byte-wise", padded !== seed.expected_output);
    await p.page.fill("#prediction", padded);
    await p.page.click("#btn-submit");
    await p.page.click("#btn-run");
    await p.page.waitForSelector("#sec-result:not([hidden])", { timeout: 10000 });
    check("verdict is a match", (await p.page.getAttribute("#verdict", "class")).includes("match"));
    check.eq("PATCH matched=true", stub.calls.patches[0].body.matched, true);
    check.eq("no page errors", p.pageErrors, []);
  } finally { await p.close(); stub.close(); }
});

// ---------------------------------------------------------------------------
// I — trailing blank lines through the real UI: now a match
// ---------------------------------------------------------------------------
scenario("I · trailing blank lines → match (UI)", async (browser, check) => {
  const stub = await H.startStub();
  const dir = H.workspace({ supabaseUrl: stub.url });
  const p = await openPage(browser, dir);
  try {
    await p.page.waitForSelector("#machine:not([hidden])");
    const seed = H.seedMachine();
    await p.page.fill("#prediction", seed.expected_output + "\n\n\n");
    await p.page.click("#btn-submit");
    await p.page.click("#btn-run");
    await p.page.waitForSelector("#sec-result:not([hidden])", { timeout: 10000 });
    check("verdict is a match", (await p.page.getAttribute("#verdict", "class")).includes("match"));
    check.eq("PATCH matched=true", stub.calls.patches[0].body.matched, true);
    check.eq("no page errors", p.pageErrors, []);
  } finally { await p.close(); stub.close(); }
});

// ---------------------------------------------------------------------------
// J — interior blank line through the real UI: still a miss
// ---------------------------------------------------------------------------
scenario("J · interior blank line → still a miss (UI)", async (browser, check) => {
  const stub = await H.startStub();
  const dir = H.workspace({ supabaseUrl: stub.url });
  const p = await openPage(browser, dir);
  try {
    await p.page.waitForSelector("#machine:not([hidden])");
    const seed = H.seedMachine();
    const lines = seed.expected_output.split("\n");
    const withGap = [lines[0], "", ...lines.slice(1)].join("\n");
    await p.page.fill("#prediction", withGap);
    await p.page.click("#btn-submit");
    await p.page.click("#btn-run");
    await p.page.waitForSelector("#sec-result:not([hidden])", { timeout: 10000 });
    check("verdict is a miss", (await p.page.getAttribute("#verdict", "class")).includes("miss"));
    check("consolidation forced open", await p.page.isVisible("#consolidation-direct"));
    check.eq("PATCH matched=false", stub.calls.patches[0].body.matched, false);
    check.eq("no page errors", p.pageErrors, []);
  } finally { await p.close(); stub.close(); }
});

// ---------------------------------------------------------------------------
// K — match_policy on every attempt write
// ---------------------------------------------------------------------------
scenario("K · match_policy = 'v1' on every write", async (browser, check) => {
  const stub = await H.startStub();
  const dir = H.workspace({ supabaseUrl: stub.url });
  const p = await openPage(browser, dir);
  try {
    await p.page.waitForSelector("#machine:not([hidden])");
    await p.page.fill("#prediction", "nope");
    await p.page.click("#btn-submit");
    await p.page.waitForFunction(() => true);
    check.eq("match_policy present in the POST body", stub.calls.posts[0].match_policy, "v1");
    await p.page.click("#btn-run");
    await p.page.waitForSelector("#sec-result:not([hidden])", { timeout: 10000 });
    check.eq("match_policy present in the PATCH body", stub.calls.patches[0].body.match_policy, "v1");
    check("migration declares the column", H.migrationHasMatchPolicy());
    check.eq("no page errors", p.pageErrors, []);
  } finally { await p.close(); stub.close(); }
});

// ---------------------------------------------------------------------------
// L — while (true) {} times out, worker terminated, row written, page alive
// ---------------------------------------------------------------------------
scenario("L · non-terminating machine", async (browser, check) => {
  const stub = await H.startStub({ machine: FIXTURES.spin });
  const dir = H.workspace({ supabaseUrl: stub.url });
  const p = await openPage(browser, dir);
  try {
    await p.page.waitForSelector("#machine:not([hidden])");
    check("fixture source is the spinning one",
      (await p.page.textContent("#m-source")).includes("while (true) {}"));
    await p.page.fill("#prediction", "before the loop");
    await p.page.click("#btn-submit");

    const t0 = Date.now();
    await p.page.click("#btn-run");

    // The main thread must stay live while the worker spins.
    const ticks = await p.page.evaluate(async () => {
      let n = 0;
      const id = setInterval(() => n++, 50);
      await new Promise(r => setTimeout(r, 1200));
      clearInterval(id);
      return n;
    });
    check("main thread kept running while the machine spun", ticks >= 10, "ticks=" + ticks);

    await p.page.waitForSelector("#sec-result:not([hidden])", { timeout: 15000 });
    const elapsed = Date.now() - t0;
    check("returned after roughly the timeout, not never",
      elapsed >= 1800 && elapsed < 8000, "elapsed=" + elapsed + "ms");

    check("verdict names non-termination",
      (await p.page.textContent("#verdict")).includes("did not terminate"),
      await p.page.textContent("#verdict"));
    check.eq("actual output is the did-not-terminate result",
      await p.page.textContent("#out-actual"), "Did not terminate within 2000ms.");
    check("output is not empty", (await p.page.textContent("#out-actual")).length > 0);
    check("consolidation shown", await p.page.isVisible("#sec-consolidation"));

    check.eq("attempt row still written", stub.calls.patches.length, 1);
    check.eq("PATCH records the did-not-terminate output",
      stub.calls.patches[0].body.actual_output, "Did not terminate within 2000ms.");
    check.eq("PATCH matched=false", stub.calls.patches[0].body.matched, false);
    check.eq("PATCH carries match_policy", stub.calls.patches[0].body.match_policy, "v1");

    // page is still fully interactive afterwards
    await p.page.click("#debug-toggle");
    check("page still responsive after the terminate", await p.page.isVisible("#debug"));
    await p.page.click("#dbg-copy");
    const text = await p.page.evaluate(() => window.WRECKAGE_LAST_COPY);
    check("timeout logged as a run event", /did not terminate/.test(text), text.slice(-600));

    // a fresh run still works after a terminate — the runner is not poisoned
    const after = await p.page.evaluate(() =>
      window.WRECKAGE_INTERNAL.runSource('console.log("still alive");').then(r => r.output));
    check.eq("runner still usable after a terminate", after, "still alive");

    check.eq("no page errors", p.pageErrors, []);
  } finally { await p.close(); stub.close(); }
});

// ---------------------------------------------------------------------------
// M — old runner vs new runner: byte-identical output
// ---------------------------------------------------------------------------
scenario("M · old and new runners agree byte-for-byte", async (browser, check) => {
  const oldRunner = fs.readFileSync(path.join(__dirname, "old-runner.js"), "utf8");
  const stub = await H.startStub();
  const dir = H.workspace({ supabaseUrl: stub.url });
  const p = await openPage(browser, dir);
  try {
    await p.page.waitForSelector("#machine:not([hidden])");
    await p.page.addScriptTag({ content: oldRunner });
    check("old runner loaded", await p.page.evaluate(() => typeof window.OLD_runSource === "function"));

    const cases = {
      "machine 1 (the seed)": H.seedMachine().source_code,
      "throws": 'console.log("a");\nnull.x;',
      "logs an object": 'console.log({ n: 3 });',
      "logs an array": 'console.log([1, "two", null]);',
      "multiple args": 'console.log(1, "a", true, null, undefined);',
      "no output": 'var x = 1;',
      "syntax error": 'const = = ;',
      "logs a blank line": 'console.log("a");console.log("");console.log("b");',
      "only console.log captured": 'console.warn("w");console.error("e");console.info("i");console.log("only me");'
    };

    for (const [name, src] of Object.entries(cases)) {
      const both = await p.page.evaluate(async (s) => {
        const oldR = window.OLD_runSource(s);
        const newR = await window.WRECKAGE_INTERNAL.runSource(s);
        return { old: oldR.output, neu: newR.output, oldLines: oldR.lineCount, newLines: newR.lineCount };
      }, src);
      check(`byte-identical output — ${name}`, both.old === both.neu,
        `old=${JSON.stringify(both.old)} new=${JSON.stringify(both.neu)}`);
      check(`same line count — ${name}`, both.oldLines === both.newLines,
        `old=${both.oldLines} new=${both.newLines}`);
    }

    // and the seed's output still equals what the migration claims
    const out = await p.page.evaluate(s => window.WRECKAGE_INTERNAL.runSource(s).then(r => r.output),
      H.seedMachine().source_code);
    check.eq("worker output equals the migration's expected_output", out, H.seedMachine().expected_output);
    check.eq("no page errors", p.pageErrors, []);
  } finally { await p.close(); stub.close(); }
});

// ---------------------------------------------------------------------------
(async () => {
  const browser = await chromium.launch();
  let pass = 0, fail = 0;
  const failures = [];
  console.log(`\n=== WRECKAGE verification — ${TRANSPORT}:// ===\n`);
  for (const s of suites) {
    const check = H.makeChecker(s.name);
    try {
      await s.fn(browser, check);
    } catch (err) {
      check("scenario completed without throwing", false, String(err && err.stack || err));
    }
    const bad = check.results.filter(r => !r.ok);
    pass += check.results.length - bad.length;
    fail += bad.length;
    console.log(`${bad.length ? "FAIL" : "ok  "}  ${s.name}  (${check.results.length - bad.length}/${check.results.length})`);
    for (const b of bad) { failures.push(`${s.name} → ${b.name}: ${b.detail}`); console.log(`        ✗ ${b.name}: ${b.detail}`); }
  }
  await browser.close();
  console.log(`\n${TRANSPORT}://  ${pass}/${pass + fail} checks pass, ${fail} failing\n`);
  if (failures.length) process.exitCode = 1;
})();
