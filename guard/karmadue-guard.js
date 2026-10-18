#!/usr/bin/env node
// karmadue-guard: a KarmaDue check where installs happen, for any agent or person on any platform.
// No dependencies. Node 18+ (global fetch). No account.
//
//   karmadue-guard exec npm install left-pad@1.3.0   check, then run the real npm (what the shims call)
//   karmadue-guard check "pip install jinja2==2.11.2"   check only; exit 0 go, 1 blocked
//   karmadue-guard install-shims [DIR]               write npm/npx/pnpm/pnpx/yarn/pip/pip3/uv/uvx shims (default ~/.karmadue/shims)
//   karmadue-guard init [--aliases] [--fish]         print the shell line that puts the shims first on PATH (or aliases)
//
// Parsing (which words are packages) is the Claude Code hook 1.1.0's own code, vendored unchanged in lib/.
// For each package it asks KarmaDue's public check, POST /v1/preflight:
//   deny                         -> BLOCKED: the real command does not run (exit 1)
//   warn, require_human_approval,
//   unverified_existence         -> the reasons are printed, then the command runs (KARMADUE_WARN=block blocks instead)
//   allow, no_known_issues       -> one line with the request id, then the command runs
//   unknown                      -> printed as not assessed; runs, unless KARMADUE_STRICT=1
//   no answer / unreadable reply -> a loud NOT CHECKED banner; runs, unless KARMADUE_STRICT=1. Never silent.
//
// Environment: KARMADUE_API, KARMADUE_TIMEOUT_MS (default 8000), KARMADUE_STRICT=1, KARMADUE_WARN=block,
// KARMADUE_ALLOW="name,name@1.2.3", KARMADUE_DISABLE=1 (skip checks, still runs the tool; says so), KARMADUE_QUIET=1 (no line for clean packages), KARMADUE_NO_LOG=1 (no local check log).
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const hook = require("./lib/karmadue-preinstall.js");
const prov = require("./lib/provenance.js");

const VERSION = "0.4.0";
const crypto = require("crypto");
const LEAF_API = "https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/guard-leaves";
const KD_DIR = () => process.env.KARMADUE_HOME || path.join(os.homedir(), ".karmadue");
// TTLs (ms): clean answers live longer than problems; stale entries are only used when KarmaDue cannot be reached.
const TTL = { ok: 24 * 3600e3, unknown: 3600e3, warn: 6 * 3600e3, block: 6 * 3600e3 };
const STALE_MAX = 30 * 24 * 3600e3;
const DEFAULT_API = "https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/public-api";
const MAX_CHECKS = 25;
const TOOLS = ["npm", "npx", "pnpm", "pnpx", "yarn", "pip", "pip3", "uv", "uvx"];
const RUNS = /^(npx|bunx|pnpx|npm exec|pnpm dlx|yarn dlx|bun x|uvx|uv tool|pipx run)/;
const INSTALLISH = { npm: ["install", "i", "add", "ci", "exec", "x"], pnpm: ["add", "install", "i", "dlx"], yarn: ["add", "install", "dlx", "global"], pip: ["install"], pip3: ["install"], uv: ["pip", "add", "tool"], npx: null, pnpx: null, uvx: null };

