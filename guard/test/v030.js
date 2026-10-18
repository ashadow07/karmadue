"use strict";
// 0.3.0: local-only log (no network upload, no private names/URLs), stats command, install outcome, opt-out.
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const { run, sandbox, check, done } = require("./helpers");
(async () => {
  const seen = [];
  const srv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { seen.push({ url: req.url, ...JSON.parse(b || "{}") }); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, data: { decision: "no_known_issues", enforce: "proceed_with_care", headline: "No advisories." }, request_id: "r1" })); }); });
  await new Promise((r) => srv.listen(0, r));
  const API = `http://127.0.0.1:${srv.address().port}`;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kd-log-")); fs.writeFileSync(path.join(cwd, ".npmrc"), "@acme:registry=https://npm.acme.internal/\n"); process.chdir(cwd);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "kd-lh-")); const LOG = path.join(home, "guard-log.jsonl");
  const E = { KARMADUE_API: API, KARMADUE_DETAIL: "", KARMADUE_NO_CACHE: "", KARMADUE_HOME: home };
  const rows = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  // 1. clean network check, then cache hit
  await run(["check", "npm install is-number@7.0.0"], E);
  await run(["check", "npm install is-number@7.0.0"], E);
  let r = rows();
  check("log: one line per check with eco, pkg, verdict, cache, ms", r.length === 2 && r[0].eco === "npm" && r[0].pkg === "is-number" && r[0].verdict === "clean" && r[0].cache === "miss" && Number.isFinite(r[0].ms) && r[0].t, JSON.stringify(r));
  check("log: second check is a cache hit", r[1].cache === "hit", JSON.stringify(r[1]));
  check("log: file is mode 600", (fs.statSync(LOG).mode & 0o777) === 0o600);
  // 2. trap -> fix_first
  await run(["check", "pip install sklearn"], E);
  r = rows(); const sk = r.find((x) => x.pkg === "sklearn");
  check("log: blocking known trap logged as block", sk && sk.verdict === "block" && sk.cache === "hit" && sk.ms === 0, JSON.stringify(r));
  // 3. privacy: private scope + custom registry/index never named
  const before = rows().length; seen.length = 0;
  await run(["check", "npm install @acme/secret-thing@1.0.0 is-odd@3.0.1"], E);
  await run(["check", "pip install --index-url https://pypi.corp.example/simple corp-internal-pkg"], E);
  await run(["check", "npm install corp-thing --registry https://npm.corp.example/"], E);
  const raw = fs.readFileSync(LOG, "utf8");
  check("log: private scope, custom index and registry URL never written", !/acme|secret-thing|corp-internal|corp-thing|corp\.example|npm\.acme/.test(raw), raw);
  check("log: private packages counted without a name", rows().some((x) => x.private === true && x.n >= 1 && !x.pkg), raw);
  check("log: nothing about private names was sent either", !seen.some((x) => /acme|corp/.test(JSON.stringify(x))), JSON.stringify(seen));
  // 4. no upload: logging adds no requests
  seen.length = 0; const n0 = rows().length;
  await run(["check", "npm install left-pad@1.3.0"], { ...E, KARMADUE_NO_CACHE: "" });
  check("log: only the one preflight request, nothing else sent", seen.length === 1 && /preflight/.test(seen[0].url), JSON.stringify(seen));
  // 5. exec outcome
  const sb = sandbox(); const home2 = fs.mkdtempSync(path.join(os.tmpdir(), "kd-lh2-")); const L2 = path.join(home2, "guard-log.jsonl");
  const X = { ...E, KARMADUE_HOME: home2, PATH: `${sb.stubs}:${process.env.PATH}`, KARMADUE_SHIM_DIR: sb.shims };
  let o = await run(["exec", "npm", "install", "is-number@7.0.0"], X);
  o = await run(["exec", "npm", "install", "is-number@7.0.0"], { ...X, STUB_EXIT: "3" });
  const r2 = fs.readFileSync(L2, "utf8").trim().split("\n").map((l) => JSON.parse(l)); const outs = r2.filter((x) => x.type === "outcome");
  check("log: exec records install exit codes (0 and 3)", outs.length === 2 && outs[0].exit === 0 && outs[1].exit === 3 && outs.every((x) => x.run && r2.some((c) => c.type === "check" && c.run === x.run)), JSON.stringify(r2));
  // exec with no package names writes nothing
  const before2 = r2.length; await run(["exec", "npm", "run", "build"], X);
  check("log: exec without package names logs nothing", fs.readFileSync(L2, "utf8").trim().split("\n").length === before2);
  // 6. stats
  o = await run(["stats"], { KARMADUE_HOME: home2 });
  check("stats: text summary with counts and avg ms", o.code === 0 && /checks: 2/.test(o.out) && /avg ms: \d+/.test(o.out) && /installs run by the guard: 2 +\(exit 0: 1, failed: 1\)/.test(o.out), o.out + o.err);
  o = await run(["stats", "--json"], { KARMADUE_HOME: home });
  let j = {}; try { j = JSON.parse(o.out); } catch (_) { /* below */ }
  check("stats --json: totals by verdict and cache", j.checks >= 5 && j.by_verdict && j.by_verdict.clean >= 3 && j.by_verdict.block === 1 && j.by_verdict.fix_first >= 1 && j.private_not_checked >= 3 && typeof j.avg_ms === "number" && j.cache_hit_rate > 0, o.out);
  o = await run(["stats"], { KARMADUE_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "kd-empty-")) });
  check("stats: friendly message when no log", /no log yet/.test(o.out), o.out);
  // 7. opt-out and clear
  const home3 = fs.mkdtempSync(path.join(os.tmpdir(), "kd-lh3-"));
  await run(["check", "npm install is-number@7.0.0"], { ...E, KARMADUE_HOME: home3, KARMADUE_NO_LOG: "1" });
  check("KARMADUE_NO_LOG=1: nothing written", !fs.existsSync(path.join(home3, "guard-log.jsonl")));
  o = await run(["log-clear"], E);
  check("log-clear deletes the log", !fs.existsSync(LOG));
  srv.close(); done();
})();
