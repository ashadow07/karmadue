#!/usr/bin/env node
// Runs karmadue-preinstall.js against fixture PreToolUse inputs and checks the
// stdout/exit contract from https://code.claude.com/docs/en/hooks (PreToolUse):
// exit 0; stdout is empty or exactly one JSON object; hookSpecificOutput.hookEventName
// is "PreToolUse"; permissionDecision, when present, is allow|deny|ask|defer.
// Default: a local mock of POST /v1/preflight serving fixtures/preflight-responses.json
// (fresh live captures, refresh with `node test/capture.js`), the v1-format replies in
// fixtures/preflight-responses-legacy.json, and deliberately broken replies (format drift).
// --live: call the real KarmaDue API for every case that does not need a mock.
// Live-only guarantees (CI): blocks event-stream@3.3.6 and postmark-mcp@1.0.18, warns on
// jinja2==2.11.2, stays quiet on is-number@7.0.0.
"use strict";
const { spawnSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const HOOK = path.join(__dirname, "..", "karmadue-preinstall.js");
const FX = path.join(__dirname, "fixtures");
const live = process.argv.includes("--live");
const canned = JSON.parse(fs.readFileSync(path.join(FX, "preflight-responses.json"), "utf8")).responses;
const legacy = JSON.parse(fs.readFileSync(path.join(FX, "preflight-responses-legacy.json"), "utf8")).responses;
// Broken replies: each must produce a loud warning (or a deny under strict), never silence.
const DRIFT = {
  "unknown-shape": { status: 200, body: { ok: true, data: { verdict: "bad", score: 3 } } },
  "unknown-decision": { status: 200, body: { ok: true, data: { decision: "quarantine", enforce: "hold" } } },
  "not-json": { status: 200, raw: "<html>maintenance</html>" },
  "ok-false": { status: 200, body: { ok: false, error: { code: "internal", message: "boom" } } },
};

const CASES = [
  { f: "deny-event-stream", expect: "deny", mustInclude: ["event-stream@3.3.6", "GHSA-mh6f-8j2x-4483"], ci: true },
  { f: "deny-postmark", expect: "deny", mustInclude: ["MAL-2025-47604", "Alternatives", "ActiveCampaign/postmark-mcp"], ci: true },
  { f: "deny-in-chain", expect: "deny", mustInclude: ["postmark-mcp"] },
  { f: "claude-mcp-add-deny", expect: "deny", mustInclude: ["postmark-mcp"] },
  { f: "warn-pip-jinja2", expect: "warn", mustInclude: ["jinja2==2.11.2", "3.1.6"], ci: true },
  { f: "warn-ask", expect: "ask", env: { KARMADUE_WARN: "ask" }, mustInclude: ["jinja2"] },
  { f: "allow-clean-npm", expect: "quiet", ci: true },
  { f: "allow-clean-npx", expect: "quiet" },
  { f: "warn-unverified-name", expect: "warn", mustInclude: ["Cannot establish"] },
  { f: "not-an-install", expect: "quiet", noCalls: true },
  { f: "npm-install-lockfile", expect: "quiet", noCalls: true },
  { f: "curl-pipe-sh", expect: "quiet", noCalls: true, note: "documented gap: curl | sh is not inspected" },
  { f: "other-tool", expect: "quiet", noCalls: true },
  { f: "allowlisted", expect: "quiet", env: { KARMADUE_ALLOW: "event-stream" }, noCalls: true },
  { f: "network-error", expect: "message-only", env: { KARMADUE_API: "http://127.0.0.1:9" }, mockless: true, mustInclude: ["fail-open"] },
  { f: "network-error-strict", expect: "deny", env: { KARMADUE_API: "http://127.0.0.1:9", KARMADUE_STRICT: "1" }, mockless: true, mustInclude: ["strict"] },
  // Format drift: mock-only (also run under --live, against the mock).
  { f: "drift-unknown-shape", expect: "warn", drift: "unknown-shape", mustInclude: ["NOT checked", "could NOT read"] },
  { f: "drift-unknown-decision", expect: "warn", drift: "unknown-decision", mustInclude: ["quarantine", "NOT checked"] },
  { f: "drift-not-json", expect: "warn", drift: "not-json", mustInclude: ["not JSON", "NOT checked"] },
  { f: "drift-ok-false", expect: "warn", drift: "ok-false", mustInclude: ["boom", "NOT checked"] },
  { f: "drift-strict", expect: "deny", drift: "unknown-shape", env: { KARMADUE_STRICT: "1" }, mustInclude: ["strict"] },
  // Backward compatibility with the v1 reply format (data.install_decision).
  { f: "legacy-deny", expect: "deny", legacy: true, mustInclude: ["MAL-2025-47604"] },
  { f: "legacy-warn", expect: "warn", legacy: true, mustInclude: ["PYSEC-2026-1475"] },
  { f: "legacy-allow", expect: "quiet", legacy: true },
];

function classify(stdout) {
  const s = stdout.trim();
  if (!s) return { kind: "quiet" };
  if (!s.startsWith("{") || !s.endsWith("}")) throw new Error("stdout is not a single JSON object");
  const j = JSON.parse(s);
  const allowedTop = ["continue", "stopReason", "suppressOutput", "systemMessage", "terminalSequence", "hookSpecificOutput"];
  for (const k of Object.keys(j)) if (!allowedTop.includes(k)) throw new Error(`unexpected top-level field ${k}`);
  const h = j.hookSpecificOutput;
  if (h) {
    if (h.hookEventName !== "PreToolUse") throw new Error("hookEventName must be PreToolUse");
    if (h.permissionDecision && !["allow", "deny", "ask", "defer"].includes(h.permissionDecision)) throw new Error("bad permissionDecision");
    if (h.permissionDecision && typeof h.permissionDecisionReason !== "string") throw new Error("decision without reason");
    for (const k of ["additionalContext", "permissionDecisionReason"]) if (h[k] && h[k].length > 10000) throw new Error(`${k} over 10,000 chars`);
    if (h.permissionDecision === "deny") return { kind: "deny", j };
    if (h.permissionDecision === "ask") return { kind: "ask", j };
    if (h.additionalContext) return { kind: "warn", j };
  }
  return { kind: "message-only", j };
}

async function main() {
  let calls = 0;
  const server = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      calls++;
      let t = null; try { t = JSON.parse(b).target; } catch (_) {}
      const mode = (req.url.match(/^\/(legacy|drift-[a-z-]+|current)\//) || [])[1] || "current";
      if (!/\/v1\/preflight$/.test(req.url) || req.method !== "POST") { res.writeHead(404); res.end(); return; }
      if (mode.startsWith("drift-")) {
        const d = DRIFT[mode.slice(6)];
        res.writeHead(d.status, { "content-type": d.raw ? "text/html" : "application/json" });
        res.end(d.raw || JSON.stringify(d.body)); return;
      }
      const table = mode === "legacy" ? legacy : canned;
      const body = table[t];
      if (!body) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, error: { message: `no fixture for ${t}` } })); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const mockApi = `http://127.0.0.1:${server.address().port}`;
  let pass = 0; let fail = 0;
  const ciOnly = process.argv.includes("--ci");
  for (const c of CASES.filter((x) => !ciOnly || x.ci)) {
    const input = fs.readFileSync(path.join(FX, c.f + ".json"), "utf8");
    const viaMock = !live || c.drift || c.legacy;
    const prefix = c.drift ? `/drift-${c.drift}` : c.legacy ? "/legacy" : "/current";
    const env = { ...process.env, KARMADUE_API: mockApi + prefix, ...(c.env || {}) };
    if (!viaMock && !c.mockless) delete env.KARMADUE_API;
    for (const k of ["KARMADUE_STRICT", "KARMADUE_WARN", "KARMADUE_ALLOW", "KARMADUE_DISABLE"]) if (!(c.env && k in c.env)) delete env[k];
    if (live) env.KARMADUE_TIMEOUT_MS = "15000";
    const before = calls;
    const t0 = Date.now();
    // Live only: an unreachable or rate-limited API makes the hook fail open with a message.
    // That is correct behaviour, not format drift, so retry such a case up to twice before failing.
    let r; let attempt = 0;
    for (;;) {
    r = await new Promise((resolve) => {
      const { spawn } = require("child_process");
      const p = spawn(process.execPath, [HOOK], { env });
      let out = ""; let err = "";
      p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
      p.on("close", (code) => resolve({ status: code, stdout: out, stderr: err }));
      p.stdin.end(input);
    });
    attempt++;
    const transient = !viaMock && !c.mockless && c.expect !== "message-only" && /"systemMessage":"KarmaDue pre-install check skipped/.test(r.stdout);
    if (!transient || attempt > 2) break;
    console.log(`  retry ${c.f} (transient: ${r.stdout.trim().slice(0, 160)})`);
    await new Promise((res) => setTimeout(res, 3000 * attempt));
    }
    const ms = Date.now() - t0;
    let ok = true; let why = ""; let got = null;
    try {
      if (r.status !== 0) throw new Error(`exit ${r.status}`);
      got = classify(r.stdout);
      if (got.kind !== c.expect) throw new Error(`expected ${c.expect}, got ${got.kind}`);
      const text = r.stdout;
      for (const m of c.mustInclude || []) if (!text.includes(m)) throw new Error(`output lacks "${m}"`);
      if (c.noCalls && viaMock && calls !== before) throw new Error("made a network call it should not have");
    } catch (e) { ok = false; why = e.message; }
    if (ok) pass++; else fail++;
    console.log(`${ok ? "PASS" : "FAIL"} ${c.f.padEnd(24)} ${(viaMock && !c.mockless ? (c.drift ? "mock:drift" : c.legacy ? "mock:legacy" : "mock") : c.mockless ? "no-server" : "LIVE").padEnd(11)} ${String(got ? got.kind : "?").padEnd(12)} ${ms}ms${why ? "  " + why : ""}${c.note ? "  (" + c.note + ")" : ""}`);
    if ((process.argv.includes("-v") || !ok) && r.stdout.trim()) console.log("   stdout: " + r.stdout.trim().slice(0, 1500));
  }
  server.close();
  console.log(`\n${pass} passed, ${fail} failed (${live ? "live KarmaDue API; drift and legacy cases on the mock" : "mock API: fresh live captures, legacy format, format drift"})`);
  process.exit(fail ? 1 : 0);
}
main();