// ---- 0.3.0: local-only check log (~/.karmadue/guard-log.jsonl). Never uploaded. Off with KARMADUE_NO_LOG=1. ----
// One line per package check: time, ecosystem, package, verdict class (clean|fix_first|approval|block|warn|unknown|unchecked),
// cache (hit|revalidated|offline|miss|none), ms. A second line per exec run records the install exit code when the guard ran it.
// Private-scope packages, custom registries and private indexes are never named: they are counted as {private:true} with no name,
// no URL and no hash. Commands, flags, paths and registry URLs are never written.
let LOG_MODE = "check"; let LOGGED = 0;
const RUN_ID = crypto.randomBytes(4).toString("hex");
const logPath = (env) => path.join((env && env.KARMADUE_HOME) || KD_DIR(), "guard-log.jsonl");
function logWrite(env, rows) {
  if (!rows.length || truthy((env || {}).KARMADUE_NO_LOG)) return;
  try {
    const f = logPath(env); fs.mkdirSync(path.dirname(f), { recursive: true });
    try { if (fs.statSync(f).size > 5 * 1024 * 1024) fs.renameSync(f, f + ".1"); } catch (_) { /* new file */ }
    fs.appendFileSync(f, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", { mode: 0o600 });
  } catch (_) { /* logging is best effort and never blocks an install */ }
}
function verdictClass(r, askSet) {
  if (r.kind === "block" || r.kind === "trapblock") return "block";
  if (askSet && askSet.has(r)) return "approval";
  if (r.trap) return "fix_first";
  return { ok: "clean", warn: "warn", unknown: "unknown", unchecked: "unchecked" }[r.kind] || "unchecked";
}
function logChecks(results, ask, privateN, env, mode) {
  const askSet = new Set(ask || []); const t = new Date().toISOString(); const rows = [];
  for (const r of results) rows.push({ t, type: "check", run: RUN_ID, mode, eco: r.p.ecosystem, pkg: r.p.name, ver: r.p.version || null, verdict: verdictClass(r, askSet), ...(r.prov ? { prov: r.prov.level } : {}), cache: r.kind === "unchecked" ? "none" : (r.cached || "miss"), ms: Number.isFinite(r.ms) ? r.ms : null });
  if (privateN) rows.push({ t, type: "check", run: RUN_ID, mode, private: true, n: privateN, verdict: "not_checked", cache: "none", ms: 0 });
  LOGGED += rows.length;
  logWrite(env, rows);
}
function logOutcome(env, tool, exit, note) { if (!LOGGED) return; logWrite(env, [{ t: new Date().toISOString(), type: "outcome", run: RUN_ID, tool: path.basename(String(tool || "")), exit, ...(note ? { note } : {}) }]); }

const err = (s) => process.stderr.write(s.endsWith("\n") ? s : s + "\n");
const truthy = (v) => v === "1" || v === "true" || v === "yes";
const clip = (s, n) => { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "..." : s; };
const q = (w) => (/^[A-Za-z0-9@%+=:,./_^-]+$/.test(w) ? w : "'" + String(w).replace(/'/g, "'\\''") + "'");
const label = (p) => `${p.name}${p.version ? (p.ecosystem === "pypi" ? "==" : "@") + p.version : ""} (${p.ecosystem})`;

function allowed(p, env) {
  const list = String(env.KARMADUE_ALLOW || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(p.name.toLowerCase()) || list.includes(`${p.name}@${p.version || ""}`.toLowerCase()) || list.includes(`${p.name}==${p.version || ""}`.toLowerCase());
}

// Packages named in one command (tool + args), via the hook's parser. npm/pip/uv only: other ecosystems are not checked here.
// 0.2.1: packages from private scopes, custom registries or private indexes are never sent anywhere (no check, no leaf).
function privateScopes(env) {
  const out = new Set(String(env.KARMADUE_PRIVATE_SCOPES || "").split(",").map((x) => x.trim().replace(/^@?/, "@").toLowerCase()).filter((x) => x.length > 1));
  for (const f of [path.join(process.cwd(), ".npmrc"), path.join(os.homedir(), ".npmrc")]) {
    try { for (const m of fs.readFileSync(f, "utf8").matchAll(/^\s*(@[\w.-]+):registry\s*=/gm)) out.add(m[1].toLowerCase()); } catch (_) { /* none */ }
  }
  return out;
}
function customRegistry(words, env) {
  const tool = path.basename(words[0] || "");
  const npmDefault = /^https?:\/\/registry\.(npmjs\.org|yarnpkg\.com)\/?$/;
  if (/^(npm|npx|pnpm|pnpx|yarn)$/.test(tool)) {
    const flag = words.find((w) => /^--registry(=|$)/.test(w));
    const reg = flag ? (flag.includes("=") ? flag.split("=")[1] : words[words.indexOf(flag) + 1]) : env.npm_config_registry || env.NPM_CONFIG_REGISTRY;
    if (reg && !npmDefault.test(reg)) return "custom npm registry";
    for (const f of [path.join(process.cwd(), ".npmrc"), path.join(os.homedir(), ".npmrc")]) {
      try { const m = /^\s*registry\s*=\s*(\S+)/m.exec(fs.readFileSync(f, "utf8")); if (m && !npmDefault.test(m[1])) return "custom npm registry (.npmrc)"; } catch (_) { /* none */ }
    }
  } else {
    if (words.some((w) => /^(-i|--index-url|--extra-index-url|--index|--default-index)(=|$)/.test(w))) return "custom package index";
    if (env.PIP_INDEX_URL || env.PIP_EXTRA_INDEX_URL || env.UV_INDEX_URL || env.UV_EXTRA_INDEX_URL || env.UV_INDEX || env.UV_DEFAULT_INDEX) return "custom package index (env)";
  }
  return null;
}
function isPrivate(p, words, env) {
  if (p.ecosystem === "npm" && p.name.startsWith("@") && privateScopes(env).has(p.name.split("/")[0].toLowerCase())) return "private scope";
  return customRegistry(words, env);
}

// 0.2.1: transitive rules for known traps (dependency the command does not name). Pre-run: warn when the command leaves the
// dependency unpinned. Post-run: read the version that actually resolved and say if it is the known-bad one.
const TRANSITIVE = [
  { via: "passlib", eco: "pypi", dep: "bcrypt", bad: /^5\./, pinned: /^bcrypt\s*(<\s*5|<=\s*4|==\s*4|~=\s*4)/i, ref: "kd-seed-050",
    problem: "passlib 1.7.4 with bcrypt 5 fails on the first hash (ValueError: password cannot be longer than 72 bytes)", do: "add 'bcrypt<5' to the same install" },
];
function transitivePre(words) {
  const names = targets(words).map((p) => p.name.toLowerCase());
  return TRANSITIVE.filter((t) => names.includes(t.via) && !words.some((w) => t.pinned.test(w.replace(/^['"]|['"]$/g, ""))));
}
function transitivePost(words, real, env) {
  const tool = path.basename(words[0] || "");
  for (const t of TRANSITIVE) {
    if (!targets(words).some((p) => p.name.toLowerCase() === t.via)) continue;
    let ver = null;
    try {
      const args = tool === "uv" ? ["pip", "show", t.dep] : ["show", t.dep];
      const out = spawnSync(real, args, { encoding: "utf8", env: { ...env, KARMADUE_GUARD_ACTIVE: "1" }, timeout: 15000 }).stdout || "";
      const m = /^Version:\s*(\S+)/m.exec(out); ver = m && m[1];
    } catch (_) { /* skip */ }
    if (ver && t.bad.test(ver)) err(`pintree TRAP (resolved dependency) ${t.dep}==${ver} via ${t.via}: ${t.problem}\n  do: ${t.do}\n  [${t.ref}]`);
  }
}

function targets(words) {
  return hook.extractInstalls(words.map(q).join(" ")).filter((p) => p.ecosystem === "npm" || p.ecosystem === "pypi");
}

function cachePath() { return path.join(KD_DIR(), "cache", "preflight-v1.json"); }
let CACHE = null;
function loadCache() { if (CACHE) return CACHE; try { CACHE = JSON.parse(fs.readFileSync(cachePath(), "utf8")); } catch (_) { CACHE = {}; } return CACHE; }
function saveCache() { try { fs.mkdirSync(path.dirname(cachePath()), { recursive: true }); const f = cachePath() + "." + process.pid; fs.writeFileSync(f, JSON.stringify(CACHE)); fs.renameSync(f, cachePath()); } catch (_) { /* cache is best effort */ } }
const kindOf = (body) => { const d = (body && body.data) || {}; return d.decision === "deny" ? "block" : d.decision === "unknown" ? "unknown" : /warn|approval|unverified/.test(d.decision || "") ? "warn" : "ok"; };
// Cached preflight. Fresh hit: no network. Expired: revalidate (If-None-Match when the server sent an ETag; otherwise
// compare the body hash). Network failure: serve a stale entry (<=30 days) marked offline.
async function cachedPreflight(p, env) {
  const key = `${hook.targetFor(p)}|${RUNS.test(p.via || "") ? "run" : "install"}`;
  const c = loadCache(); const e = c[key]; const now = Date.now();
  if (truthy(env.KARMADUE_NO_CACHE)) return preflight(p, env);
  if (e && now - e.t < (TTL[kindOf(e.body)] || TTL.unknown)) return { body: e.body, cached: "hit" };
  const res = await preflight(p, env, e && e.etag);
  if (res.notModified && e) { e.t = now; saveCache(); return { body: e.body, cached: "revalidated" }; }
  if (res.body) { c[key] = { t: now, etag: res.etag || null, h: crypto.createHash("sha256").update(JSON.stringify(res.body.data || {})).digest("hex").slice(0, 16), body: res.body }; saveCache(); return res; }
  if (e && now - e.t < STALE_MAX) return { body: e.body, cached: "offline" };
  return res;
}

async function preflight(p, env, etag) {
  const api = String(env.KARMADUE_API || DEFAULT_API).replace(/\/+$/, "");
  const timeout = Math.max(500, Number(env.KARMADUE_TIMEOUT_MS) || 8000);
  const action = RUNS.test(p.via || "") ? "run" : "install";
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 800));
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(`${api}/v1/preflight`, {
        method: "POST",
        headers: { ...(etag ? { "if-none-match": etag } : {}), "content-type": "application/json", "user-agent": `karmadue-guard/${VERSION} (${process.platform}; node ${process.versions.node})` },
        body: JSON.stringify({ target: hook.targetFor(p), action, task: `${p.via} via karmadue-guard` }),
        signal: ctl.signal,
      });
      if (r.status === 304) return { notModified: true };
      const text = await r.text();
      let j = null; try { j = JSON.parse(text); } catch (_) { /* below */ }
      if (r.status === 429 || r.status >= 500) { last = { error: `KarmaDue answered HTTP ${r.status}` }; continue; }
      if (!r.ok) return { error: `KarmaDue answered HTTP ${r.status}${j && j.error ? ` (${clip(j.error.message || j.error.code, 100)})` : ""}` };
      if (!j || typeof j !== "object") return { unparsed: `reply was not JSON (${clip(text, 80) || "empty"})` };
      return { body: j, action, etag: r.headers.get("etag") };
    } catch (e) {
      last = { error: e && e.name === "AbortError" ? `KarmaDue did not answer within ${timeout} ms` : `could not reach KarmaDue (${(e && e.cause && e.cause.code) || (e && e.message) || e})` };
    } finally { clearTimeout(t); }
  }
  return last;
}

// ---- 0.4.0: hijack signals from public registry metadata (see lib/provenance.js). One GET per public package, cached 3 h. ----
// Sends only the public package name to registry.npmjs.org / pypi.org (what the install itself does). Never for private scopes or
// custom registries/indexes (those are filtered out before this runs). KARMADUE_PROVENANCE=off disables it (no request).
// KARMADUE_PROVENANCE=warn keeps the warning but never pauses. Test hooks: KARMADUE_PROV_NPM_URL / KARMADUE_PROV_PYPI_URL.
const PROV_TTL = 3 * 3600e3, PROV_MAX_BYTES = 25 * 1024 * 1024;
const provMode = (env) => { const m = String(env.KARMADUE_PROVENANCE || "ask").toLowerCase(); return ["off", "warn", "ask"].includes(m) ? m : "ask"; };
const provCachePath = (env) => path.join((env && env.KARMADUE_HOME) || KD_DIR(), "cache", "provenance-v1.json");
let PCACHE = null;
function provLoad(env) { if (PCACHE) return PCACHE; try { PCACHE = JSON.parse(fs.readFileSync(provCachePath(env), "utf8")); } catch (_) { PCACHE = {}; } return PCACHE; }
function provSave(env) { try { const f = provCachePath(env); fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + "." + process.pid; fs.writeFileSync(t, JSON.stringify(PCACHE)); fs.renameSync(t, f); } catch (_) { /* best effort */ } }
async function provFetch(p, env) {
  const name = p.name; const eco = p.ecosystem;
  if (eco !== "npm" && eco !== "pypi") return null;
  if (!/^(@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i.test(name)) return null;
  const base = eco === "npm" ? String(env.KARMADUE_PROV_NPM_URL || "https://registry.npmjs.org").replace(/\/+$/, "") : String(env.KARMADUE_PROV_PYPI_URL || "https://pypi.org").replace(/\/+$/, "");
  const url = eco === "npm" ? `${base}/${name.replace("/", "%2f")}` : `${base}/simple/${encodeURIComponent(name.toLowerCase())}/`;
  const timeout = Math.max(300, Number(env.KARMADUE_PROV_TIMEOUT_MS) || 4000);
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { accept: eco === "npm" ? "application/json" : "application/vnd.pypi.simple.v1+json", "user-agent": `karmadue-guard/${VERSION}` }, signal: ctl.signal });
    if (!r.ok) return null;
    if (Number(r.headers.get("content-length")) > PROV_MAX_BYTES) return null;
    const doc = await r.json();
    return eco === "npm" ? prov.summarizeNpm(doc) : prov.summarizePypi(doc, name);
  } catch (_) { return null; } finally { clearTimeout(t); }
}
// Returns assess() output, or null when off, unreachable or not applicable. Never throws, never blocks an install.
async function provCheck(p, env) {
  if (provMode(env) === "off") return null;
  try {
    const key = `${p.ecosystem}|${p.name.toLowerCase()}`; const c = provLoad(env); const e = c[key]; const now = Date.now(); let sum;
    if (e && now - e.t < PROV_TTL && !truthy(env.KARMADUE_NO_CACHE)) sum = e.sum;
    else { sum = await provFetch(p, env); if (sum) { c[key] = { t: now, sum }; provSave(env); } else if (e) sum = e.sum; }
    return prov.assess(sum, p.version);
  } catch (_) { return null; }
}

// Bundled trap pack: tested install traps (see traps.json "label"). Integrity-checked against traps.sha256 at load.
let TRAPS = null;
function loadTraps() {
  if (TRAPS) return TRAPS;
  try {
    const raw = fs.readFileSync(path.join(__dirname, "traps.json"));
    const want = fs.readFileSync(path.join(__dirname, "traps.sha256"), "utf8").trim().split(/\s+/)[0];
    const got = crypto.createHash("sha256").update(raw).digest("hex");
    TRAPS = got === want ? JSON.parse(raw).traps : [];
    if (got !== want) err("karmadue-guard: traps.json failed its integrity check; trap advice disabled.");
  } catch (_) { TRAPS = []; }
  return TRAPS;
}
function trapFor(p, words) {
  const cmd = (words || []).join(" ");
  const name = p.name.toLowerCase();
  for (const t of loadTraps()) {
    if (t.ecosystem !== p.ecosystem && !(t.ecosystem === "mcp" && p.ecosystem === "npm")) continue;
    if (t.name.toLowerCase() !== name) continue;
    if (t.versions && !(p.version ? new RegExp(t.versions).test(p.version) : t.unpinned)) continue;
    if (t.when && !new RegExp(t.when).test(cmd)) continue;
    return t;
  }
  return null;
}

// One result per package: {kind: block|warn|ok|unknown|unchecked, p, line, alts, id}
function judge(p, res) {
  if (res.error) return { kind: "unchecked", p, line: res.error };
  if (res.unparsed) return { kind: "unchecked", p, line: `KarmaDue's reply could not be read: ${res.unparsed}` };
  const body = res.body;
  const id = (body.data && body.data.receipt_id) ? `receipt ${body.data.receipt_id}` : body.request_id ? `request ${body.request_id}` : null;
  const r = hook.interpret(body);
  if (r.kind === "unparsed") return { kind: "unchecked", p, id, line: `KarmaDue's reply could not be read: ${r.why} (karmadue-guard may be out of date)` };
  const data = body.data || {};
  if (r.kind === "deny") return { kind: "block", p, id, line: clip(data.headline || r.line, 400), alts: r.alts };
  if (r.kind === "warn") {
    const reasons = (Array.isArray(data.reasons) ? data.reasons : []).filter((x) => typeof x === "string" && x !== data.headline).slice(0, 2);
    return { kind: "warn", p, id, decision: data.decision, enforce: data.enforce, line: clip(data.headline || r.line, 400), reasons: reasons.map((x) => clip(x, 300)), alts: r.alts };
  }
  if (data.decision === "unknown") return { kind: "unknown", p, id, line: clip(data.headline || "Not assessed: KarmaDue has no evidence either way.", 300) };
  return { kind: "ok", p, id, line: clip(data.headline || "no known issues", 200) };
}

async function checkWords(words, env) {
  const strict = truthy(env.KARMADUE_STRICT);
  const tool = path.basename(words[0] || "");
  const notes = [];
  let privateN = 0;
  const named = targets(words).length;
  const all = targets(words).filter((p) => { const why = isPrivate(p, words, env); if (why) privateN++; if (why) notes.push(`pintree: ${p.ecosystem === "npm" && why === "private scope" ? p.name.split("/")[0] + "/*" : "packages"} not checked (${why}); names are never sent.`); return !why; });
  const pkgs = all.filter((p) => !allowed(p, env));
  for (const p of all.filter((x) => allowed(x, env))) notes.push(`karmadue-guard: ${label(p)} skipped (KARMADUE_ALLOW).`);
  const args = words.slice(1);
  if (/^pip/.test(tool) || tool === "uv") {
    if (args.some((a) => a === "-r" || a.startsWith("--requirement") || a === "-c" || a.startsWith("--constraint") || a === "-e" || a === "--editable")) notes.push("karmadue-guard: requirements, constraints and editable files are NOT checked by the guard (only package names on the command line). Use the KarmaDue GitHub Action for lockfiles.");
  }
  for (const t of transitivePre(words)) notes.push(`pintree TRAP ${t.via} -> ${t.dep}: ${t.problem}\n  do: ${t.do}\n  [${t.ref}; transitive rule]`);
  const sub = args.find((a) => !a.startsWith("-"));
  if (!named && INSTALLISH[tool] && INSTALLISH[tool].includes(sub) && !/^(exec|x|dlx|tool)$/.test(sub)) notes.push(`karmadue-guard: "${tool} ${sub}" without package names installs from your manifest or lockfile; that is NOT checked here.`);
  if (!pkgs.length) { logChecks([], [], privateN, env, LOG_MODE); return { results: [], notes, block: false, strict }; }
  const checked = pkgs.slice(0, MAX_CHECKS);
  const results = [];
  const provP = new Map(checked.map((p) => [p, provCheck(p, env)])); // parallel with the KarmaDue checks
  for (const p of checked) { const trap = trapFor(p, words);
    if (trap && trap.blocks && (env.KARMADUE_TRAPS || "block") === "block") { results.push({ kind: "trapblock", p, trap, cached: "hit", ms: 0 }); continue; } // blocked locally: no network needed
    const t0 = Date.now(); const res = await cachedPreflight(p, env); const jr = judge(p, res); jr.cached = res.cached; jr.ms = Date.now() - t0; jr.trap = trapFor(p, words); results.push(jr); }
  for (const r of results) if (provP.has(r.p)) { const a = await provP.get(r.p); if (a && a.level !== "none") r.prov = a; }
  for (const p of pkgs.slice(MAX_CHECKS)) results.push({ kind: "unchecked", p, line: `more than ${MAX_CHECKS} packages in one command; this one was not checked` });
  const warnBlocks = (env.KARMADUE_WARN || "").toLowerCase() === "block";
  const trapBlocks = (env.KARMADUE_TRAPS || "block").toLowerCase() === "block";
  const ask = results.filter((r) => (r.kind === "warn" && (r.enforce === "require_human_approval" || r.decision === "require_human_approval")) || (r.prov && r.prov.level === "strong" && provMode(env) === "ask"));
  const block = results.some((r) => r.kind === "block" || r.kind === "trapblock" || (trapBlocks && r.trap && r.trap.blocks) || (warnBlocks && r.kind === "warn") || (strict && (r.kind === "unknown" || r.kind === "unchecked" || (r.kind === "warn" && r.decision === "unverified_existence"))));
  logChecks(results, ask, privateN, env, LOG_MODE);
  return { results, notes, block, strict, warnBlocks, ask };
}

const provAge = (h) => (h < 48 ? h + "h" : Math.round(h / 24) + "d");
// strong: provenance lost AND publisher changed (pauses unless KARMADUE_PROVENANCE=warn). warn: one of the two. Tiny on purpose.
function provLine(p, a, nm) {
  const tag = a.level === "strong" ? "HIJACK RISK" : "WARN";
  const nm2 = p.version ? nm : `${p.name}${p.ecosystem === "pypi" ? "==" : "@"}${a.v}`;
  const l = `pintree ${tag} ${nm2}: ${a.signals.join("; ")}${a.prev ? ` (vs ${a.prev})` : ""}`;
  return a.level === "strong" ? l + "\n  ask your person; if the new release is expected: KARMADUE_APPROVED=1, or pin " + p.name + (p.ecosystem === "pypi" ? "==" : "@") + a.prev : l;
}
// "Caution before you install x@1: 3 published advisories affect x@1. Fixed in 2. Ask your person..." -> "3 advisories; fixed in 2"
const squeeze = (line) => String(line || "").replace(/^(Caution|Stop|Careful)[^:]*:\s*/i, "").replace(/\s*Ask your person[^.]*\.?/i, "").replace(/ published advisor(y|ies) affects? [^ ]+\. ?/, (m, y) => ` advisor${y}; `).replace(/\s+/g, " ").trim();
const fixVer = (line) => { const m = /Fixed in ([\w-]+(?:\.[\w-]+)*)/.exec(String(line || "")); return m ? m[1] : null; };
const tok = (s) => Math.ceil(s.length / 4);
// Tiered output. OK: one short line (~15 tokens). Trap/problem: do-this / do-not / verify (~120 tokens max). --detail: v0.1 full lines.
function terse(out, env, mode) {
  const lines = [];
  const okNames = [];
  const fresh = [];
  for (const r of out.results) {
    const nm = r.p.name + (r.p.version ? (r.p.ecosystem === "pypi" ? "==" : "@") + r.p.version : "");
    const pv = r.prov && r.prov.level !== "note" ? r.prov : null;
    if (r.prov && r.prov.level === "note") fresh.push(`${r.p.name}@${r.prov.v}(${provAge(r.prov.ageH)})`);
    if (r.trap) {
      const t = r.trap;
      lines.push(`pintree TRAP ${nm}: ${t.problem}`);
      lines.push(`  do: ${t.do}`);
      if (t.do_not) lines.push(`  don't: ${t.do_not}`);
      if (t.verify) lines.push(`  test (printed, not run): ${t.verify}`);
      if (r.kind === "block" || r.kind === "warn") lines.push(`  safety: ${r.kind} ${clip(squeeze(r.line), 70)}`);
      lines.push(`  [tested ${t.tested}; ${t.ref}]`);
    } else if (pv && (r.kind === "ok" || r.kind === "unknown")) { lines.push(provLine(r.p, pv, nm)); continue;
    } else if (r.kind === "block") lines.push(`pintree BLOCK ${nm}: ${clip(r.line, 160)}${r.alts && r.alts.length ? " alt: " + clip(r.alts.join("; "), 100) : ""}`);
    else if (r.kind === "warn") { const fv = fixVer(r.line); lines.push(`pintree WARN ${nm}: ${clip(squeeze(r.line), 110)}${fv ? `\n  do: ${r.p.name}${r.p.ecosystem === "pypi" ? "==" : "@"}${fv}` : ""}`); }
    else if (r.kind === "unchecked") lines.push(`pintree NOT CHECKED ${nm}: ${clip(r.line, 100)}${out.strict ? " (blocked, STRICT)" : " (running anyway)"}`);
    else if (r.kind === "unknown") okNames.push(nm + "?");
    else okNames.push(nm);
    if (pv && (r.trap || !(r.kind === "ok" || r.kind === "unknown"))) lines.push(provLine(r.p, pv, nm));
  }
  if (fresh.length) lines.push(`pintree new (<72h, usually normal): ${fresh.slice(0, 4).join(" ")}${fresh.length > 4 ? " +" + (fresh.length - 4) : ""}`);
  if (okNames.length && !truthy(env.KARMADUE_QUIET)) lines.unshift(`pintree ok ${okNames.join(" ")}${out.results.every((r) => r.cached === "hit") ? " (cached)" : ""}`);
  for (const n of [...new Set(out.notes)]) lines.push(n.replace(/^karmadue-guard: /, "pintree: "));
  if (out.block) lines.push(mode === "check" ? "pintree: would not run. Override: KARMADUE_ALLOW=<name>" : "pintree: NOT run. Override: KARMADUE_ALLOW=<name>");
  const text = lines.join("\n");
  if (text) err(text);
  if (truthy(env.KARMADUE_TOKENS)) err(`(pintree output ~${tok(text)} tokens)`);
}

function report(out, env, mode = "exec") {
  if (!truthy(env.KARMADUE_DETAIL)) return terse(out, env, mode);
  const lines = [...out.notes];
  for (const r of out.results) {
    const tag = r.id ? ` [${r.id}]` : "";
    if (r.trap) {
      const t = r.trap;
      lines.push(`karmadue-guard: ${r.kind === "trapblock" ? "BLOCKED (known trap)" : "KNOWN TRAP"} ${label(r.p)}: ${t.problem}`, `  Do instead: ${t.do}`, `  Do not: ${t.do_not}`);
      if (t.verify) lines.push(`  Test (printed only; the guard never runs it): ${t.verify}`);
      lines.push(`  Evidence: ${t.ref}, tested ${t.tested} in a clean temp env (fix ${t.fix_verified ? "verified" : "not run"}). Founder-operated assessment, not independent.`);
      if (r.kind === "trapblock") continue;
    }
    if (r.prov && r.prov.level !== "none") lines.push(`karmadue-guard: ${r.prov.level === "strong" ? "HIJACK RISK" : r.prov.level === "warn" ? "WARNING" : "note"} ${label(r.p)} (${r.prov.v}): ${r.prov.signals.join("; ")}${r.prov.prev ? ` (previous ${r.prov.prev})` : ""}. Registry metadata only; ${r.prov.level === "note" ? "a new release is usually normal." : "this can be a legitimate change of publisher or release process."}`);
    if (r.kind === "block") {
      lines.push(`karmadue-guard: BLOCKED ${label(r.p)}: ${r.line}${tag}`);
      if (r.alts && r.alts.length) lines.push("  Alternatives KarmaDue suggests (not endorsed; check them first):", ...r.alts);
    } else if (r.kind === "warn") {
      lines.push(`karmadue-guard: WARNING ${label(r.p)}: ${r.line}${tag}`);
      for (const x of r.reasons || []) lines.push(`  - ${x}`);
      if (r.alts && r.alts.length) lines.push("  Alternatives KarmaDue suggests (not endorsed; check them first):", ...r.alts);
    } else if (r.kind === "unknown") {
      lines.push(`karmadue-guard: NOT ASSESSED ${label(r.p)}: ${r.line}${tag}${out.strict ? " Blocked (KARMADUE_STRICT=1)." : " Set KARMADUE_STRICT=1 to block on this."}`);
    } else if (r.kind === "unchecked") {
      lines.push("karmadue-guard: ************************************************************");
      lines.push(`karmadue-guard: NOT CHECKED ${label(r.p)}: ${r.line}${tag}`);
      lines.push(`karmadue-guard: ${out.strict ? "Blocked because KARMADUE_STRICT=1." : "Running anyway because KARMADUE_STRICT is not set. This package was NOT checked; do not treat it as safe."}`);
      lines.push("karmadue-guard: ************************************************************");
    } else if (!truthy(env.KARMADUE_QUIET)) {
      lines.push(`karmadue-guard: ok ${label(r.p)}: ${r.line}${tag}`);
    }
  }
  if (out.block) lines.push(`karmadue-guard: ${mode === "check" ? "BLOCK: this command would not be run." : "the command was NOT run."}${out.warnBlocks ? " (KARMADUE_WARN=block)" : ""} To override for one package, set KARMADUE_ALLOW=<name>; you are then on your own.`);
  if (lines.length) err(lines.join("\n"));
}

// The real binary: first match on PATH that is not one of our shims.
function realBinary(tool, env) {
  const shimDirs = new Set([env.KARMADUE_SHIM_DIR, path.join(os.homedir(), ".karmadue", "shims")].filter(Boolean).map((d) => path.resolve(d)));
  const exts = process.platform === "win32" ? String(env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of String(env.PATH || "").split(path.delimiter)) {
    if (!dir || shimDirs.has(path.resolve(dir))) continue;
    for (const ext of exts) {
      const f = path.join(dir, tool + ext);
      try {
        fs.accessSync(f, fs.constants.X_OK);
        const head = fs.readFileSync(f, { encoding: "utf8", flag: "r" }).slice(0, 200);
        if (head.includes("karmadue-guard shim")) continue;
        return f;
      } catch (_) { /* next */ }
    }
  }
  return null;
}

async function cmdExec(words, env) {
  const tool = words[0];
  if (!tool) { err("usage: karmadue-guard exec <npm|npx|pnpm|yarn|pip|uv|uvx> [args...]"); return 2; }
  LOG_MODE = "exec";
  const real = realBinary(tool, env);
  if (!real) { err(`karmadue-guard: could not find the real "${tool}" on PATH (outside the shim directory).`); return 127; }
  if (truthy(env.KARMADUE_DISABLE)) err(`karmadue-guard: KARMADUE_DISABLE=1, ${tool} runs WITHOUT a KarmaDue check.`);
  else {
    let out;
    try { out = await checkWords(words, env); } catch (e) {
      out = { notes: [], results: [{ kind: "unchecked", p: { name: words.slice(1).join(" ") || tool, ecosystem: "command", version: null }, line: `karmadue-guard error: ${clip(e && e.message, 200)}` }], strict: truthy(env.KARMADUE_STRICT) };
      out.block = out.strict;
    }
    report(out, env);
    if (out.block) { logOutcome(env, tool, 1, "blocked_not_run"); return 1; }
    // 0.2.1: require_human_approval pauses. Interactive: ask y/N. Non-interactive (agents, CI): stop with exit 2.
    if (out.ask && out.ask.length && !truthy(env.KARMADUE_APPROVED)) {
      const names = out.ask.map((r) => r.p.name).join(", ");
      if (process.stdin.isTTY && process.stderr.isTTY) {
        err(`pintree: ${names} needs your OK (see above). Run it? [y/N] `);
        const buf = Buffer.alloc(16); let n = 0; try { n = fs.readSync(0, buf, 0, 16, null); } catch (_) { /* no answer */ }
        if (!/^y/i.test(buf.slice(0, n).toString())) { err("pintree: not run."); logOutcome(env, tool, 2, "declined_not_run"); return 2; }
      } else {
        err(`pintree: PAUSED, not run: ${names} needs your person's approval. Show them the line above; to proceed after they agree: KARMADUE_APPROVED=1 <same command>`);
        logOutcome(env, tool, 2, "paused_not_run");
        return 2;
      }
    }
  }
  const leaves = truthy(env.KARMADUE_LEAVES) && !truthy(env.KARMADUE_DISABLE);
  const r = spawnSync(real, words.slice(1), { stdio: leaves ? ["inherit", "inherit", "pipe"] : "inherit", env: { ...env, KARMADUE_GUARD_ACTIVE: "1" } });
  if (leaves && r.stderr) process.stderr.write(r.stderr);
  if (r.error) { err(`karmadue-guard: could not run ${real}: ${r.error.message}`); logOutcome(env, tool, 127, "could_not_run"); return 127; }
  logOutcome(env, tool, r.signal ? null : r.status, r.signal ? "signal" : undefined);
  if (r.status === 0 && !truthy(env.KARMADUE_DISABLE)) transitivePost(words, real, env);
  if (leaves && !r.signal) await sendLeaves(words, r.status, String(r.stderr || ""), env);
  if (r.signal) { process.kill(process.pid, r.signal); return 1; }
  return r.status == null ? 1 : r.status;
}

// ---- automatic leaves (OFF unless KARMADUE_LEAVES=1) ----
// Sent: package target, ecosystem, pass/fail, exit code, env key (os/arch/runtime major), command shape (tool + subcommand
// + package specs, no paths or flags with values), one scrubbed error line, a hash of a random install id, guard version.
// Never sent: paths, usernames, hostnames, env vars, full logs. The server stores leaves as pending.
function ownerHash() {
  const f = path.join(KD_DIR(), "install-id");
  let id; try { id = fs.readFileSync(f, "utf8").trim(); } catch (_) { id = crypto.randomBytes(16).toString("hex"); try { fs.mkdirSync(KD_DIR(), { recursive: true }); fs.writeFileSync(f, id, { mode: 0o600 }); } catch (_) { /* */ } }
  return crypto.createHash("sha256").update("kd-leaf-owner:" + id).digest("hex");
}
function scrubLine(s) {
  const home = os.homedir(); const user = os.userInfo().username;
  let x = String(s || "").split(home).join("~");
  if (user && user.length > 2) x = x.replace(new RegExp(user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "<user>");
  return x.replace(/(\/[^\s:'"]+)+/g, (m) => "<path>/" + path.basename(m)).replace(/[\w.+-]+@[\w-]+(\.[\w-]+)*\.[A-Za-z]{2,}\b/g, "<email>").replace(/\b[a-f0-9]{32,}\b/gi, "<hex>").replace(/\s+/g, " ").trim().slice(0, 200);
}
function envKey(eco) {
  const rt = eco === "pypi" ? (() => { try { const v = spawnSync("python3", ["-c", "import sys;print('py%d.%d'%sys.version_info[:2])"], { encoding: "utf8" }).stdout.trim(); return v || "py?"; } catch (_) { return "py?"; } })() : "node" + process.versions.node.split(".")[0];
  return `${process.platform}-${process.arch}-${rt}`;
}
async function sendLeaves(words, status, stderr, env) {
  const pk = targets(words).filter((p) => !isPrivate(p, words, env)).slice(0, 5); if (!pk.length) return;
  const errLine = status === 0 ? null : (stderr.split("\n").find((l) => /ERR|Error|error:|failed|E404|ERESOLVE/.test(l)) || "");
  const sub = words.slice(1).find((w) => !w.startsWith("-")) || "";
  const shape = [path.basename(words[0]), /^[a-z]+$/.test(sub) ? sub : "", ...pk.map((p) => p.name + (p.version ? (p.ecosystem === "pypi" ? "==" : "@") + p.version : ""))].filter(Boolean).join(" ");
  const api = String(env.KARMADUE_LEAF_API || LEAF_API).replace(/\/+$/, "");
  const owner = ownerHash();
  for (const p of pk) {
    const leaf = { target: `${p.name}${p.version ? (p.ecosystem === "pypi" ? "==" : "@") + p.version : ""}`, ecosystem: p.ecosystem, status: status === 0 ? "pass" : "fail", exit_code: status, env_key: envKey(p.ecosystem), cmd_shape: shape.slice(0, 200), err_sig: errLine ? scrubLine(errLine) : null, owner, guard_version: VERSION };
    if (truthy(env.KARMADUE_LEAVES_DRYRUN)) { err("pintree leaf (dry run): " + JSON.stringify(leaf)); continue; }
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3000);
    try { const r = await fetch(api + "/leaf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(leaf), signal: ctl.signal }); if (!truthy(env.KARMADUE_QUIET)) err(`pintree leaf ${leaf.status} ${leaf.target}: ${r.status === 202 ? "sent (pending)" : "not sent (HTTP " + r.status + ")"}`); }
    catch (_) { /* leaves never block or fail the install */ } finally { clearTimeout(t); }
  }
}

async function cmdCheck(words, env) {
  if (words.length === 1 && /\s/.test(words[0])) words = hook.splitSegments(words[0])[0] || [];
  if (!words.length) { err('usage: karmadue-guard check "npm install name@1.2.3"'); return 2; }
  const out = await checkWords(words, env);
  report(out, env, "check");
  if (!out.results.length && !out.notes.length) err("karmadue-guard: no npm or PyPI package names found in that command.");
  return out.block ? 1 : out.ask && out.ask.length ? 2 : 0;
}

function cmdInstallShims(dir, env) {
  dir = path.resolve(dir || env.KARMADUE_SHIM_DIR || path.join(os.homedir(), ".karmadue", "shims"));
  fs.mkdirSync(dir, { recursive: true });
  const self = path.resolve(__filename);
  for (const t of TOOLS) {
    const f = path.join(dir, t);
    fs.writeFileSync(f, `#!/bin/sh\n# karmadue-guard shim ${VERSION}: checks packages with KarmaDue, then runs the real ${t}.\nKARMADUE_SHIM_DIR=${q(dir)} exec node ${q(self)} exec ${t} "$@"\n`, { mode: 0o755 });
  }
  err(`karmadue-guard: wrote ${TOOLS.length} shims to ${dir}: ${TOOLS.join(", ")}`);
  err(`Put them first on PATH (add to ~/.bashrc or ~/.zshrc):\n  export PATH="${dir}:$PATH"\nor run: eval "$(node ${self} init)"`);
  return 0;
}

function cmdInit(flags, env) {
  const dir = path.resolve(env.KARMADUE_SHIM_DIR || path.join(os.homedir(), ".karmadue", "shims"));
  const self = path.resolve(__filename);
  const fish = flags.includes("--fish");
  if (flags.includes("--aliases")) {
    for (const t of TOOLS) process.stdout.write(fish ? `alias ${t} 'node ${self} exec ${t}'\n` : `alias ${t}='node ${q(self)} exec ${t}'\n`);
  } else {
    process.stdout.write(fish ? `set -gx PATH ${dir} $PATH\n` : `export PATH="${dir}:$PATH"\n`);
  }
  return 0;
}

// ---- stats: summarize the local log (no network) ----
function cmdStats(flags, env) {
  const json = flags.includes("--json"); const di = flags.indexOf("--days"); const days = di >= 0 ? Number(flags[di + 1]) : 0;
  const f = logPath(env);
  if (flags.includes("--path")) { process.stdout.write(f + "\n"); return 0; }
  let rows = [];
  try { rows = fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean); } catch (_) { /* none */ }
  if (days > 0) { const since = Date.now() - days * 864e5; rows = rows.filter((r) => Date.parse(r.t) >= since); }
  const checks = rows.filter((r) => r.type === "check" && !r.private); const priv = rows.filter((r) => r.type === "check" && r.private).reduce((a, r) => a + (r.n || 1), 0);
  const outs = rows.filter((r) => r.type === "outcome");
  const count = (arr, k) => arr.reduce((m, r) => (m[r[k]] = (m[r[k]] || 0) + 1, m), {});
  const avg = (arr) => { const v = arr.map((r) => r.ms).filter(Number.isFinite); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const hits = checks.filter((r) => r.cache === "hit"), net = checks.filter((r) => ["miss", "revalidated", "offline"].includes(r.cache));
  const ran = outs.filter((o) => !o.note || o.note === "signal");
  const out = { log: f, from: rows.length ? rows[0].t : null, to: rows.length ? rows[rows.length - 1].t : null, checks: checks.length, private_not_checked: priv,
    by_verdict: count(checks, "verdict"), by_ecosystem: count(checks, "eco"), cache: count(checks, "cache"),
    cache_hit_rate: checks.length ? Math.round(1000 * hits.length / checks.length) / 10 : null,
    avg_ms: avg(checks), avg_ms_cache_hit: avg(hits), avg_ms_network: avg(net),
    installs_run: ran.length, installs_exit_0: ran.filter((o) => o.exit === 0).length, installs_failed: ran.filter((o) => o.exit !== 0).length, not_run: outs.length - ran.length };
  if (json) { process.stdout.write(JSON.stringify(out, null, 2) + "\n"); return 0; }
  if (!rows.length) { process.stdout.write(`karmadue-guard stats: no log yet (${f}). Checks are logged locally when you run check or exec; KARMADUE_NO_LOG=1 turns logging off.\n`); return 0; }
  const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  process.stdout.write([`karmadue-guard stats (local log, never uploaded): ${f}`, `  period: ${out.from} -> ${out.to}`, `  checks: ${out.checks}  (private/custom-registry packages skipped, never named: ${priv})`,
    `  verdicts: ${fmt(out.by_verdict)}`, `  ecosystems: ${fmt(out.by_ecosystem)}`, `  cache: ${fmt(out.cache)}  (hit rate ${out.cache_hit_rate}%)`,
    `  avg ms: ${out.avg_ms}  (cache hit ${out.avg_ms_cache_hit ?? "n/a"}, network ${out.avg_ms_network ?? "n/a"})`,
    `  installs run by the guard: ${out.installs_run}  (exit 0: ${out.installs_exit_0}, failed: ${out.installs_failed}); stopped before running: ${out.not_run}`].join("\n") + "\n");
  return 0;
}

async function main(argv, env) {
  env = { ...env };
  while (argv[0] && /^--(detail|leaves|tokens|no-cache)$/.test(argv[0]) || (argv[1] && /^--(detail|leaves|tokens|no-cache)$/.test(argv[1]) && /^(check|exec)$/.test(argv[0]))) {
    const i = /^--/.test(argv[0]) ? 0 : 1; const f = argv[i];
    env[{ "--detail": "KARMADUE_DETAIL", "--leaves": "KARMADUE_LEAVES", "--tokens": "KARMADUE_TOKENS", "--no-cache": "KARMADUE_NO_CACHE" }[f]] = "1";
    argv = argv.slice(0, i).concat(argv.slice(i + 1));
  }
  const [cmd, ...rest] = argv;
  if (cmd === "--version" || cmd === "-v") { process.stdout.write(`karmadue-guard ${VERSION} (parser: hook ${hook.VERSION})\n`); return 0; }
  if (cmd === "stats") return cmdStats(rest, env);
  if (cmd === "log-clear") { try { fs.unlinkSync(logPath(env)); } catch (_) { /* */ } err("karmadue-guard: local log cleared"); return 0; }
  if (cmd === "exec") return cmdExec(rest, env);
  if (cmd === "check") return cmdCheck(rest, env);
  if (cmd === "install-shims") return cmdInstallShims(rest[0], env);
  if (cmd === "init") return cmdInit(rest, env);
  if (cmd === "cache-clear") { try { fs.unlinkSync(cachePath()); } catch (_) { /* */ } err("pintree: cache cleared"); return 0; }
  err("karmadue-guard " + VERSION + "\nusage:\n  karmadue-guard check \"npm install name@1.2.3\"\n  karmadue-guard exec npm install name@1.2.3\n  karmadue-guard install-shims [DIR]\n  karmadue-guard init [--aliases] [--fish]\n  karmadue-guard stats [--json] [--days N] [--path]   (local log summary)\n  karmadue-guard log-clear");
  return cmd ? 2 : 0;
}

if (require.main === module) main(process.argv.slice(2), process.env).then((c) => process.exit(c), (e) => { err(`karmadue-guard: ${e && e.stack || e}`); process.exit(truthy(process.env.KARMADUE_STRICT) ? 1 : 3); });
module.exports = { targets, judge, checkWords, realBinary, main, VERSION };
