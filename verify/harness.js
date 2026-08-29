// Shared harness: seed parsed out of the real migration, stub PostgREST,
// scenario workspaces built from the real index.html.
const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");

const REPO = path.resolve(__dirname, "..");
const SQL = path.join(REPO, "migrations", "001_init.sql");
const INDEX = path.join(REPO, "index.html");

// ---- parse the seed straight out of 001_init.sql so tests can never drift ---
function dollarBlock(sql, tag) {
  const open = `$${tag}$`;
  const a = sql.indexOf(open);
  if (a < 0) throw new Error("no " + open + " block in the migration");
  const b = sql.indexOf(open, a + open.length);
  if (b < 0) throw new Error("unterminated " + open + " block");
  return sql.slice(a + open.length, b);
}

function seedMachine() {
  const sql = fs.readFileSync(SQL, "utf8");
  return {
    id: "11111111-2222-3333-4444-555555555555",
    topic: "javascript-basics",
    ordinal: 1,
    title: "Three pushes, one object",
    language: "javascript",
    source_code: dollarBlock(sql, "src"),
    expected_output: dollarBlock(sql, "out"),
    is_broken: false,
    bug_note: null,
    explanation: dollarBlock(sql, "exp")
  };
}

function migrationHasMatchPolicy() {
  const sql = fs.readFileSync(SQL, "utf8");
  return /match_policy\s+text/.test(sql);
}

// ---- stub PostgREST ---------------------------------------------------------
// mode: "ok" | "insert500" | "emptyRows"
function startStub(opts = {}) {
  const mode = opts.mode || "ok";
  const machine = opts.machine || seedMachine();
  const calls = { posts: [], patches: [], gets: [] };

  const server = http.createServer((req, res) => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
      "Access-Control-Expose-Headers": "*"
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      const send = (code, obj) =>
        res.writeHead(code, Object.assign({ "Content-Type": "application/json" }, cors))
           .end(obj === undefined ? "" : JSON.stringify(obj));

      if (req.url.startsWith("/rest/v1/machines")) {
        calls.gets.push(req.url);
        if (mode === "emptyRows") return send(200, []);
        return send(200, [machine]);
      }
      if (req.url.startsWith("/rest/v1/attempts") && req.method === "POST") {
        calls.posts.push(JSON.parse(body || "{}"));
        if (mode === "insert500") return send(500, { message: "boom" });
        return send(201, [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }]);
      }
      if (req.url.startsWith("/rest/v1/attempts") && req.method === "PATCH") {
        calls.patches.push({ url: req.url, body: JSON.parse(body || "{}") });
        return send(200, [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }]);
      }
      send(404, { message: "no route" });
    });
  });

  return new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ port, url: `http://127.0.0.1:${port}`, calls, close: () => server.close() });
    });
  });
}

// ---- scenario workspace -----------------------------------------------------
// A directory holding the real index.html plus (optionally) a config.js.
let wsCount = 0;
function workspace(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wreckage-ws-${wsCount++}-`));
  fs.copyFileSync(INDEX, path.join(dir, "index.html"));
  if (opts.supabaseUrl !== null) {
    fs.writeFileSync(path.join(dir, "config.js"),
      `window.WRECKAGE_CONFIG = { SUPABASE_URL: ${JSON.stringify(opts.supabaseUrl)}, SUPABASE_ANON_KEY: "test-anon-key" };\n`);
  }
  return dir;
}

// ---- static server for the http:// suite -----------------------------------
function serveDir(dir) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]);
    const file = path.join(dir, rel === "/" ? "index.html" : rel);
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      const type = file.endsWith(".js") ? "text/javascript" : "text/html";
      res.writeHead(200, { "Content-Type": type });
      res.end(buf);
    });
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () =>
    r({ url: `http://127.0.0.1:${server.address().port}/index.html`, close: () => server.close() })));
}

// ---- assertions -------------------------------------------------------------
function makeChecker(label) {
  const results = [];
  function check(name, cond, detail) {
    results.push({ name, ok: !!cond, detail: cond ? "" : (detail === undefined ? "" : String(detail)) });
  }
  check.eq = (name, actual, expected) =>
    check(name, Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected),
          `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  check.results = results;
  check.label = label;
  return check;
}

module.exports = { seedMachine, migrationHasMatchPolicy, startStub, workspace, serveDir, makeChecker, REPO, INDEX, SQL };
