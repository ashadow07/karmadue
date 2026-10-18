"use strict";
// 0.4.0: hijack signals from registry metadata. Offline fixtures (mock registry), plus unit tests of the pure functions.
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const { run, sandbox, check, done } = require("./helpers");
const P = require("../lib/provenance.js");
const H = 3600e3, NOW = Date.now(), ago = (h) => new Date(NOW - h * H).toISOString();
const att = { provenance: { predicateType: "https://slsa.dev/provenance/v1" } };
const gh = { name: "GitHub Actions", trustedPublisher: { id: "github" } };
const npmDoc = (vs) => ({ "dist-tags": { latest: vs[vs.length - 1].v }, time: Object.fromEntries(vs.map((x) => [x.v, ago(x.h)])), versions: Object.fromEntries(vs.map((x) => [x.v, { name: "x", version: x.v, _npmUser: x.u, maintainers: (x.m || ["alice"]).map((n) => ({ name: n })), dist: x.att ? { attestations: att } : {} }])) });
const FIX = {
  hijack: npmDoc([{ v: "1.0.0", h: 1000, u: gh, att: true }, { v: "1.1.0", h: 5, u: { name: "evil-actor" }, m: ["alice", "evil-actor"] }]),
  lostonly: npmDoc([{ v: "2.0.0", h: 900, u: { name: "bob" }, att: true }, { v: "2.0.1", h: 100, u: { name: "bob" } }]),
  pubonly: npmDoc([{ v: "3.0.0", h: 900, u: { name: "bob" } }, { v: "3.1.0", h: 100, u: { name: "carol" }, m: ["bob", "carol"] }]),
  freshonly: npmDoc([{ v: "4.0.0", h: 900, u: { name: "bob" } }, { v: "4.0.1", h: 3, u: { name: "bob" } }]),
  quiet: npmDoc([{ v: "5.0.0", h: 900, u: { name: "bob" }, att: true }, { v: "5.0.1", h: 400, u: { name: "bob" }, att: true }]),
  oldhijack: npmDoc([{ v: "6.0.0", h: 5000, u: gh, att: true }, { v: "6.0.1", h: 3000, u: { name: "evil" } }]),
};
const sfile = (fn, prov, h) => ({ filename: fn, "upload-time": ago(h), ...(prov ? { provenance: "https://pypi.org/integrity/x" } : {}), yanked: false });
const PYFIX = {
  "py-lost": { versions: ["1.0", "1.1"], files: [sfile("py_lost-1.0.tar.gz", true, 900), sfile("py_lost-1.0-py3-none-any.whl", true, 900), sfile("py_lost-1.1.tar.gz", false, 4000 - 3990), sfile("py_lost-1.1-py3-none-any.whl", false, 10)] },
  "py-fresh": { versions: ["2.0", "2.1"], files: [sfile("py_fresh-2.0.tar.gz", false, 900), sfile("py_fresh-2.1.tar.gz", false, 6)] },
  "py-ok": { versions: ["3.0", "3.1"], files: [sfile("py_ok-3.0.tar.gz", true, 900), sfile("py_ok-3.1.tar.gz", true, 300)] },
};
(async () => {
  // ---- unit: pure functions ----
  const A = (name, ver) => P.assess(P.summarizeNpm(FIX[name]), ver, NOW);
  check("unit: lost provenance + publisher change within 30d = strong", A("hijack").level === "strong" && A("hijack").signals.length === 3, JSON.stringify(A("hijack")));
  check("unit: lost provenance only = warn", A("lostonly").level === "warn" && A("lostonly").lost && !A("lostonly").pubChange);
  check("unit: publisher change only = warn", A("pubonly").level === "warn" && A("pubonly").pubChange && !A("pubonly").lost);
  check("unit: fresh only = note (soft)", A("freshonly").level === "note");
  check("unit: nothing changed = none", A("quiet").level === "none");
  check("unit: strong needs the release to be <= 30 days old (old change is only a warn)", A("oldhijack").level === "warn");
  check("unit: pinned exact old version is judged against its own predecessor", A("hijack", "1.0.0").level === "none" && A("hijack", "1.1.0").level === "strong");
  check("unit: ranges and tags are not judged", A("hijack", "^1.0.0").level === "none" && A("hijack", "next").level === "none");
  const Y = (n, v) => P.assess(P.summarizePypi(PYFIX[n], n), v, NOW);
  check("unit pypi: provenance lost = warn, never strong (no publisher data)", Y("py-lost").level === "warn" && Y("py-lost").lost);
  check("unit pypi: fresh only = note", Y("py-fresh").level === "note");
  check("unit pypi: provenance kept = none", Y("py-ok").level === "none");
  const nightly = { "dist-tags": { latest: "9.0.0" }, time: { "9.0.0": ago(500), ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => ["9.1.0-dev." + i, ago(20 - i)])) }, versions: { "9.0.0": { _npmUser: { name: "a" }, maintainers: [{ name: "a" }], dist: {} }, ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => ["9.1.0-dev." + i, { _npmUser: { name: "a" }, maintainers: [{ name: "a" }], dist: {} }])) } };
  check("unit: nightly tags burying `latest` do not hide it", P.assess(P.summarizeNpm(nightly), null, NOW).v === "9.0.0");

  // ---- e2e: mock registries + mock KarmaDue ----
  const hits = [];
  const reg = http.createServer((req, res) => {
    hits.push(req.url); res.setHeader("content-type", "application/json");
    const m = /^\/simple\/([^/]+)\/$/.exec(req.url);
    if (m && PYFIX[m[1].replace(/_/g, "-")]) return res.end(JSON.stringify(PYFIX[m[1].replace(/_/g, "-")]));
    const n = decodeURIComponent(req.url.slice(1));
    if (FIX[n]) return res.end(JSON.stringify(FIX[n]));
    res.statusCode = 404; res.end("{}");
  });
  const kd = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, data: { decision: "no_known_issues", enforce: "proceed_with_care", headline: "No advisories." }, request_id: "r1" })); }); });
  await new Promise((r) => reg.listen(0, "127.0.0.1", r)); await new Promise((r) => kd.listen(0, "127.0.0.1", r));
  const R = `http://127.0.0.1:${reg.address().port}`;
  const sb = sandbox();
  const E = (extra = {}) => ({ KARMADUE_API: `http://127.0.0.1:${kd.address().port}`, KARMADUE_DETAIL: "", KARMADUE_NO_CACHE: "", KARMADUE_PROVENANCE: "ask", KARMADUE_PROV_NPM_URL: R, KARMADUE_PROV_PYPI_URL: R, PATH: `${sb.stubs}:${process.env.PATH}`, ...extra });
  const home = () => fs.mkdtempSync(path.join(os.tmpdir(), "kd-p-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kd-pc-")); process.chdir(cwd);

  let r = await run(["check", "npm install hijack"], E({ KARMADUE_HOME: home() }));
  check("e2e: strong signal prints HIJACK RISK and check exits 2 (needs approval)", r.code === 2 && /HIJACK RISK hijack@1\.1\.0: lost provenance \(1\.0\.0 had it\); publisher trusted:github -> user:evil-actor|HIJACK RISK hijack@1\.1\.0: lost provenance/.test(r.err), `${r.code}\n${r.err}`);
  sb.reset(); r = await run(["exec", "npm", "install", "hijack"], E({ KARMADUE_HOME: home() }));
  check("e2e: exec pauses (exit 2), install not run", r.code === 2 && sb.ran().length === 0 && /PAUSED/.test(r.err), `${r.code}\n${r.err}`);
  sb.reset(); r = await run(["exec", "npm", "install", "hijack"], E({ KARMADUE_HOME: home(), KARMADUE_APPROVED: "1" }));
  check("e2e: KARMADUE_APPROVED=1 lets it run", r.code === 0 && sb.ran().length === 1);
  sb.reset(); r = await run(["exec", "npm", "install", "hijack"], E({ KARMADUE_HOME: home(), KARMADUE_PROVENANCE: "warn" }));
  check("e2e: KARMADUE_PROVENANCE=warn warns but never pauses", r.code === 0 && /HIJACK RISK/.test(r.err) && sb.ran().length === 1, r.err);
  r = await run(["check", "npm install lostonly"], E({ KARMADUE_HOME: home() }));
  check("e2e: lost provenance alone is a WARN and does not pause", r.code === 0 && /WARN lostonly@2\.0\.1: lost provenance \(2\.0\.0 had it\)/.test(r.err), `${r.code}\n${r.err}`);
  r = await run(["check", "npm install pubonly"], E({ KARMADUE_HOME: home() }));
  check("e2e: publisher change alone is a WARN", r.code === 0 && /WARN pubonly@3\.1\.0: .*(publisher|maintainer)/.test(r.err), r.err);
  r = await run(["check", "npm install freshonly"], E({ KARMADUE_HOME: home() }));
  check("e2e: fresh release is one soft note, not a warning", r.code === 0 && /pintree ok freshonly/.test(r.err) && /new \(<72h, usually normal\): freshonly@4\.0\.1\(3h\)/.test(r.err) && !/WARN/.test(r.err), r.err);
  r = await run(["check", "npm install quiet"], E({ KARMADUE_HOME: home() }));
  check("e2e: unchanged package prints exactly the old one-line ok", r.err.trim() === "pintree ok quiet", JSON.stringify(r.err));
  r = await run(["check", "pip install py-lost"], E({ KARMADUE_HOME: home() }));
  check("e2e pypi: lost PEP 740 attestations = WARN", r.code === 0 && /WARN py-lost==1\.1: lost provenance/.test(r.err), r.err);
  r = await run(["check", "pip install py-fresh"], E({ KARMADUE_HOME: home() }));
  check("e2e pypi: fresh = soft note", /new \(<72h/.test(r.err) && !/WARN/.test(r.err), r.err);
  r = await run(["check", "pip install py-ok"], E({ KARMADUE_HOME: home() }));
  check("e2e pypi: unchanged = ok line only", r.err.trim() === "pintree ok py-ok", r.err);

  // privacy + cost
  hits.length = 0; const h = home();
  await run(["check", "npm install quiet"], E({ KARMADUE_HOME: h })); const n1 = hits.length;
  await run(["check", "npm install quiet"], E({ KARMADUE_HOME: h }));
  check("cost: exactly one registry request per package, second run served from cache", n1 === 1 && hits.length === 1, JSON.stringify(hits));
  hits.length = 0;
  await run(["check", "npm install quiet"], E({ KARMADUE_HOME: home(), KARMADUE_PROVENANCE: "off" }));
  check("KARMADUE_PROVENANCE=off makes no registry request", hits.length === 0);
  fs.writeFileSync(path.join(cwd, ".npmrc"), "@acme:registry=https://npm.acme.internal/\n");
  await run(["check", "npm install @acme/secret-thing"], E({ KARMADUE_HOME: home() }));
  check("private scope: name never sent to the registry", hits.length === 0, JSON.stringify(hits));
  fs.unlinkSync(path.join(cwd, ".npmrc"));
  await run(["check", "npm install quiet --registry=https://npm.corp.example/"], E({ KARMADUE_HOME: home() }));
  await run(["check", "pip install py-ok --index-url https://pypi.corp.example/simple"], E({ KARMADUE_HOME: home() }));
  check("custom registry / index: nothing sent to the public registry", hits.length === 0, JSON.stringify(hits));
  const t0 = Date.now(); r = await run(["check", "npm install quiet"], E({ KARMADUE_HOME: home(), KARMADUE_PROV_NPM_URL: "http://127.0.0.1:9", KARMADUE_PROV_TIMEOUT_MS: "800" }));
  check("registry unreachable: no warning, normal ok line, bounded time", r.code === 0 && r.err.trim() === "pintree ok quiet" && Date.now() - t0 < 6000, r.err);
  const lh = home(); await run(["check", "npm install hijack"], E({ KARMADUE_HOME: lh }));
  const lg = fs.readFileSync(path.join(lh, "guard-log.jsonl"), "utf8");
  check("log: records only the signal level, no registry URL", /"prov":"strong"/.test(lg) && !/127\.0\.0\.1|corp\.example/.test(lg), lg);
  reg.close(); kd.close(); done();
})();
