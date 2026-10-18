#!/usr/bin/env node
// KarmaDue pre-install check for Claude Code (PreToolUse hook on the Bash tool).
// No dependencies. Node 18+ (uses global fetch).
//
// Reads the PreToolUse JSON on stdin, finds package installs in tool_input.command,
// asks KarmaDue POST /v1/preflight about each package@version, and prints one JSON
// object on stdout:
//   - deny  : a malicious-package report or a confirmed KarmaDue refusal covers that exact version
//   - warn  : known advisories affect that version (adds context for Claude and a message for you;
//             set KARMADUE_WARN=ask to get a permission prompt instead)
//   - quiet : nothing found, or not an install command (exit 0, no output: normal permission flow)
// Network errors and timeouts fail open (the command proceeds) unless KARMADUE_STRICT=1.
// A reply the hook cannot interpret is never treated as "nothing found": it warns (or denies
// under KARMADUE_STRICT=1), so a change in KarmaDue's reply format can't make the hook go silent.
//
// Version 1.1.0 (2026-10-11). Reads both reply formats: data.decision/enforce (current) and
// data.install_decision (v1, before 2026-10-11).
//
// Environment:
//   KARMADUE_API         REST base (default https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/public-api)
//   KARMADUE_TIMEOUT_MS  per-check timeout, default 5000
//   KARMADUE_STRICT=1    deny when KarmaDue can't be reached or answers with an error
//   KARMADUE_WARN=ask    turn advisory warnings into a permission prompt ("ask")
//   KARMADUE_ALLOW       comma-separated package names to skip (your own overrides), e.g. "vm2,left-pad"
//   KARMADUE_DISABLE=1   do nothing
"use strict";

const VERSION = "1.1.0";
const DEFAULT_API = "https://ogogoizwsfaduzehkshb.supabase.co/functions/v1/public-api";
const MAX_CHECKS = 8;

// ---------- shell-ish tokenizer ----------
// Splits a command line into segments at ; && || | & and newlines, honoring quotes.
// Also pulls in the bodies of $( ... ) and backticks as their own segments.
function splitSegments(cmd) {
  const segs = [];
  const extra = [];
  let cur = [];
  let tok = "";
  let hasTok = false;
  let i = 0;
  const pushTok = () => { if (hasTok) { cur.push(tok); } tok = ""; hasTok = false; };
  const pushSeg = () => { pushTok(); if (cur.length) segs.push(cur); cur = []; };
  while (i < cmd.length) {
    const c = cmd[i];
    if (c === "\\" && i + 1 < cmd.length) {
      if (cmd[i + 1] === "\n") { i += 2; continue; }
      tok += cmd[i + 1]; hasTok = true; i += 2; continue;
    }
    if (c === "'") {
      const j = cmd.indexOf("'", i + 1);
      const end = j < 0 ? cmd.length : j;
      tok += cmd.slice(i + 1, end); hasTok = true; i = end + 1; continue;
    }
    if (c === '"') {
      let j = i + 1; let s = "";
      while (j < cmd.length && cmd[j] !== '"') {
        if (cmd[j] === "\\" && j + 1 < cmd.length) { s += cmd[j + 1]; j += 2; continue; }
        s += cmd[j]; j++;
      }
      const sub = s.match(/\$\(([^)]*)\)/g);
      if (sub) sub.forEach((m) => extra.push(m.slice(2, -1)));
      tok += s; hasTok = true; i = j + 1; continue;
    }
    if (c === "$" && cmd[i + 1] === "(") {
      let depth = 1; let j = i + 2;
      while (j < cmd.length && depth > 0) { if (cmd[j] === "(") depth++; else if (cmd[j] === ")") depth--; j++; }
      extra.push(cmd.slice(i + 2, j - 1));
      tok += "$(...)"; hasTok = true; i = j; continue;
    }
    if (c === "`") {
      const j = cmd.indexOf("`", i + 1);
      const end = j < 0 ? cmd.length : j;
      extra.push(cmd.slice(i + 1, end));
      tok += "`...`"; hasTok = true; i = end + 1; continue;
    }
    if (c === "#" && !hasTok) { // comment to end of line
      const j = cmd.indexOf("\n", i);
      i = j < 0 ? cmd.length : j; continue;
    }
    if (c === ";" || c === "\n" || c === "|" || c === "&" || c === "(" || c === ")") {
      pushSeg();
      i++;
      while (i < cmd.length && (cmd[i] === "|" || cmd[i] === "&")) i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") { pushTok(); i++; continue; }
    tok += c; hasTok = true; i++;
  }
  pushSeg();
  for (const e of extra) segs.push(...splitSegments(e));
  return segs;
}

// Drops leading VAR=value, sudo/env/time/command/exec/nohup wrappers.
function stripPrefix(words) {
  let w = words.slice();
  for (;;) {
    if (!w.length) return w;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) { w.shift(); continue; }
    if (["sudo", "env", "time", "command", "exec", "nohup", "doas"].includes(w[0])) {
      w.shift();
      while (w.length && w[0].startsWith("-")) w.shift(); // sudo -E, env -i
      continue;
    }
    if (w[0] === "cd" || w[0] === "export") return []; // not an install
    return w;
  }
}

// Options that take a separate value, per tool (so the value isn't mistaken for a package).
const VALUE_OPTS = {
  npm: ["--registry", "--prefix", "--cache", "--userconfig", "--tag", "-w", "--workspace", "--omit", "--include", "--loglevel", "-C"],
  pnpm: ["--registry", "--dir", "-C", "--filter", "-F", "--store-dir", "--loglevel", "-w", "--workspace"],
  yarn: ["--registry", "--cwd", "--cache-folder", "--modules-folder", "--network-timeout"],
  bun: ["--registry", "--cwd", "--backend", "--cache-dir", "-c", "--config"],
  npx: ["--registry", "--cache", "--userconfig", "--node-options", "-c", "--call"],
  pip: ["-r", "--requirement", "-c", "--constraint", "-i", "--index-url", "--extra-index-url", "-f", "--find-links", "-t", "--target", "--prefix", "--root", "--python", "--platform", "--python-version", "--implementation", "--abi", "--trusted-host", "--cache-dir", "--src", "--upgrade-strategy", "--progress-bar", "--log", "--timeout", "--retries", "--proxy", "--cert", "--client-cert", "--config-settings", "-C", "--global-option", "--build-option", "--no-binary", "--only-binary"],
  uv: ["-p", "--python", "-r", "--requirement", "-c", "--constraint", "--index", "--index-url", "--default-index", "--extra-index-url", "-f", "--find-links", "--with", "-w", "--with-requirements", "--from", "--directory", "--project", "--group", "--optional", "--extra", "--cache-dir", "--target", "--prefix", "--python-platform", "--index-strategy", "--resolution", "--prerelease", "--exclude-newer", "--config-file", "--color"],
  pipx: ["--python", "--pip-args", "--index-url", "--spec", "--suffix", "--preinstall", "--fetch-missing-python"],
  cargo: ["--version", "--vers", "--git", "--branch", "--tag", "--rev", "--path", "--root", "--registry", "--index", "--features", "-F", "--target", "--target-dir", "-j", "--jobs", "--profile", "--bin", "--example", "--config", "-Z", "--color"],
  go: ["-C", "-ldflags", "-gcflags", "-tags", "-o", "-mod", "-modfile", "-overlay", "-pkgdir", "-asmflags", "-buildmode", "-compiler", "-gccgoflags", "-installsuffix", "-p", "-pgo", "-toolexec"],
  brew: ["--cask-dir"],
  claude: ["-s", "--scope", "-t", "--transport", "-e", "--env", "-H", "--header", "--client-id", "--callback-port"],
};

function positional(args, tool) {
  const vo = VALUE_OPTS[tool] || [];
  const out = [];
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") { out.push(...args.slice(i + 1).map((x) => ({ v: x, afterDashDash: true }))); break; }
    if (a.startsWith("-") && a.length > 1) {
      const eq = a.indexOf("=");
      const name = eq > 0 ? a.slice(0, eq) : a;
      if (eq > 0) { (opts[name] = opts[name] || []).push(a.slice(eq + 1)); continue; }
      if (vo.includes(name) && i + 1 < args.length) { (opts[name] = opts[name] || []).push(args[i + 1]); i++; continue; }
      (opts[name] = opts[name] || []).push(true);
      continue;
    }
    out.push({ v: a });
  }
  return { pos: out.map((x) => x.v), opts, raw: out };
}

// ---------- spec parsing ----------
function looksLocal(s) {
  return /^(\.{0,2}\/|~|file:|link:|workspace:|git\+|git:|github:|https?:|ssh:|\$)/.test(s) || /\.(tgz|tar\.gz|whl|zip)$/i.test(s) || s.includes("$(") || s.includes("`");
}

function npmSpec(s) {
  if (!s || looksLocal(s)) return null;
  if (/^npm:/.test(s)) s = s.slice(4);
  let name = s; let version = null;
  const at = s.lastIndexOf("@");
  if (at > 0) { name = s.slice(0, at); version = s.slice(at + 1) || null; }
  if (!/^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i.test(name)) return null;
  if (version && !/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(version)) version = null; // ranges/tags: let KarmaDue use the latest it knows
  return { ecosystem: "npm", name: name.toLowerCase(), version, spec: s };
}

function pypiSpec(s) {
  if (!s || looksLocal(s) || s.startsWith("-")) return null;
  const m = s.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(?:(===?|~=|>=|<=|!=|>|<)\s*([^,;\s]+))?/);
  if (!m) return null;
  const name = m[1].toLowerCase().replace(/[._]+/g, "-");
  const version = m[3] === "==" || m[3] === "===" ? m[4] : null;
  return { ecosystem: "pypi", name, version: version && /^[0-9][0-9A-Za-z.!+-]*$/.test(version) ? version : null, spec: s };
}

function cargoSpec(s, ver) {
  if (!s || looksLocal(s)) return null;
  let name = s; let version = ver || null;
  const at = s.indexOf("@");
  if (at > 0) { name = s.slice(0, at); version = s.slice(at + 1); }
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return null;
  if (version) version = version.replace(/^=/, "");
  return { ecosystem: "cargo", name, version: version && /^\d+\.\d+\.\d+/.test(version) ? version : null, spec: s };
}

function goSpec(s) {
  if (!s || /^\.{0,2}\//.test(s)) return null;
  const at = s.lastIndexOf("@");
  const name = at > 0 ? s.slice(0, at) : s;
  const version = at > 0 ? s.slice(at + 1) : null;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(name)) return null;
  return { ecosystem: "go", name, version: version && /^v\d/.test(version) ? version : null, spec: s };
}

function brewSpec(s) {
  if (!s || !/^[a-z0-9@+._/-]+$/i.test(s)) return null;
  return { ecosystem: "brew", name: s.toLowerCase(), version: null, spec: s };
}

// ---------- per-command extraction ----------
function fromWords(words0, depth) {
  const words = stripPrefix(words0);
  if (!words.length) return [];
  let cmd = words[0].split("/").pop();
  let args = words.slice(1);
  const out = [];
  const add = (spec, via) => { if (spec) out.push({ ...spec, via }); };

  // python -m pip install ..., python3 -m pip
  if (/^python[0-9.]*$/.test(cmd) && args[0] === "-m" && args[1] && /^pip[0-9.]*$/.test(args[1])) { cmd = "pip"; args = args.slice(2); }
  if (cmd === "corepack" && ["pnpm", "yarn", "npm"].includes(args[0])) { cmd = args[0]; args = args.slice(1); }

  if (cmd === "npm") {
    const sub = args.find((a) => !a.startsWith("-"));
    const rest = args.slice(args.indexOf(sub) + 1);
    if (["install", "i", "add", "isntall", "in", "ins", "inst", "insta", "instal", "isnt", "isnta", "isntal"].includes(sub)) {
      positional(rest, "npm").pos.forEach((p) => add(npmSpec(p), "npm install"));
    } else if (sub === "exec" || sub === "x") {
      const { pos, opts } = positional(rest, "npx");
      const pk = [].concat(opts["--package"] || [], opts["-p"] || []).filter((x) => x !== true);
      if (pk.length) pk.forEach((p) => add(npmSpec(p), "npm exec"));
      else if (pos[0]) add(npmSpec(pos[0]), "npm exec");
    }
  } else if (cmd === "npx" || cmd === "bunx" || cmd === "pnpx") {
    const vo = ["--package", "-p"];
    const pk = []; let first = null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (vo.includes(a)) { if (args[i + 1]) pk.push(args[++i]); continue; }
      if (a.startsWith("--package=")) { pk.push(a.slice(10)); continue; }
      if (a.startsWith("-")) continue;
      first = a; break;
    }
    if (pk.length) pk.forEach((p) => add(npmSpec(p), cmd));
    else if (first) add(npmSpec(first), cmd);
  } else if (cmd === "pnpm" || cmd === "yarn" || cmd === "bun") {
    let a = args.slice();
    if (cmd === "yarn" && a[0] === "global") a = a.slice(1);
    const sub = a.find((x) => !x.startsWith("-"));
    const rest = a.slice(a.indexOf(sub) + 1);
    if (["add", "install", "i"].includes(sub)) {
      positional(rest, cmd).pos.forEach((p) => add(npmSpec(p), `${cmd} ${sub}`));
    } else if (sub === "dlx" || (cmd === "bun" && sub === "x")) {
      const { pos, opts } = positional(rest, "npx");
      const pk = [].concat(opts["--package"] || [], opts["-p"] || []).filter((x) => x !== true);
      if (pk.length) pk.forEach((p) => add(npmSpec(p), `${cmd} ${sub}`));
      else if (pos[0]) add(npmSpec(pos[0]), `${cmd} ${sub}`);
    }
  } else if (/^pip[0-9.]*$/.test(cmd)) {
    if (args[0] === "install") positional(args.slice(1), "pip").pos.forEach((p) => add(pypiSpec(p), "pip install"));
  } else if (cmd === "uv") {
    if (args[0] === "pip" && args[1] === "install") positional(args.slice(2), "uv").pos.forEach((p) => add(pypiSpec(p), "uv pip install"));
    else if (args[0] === "add") positional(args.slice(1), "uv").pos.forEach((p) => add(pypiSpec(p), "uv add"));
    else if (args[0] === "tool" && (args[1] === "install" || args[1] === "run")) {
      const { pos, opts } = positional(args.slice(2), "uv");
      const from = (opts["--from"] || []).filter((x) => x !== true);
      if (from.length) from.forEach((p) => add(pypiSpec(p), "uv tool"));
      else if (pos[0]) add(pypiSpec(pos[0]), "uv tool");
      (opts["--with"] || []).filter((x) => x !== true).forEach((p) => add(pypiSpec(p), "uv tool --with"));
    }
  } else if (cmd === "uvx") {
    const { pos, opts } = positional(args, "uv");
    const from = (opts["--from"] || []).filter((x) => x !== true);
    if (from.length) from.forEach((p) => add(pypiSpec(p), "uvx"));
    else if (pos[0]) add(pypiSpec(pos[0]), "uvx");
    (opts["--with"] || []).filter((x) => x !== true).forEach((p) => add(pypiSpec(p), "uvx --with"));
  } else if (cmd === "pipx") {
    if (args[0] === "install" || args[0] === "run") {
      const { pos, opts } = positional(args.slice(1), "pipx");
      const spec = (opts["--spec"] || []).filter((x) => x !== true);
      if (spec.length) spec.forEach((p) => add(pypiSpec(p), `pipx ${args[0]}`));
      else if (args[0] === "run") { if (pos[0]) add(pypiSpec(pos[0]), "pipx run"); }
      else pos.forEach((p) => add(pypiSpec(p), "pipx install"));
    }
  } else if (cmd === "cargo") {
    if (args[0] === "install") {
      const { pos, opts } = positional(args.slice(1), "cargo");
      if (opts["--git"] || opts["--path"]) return out;
      const ver = [].concat(opts["--version"] || [], opts["--vers"] || []).find((x) => x !== true);
      pos.forEach((p) => add(cargoSpec(p, ver), "cargo install"));
    }
  } else if (cmd === "go") {
    if (args[0] === "install" || args[0] === "get") positional(args.slice(1), "go").pos.forEach((p) => add(goSpec(p), `go ${args[0]}`));
    else if (args[0] === "run") { const p = positional(args.slice(1), "go").pos[0]; if (p && p.includes("@")) add(goSpec(p), "go run"); }
  } else if (cmd === "brew") {
    if (args[0] === "install" || args[0] === "reinstall") positional(args.slice(1), "brew").pos.forEach((p) => add(brewSpec(p), "brew install"));
  } else if (cmd === "claude" && args[0] === "mcp" && (args[1] === "add" || args[1] === "add-json")) {
    if (args[1] === "add-json") {
      const { pos } = positional(args.slice(2), "claude");
      try {
        const j = JSON.parse(pos[1] || "{}");
        if (j.command && depth < 2) out.push(...fromWords([j.command, ...(j.args || [])], depth + 1).map((x) => ({ ...x, via: "claude mcp add-json" })));
        if (j.url) out.push({ ecosystem: "url", name: j.url, version: null, spec: j.url, via: "claude mcp add-json" });
      } catch (_) { /* not JSON we can read */ }
    } else {
      const rest = args.slice(2);
      const { raw } = positional(rest, "claude");
      // raw[0] is the server name; the remainder (after it, or after --) is the command or URL.
      const tail = raw.slice(1).map((x) => x.v);
      if (tail.length) {
        if (/^https?:\/\//.test(tail[0])) out.push({ ecosystem: "url", name: tail[0], version: null, spec: tail[0], via: "claude mcp add" });
        else if (depth < 2) out.push(...fromWords(tail, depth + 1).map((x) => ({ ...x, via: "claude mcp add" })));
      }
    }
  }
  return out;
}

function extractInstalls(command) {
  if (typeof command !== "string" || !command.trim()) return [];
  const seen = new Set();
  const out = [];
  for (const seg of splitSegments(command)) {
    for (const p of fromWords(seg, 0)) {
      const key = `${p.ecosystem}:${p.name}@${p.version || ""}`;
      if (seen.has(key)) continue;
      seen.add(key); out.push(p);
    }
  }
  return out;
}

function targetFor(p) {
  if (p.ecosystem === "npm") return `npm:${p.name}${p.version ? "@" + p.version : ""}`;
  if (p.ecosystem === "pypi") return `pypi:${p.name}${p.version ? "==" + p.version : ""}`;
  if (p.ecosystem === "cargo") return `cargo:${p.name}${p.version ? "@" + p.version : ""}`;
  if (p.ecosystem === "go") return `go:${p.name}${p.version ? "@" + p.version : ""}`;
  if (p.ecosystem === "brew") return `brew:${p.name}`;
  return p.name;
}

function label(p) { return p.ecosystem === "url" ? p.name : `${p.name}${p.version ? "@" + p.version : ""} (${p.ecosystem})`; }

// ---------- KarmaDue call ----------
async function preflight(p, env) {
  const api = (env.KARMADUE_API || DEFAULT_API).replace(/\/+$/, "");
  const timeout = Math.max(500, Number(env.KARMADUE_TIMEOUT_MS) || 5000);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(`${api}/v1/preflight`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": `karmadue-preinstall-hook/${VERSION} (claude-code)` },
      body: JSON.stringify({ target: targetFor(p), action: "install_connector" }),
      signal: ctl.signal,
    });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (_) { /* fallthrough */ }
    if (!r.ok) return { pkg: p, error: `KarmaDue answered HTTP ${r.status}` };
    if (!j || typeof j !== "object") return { pkg: p, body: null, unparsed: `reply was not JSON (${clip(text, 80) || "empty"})` };
    return { pkg: p, body: j };
  } catch (e) {
    return { pkg: p, error: e && e.name === "AbortError" ? `KarmaDue did not answer within ${timeout} ms` : `could not reach KarmaDue (${(e && e.message) || e})` };
  } finally { clearTimeout(t); }
}

function clip(s, n) { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "..." : s; }

function altLines(data) {
  const alts = (data && Array.isArray(data.alternatives)) ? data.alternatives.slice(0, 3) : [];
  return alts.map((a) => {
    const name = clip(a.title || a.name || a.resource_id || "", 80);
    const ws = Array.isArray(a.why_suggested) ? a.why_suggested.join("; ") : a.why_suggested;
    const why = clip(ws || a.why || "", 160);
    const link = a.passport || a.url || a.ref || "";
    const recipe = a.recipe && a.recipe.url ? ` recipe: ${a.recipe.url}` : "";
    return `  - ${name}${why ? " (" + why + ")" : ""}${link ? " " + link : ""}${recipe}`;
  });
}

// Known decision values. Anything else is "unparsed" and is reported, never ignored.
const DENY = new Set(["deny"]);
const WARN = new Set(["warn", "unverified_existence", "require_human_approval"]);
const QUIET = new Set(["allow", "no_known_issues", "unknown"]);
const ENFORCE = new Set(["proceed", "proceed_with_care", "require_human_approval", "block"]);

function advisoryIdsFrom(list) {
  return (list || []).map((a) => {
    if (!a || typeof a !== "object") return null;
    if (a.advisory_id) return a.advisory_id;
    const ref = a.ref || a.url || "";
    const m = /\/(?:vulnerability|advisories|vuln\/detail)\/([A-Za-z0-9._:-]+)\/?$/.exec(ref);
    return m ? m[1] : null;
  }).filter(Boolean);
}

function withIds(base, ids) {
  const shown = ids.slice(0, 5);
  return base + (shown.length ? " IDs: " + shown.join(", ") + (ids.length > shown.length ? " and more" : "") + "." : "");
}

// Normalizes either reply format into {kind: deny|warn|ok|unparsed, line, alts}.
function interpret(body) {
  if (!body || typeof body !== "object") return { kind: "unparsed", why: "empty reply" };
  if (body.ok === false) return { kind: "unparsed", why: `KarmaDue returned an error (${clip(body.error && (body.error.message || body.error.code || JSON.stringify(body.error)), 120) || "no detail"})` };
  const data = body.data;
  if (!data || typeof data !== "object") return { kind: "unparsed", why: "reply has no data object" };
  const alts = altLines(data);

  // v1 format (before 2026-10-11): data.install_decision.{decision, decision_line, advisories}
  const d = data.install_decision;
  if (d && typeof d === "object" && typeof d.decision === "string") {
    const line = d.decision_line || d.reason || "";
    if (DENY.has(d.decision)) return { kind: "deny", line: line || "KarmaDue holds a malicious-package report or confirmed refusal for this version.", alts, format: "v1" };
    if (d.decision === "warn") return { kind: "warn", line: withIds(line || "Published advisories affect this version.", advisoryIdsFrom(d.advisories)), alts, format: "v1" };
    if (QUIET.has(d.decision)) return { kind: "ok", format: "v1" };
    return { kind: "unparsed", why: `unrecognized install_decision.decision "${clip(d.decision, 40)}"` };
  }

  // Current format: data.{decision, enforce, headline, reasons[], evidence[], alternatives[]}
  if (typeof data.decision === "string" || typeof data.enforce === "string") {
    const dec = String(data.decision || ""); const enf = String(data.enforce || "");
    const known = (dec === "" || DENY.has(dec) || WARN.has(dec) || QUIET.has(dec)) && (enf === "" || ENFORCE.has(enf));
    if (!known) return { kind: "unparsed", why: `unrecognized decision "${clip(dec, 40)}" / enforce "${clip(enf, 40)}"` };
    const reasons = Array.isArray(data.reasons) ? data.reasons.filter((x) => typeof x === "string") : [];
    const line = [data.headline, reasons[0]].filter(Boolean).join(" ");
    if (DENY.has(dec) || enf === "block") return { kind: "deny", line: line || "KarmaDue holds a malicious-package report or confirmed refusal for this version.", alts, format: "current" };
    if (WARN.has(dec)) {
      const ids = advisoryIdsFrom((Array.isArray(data.evidence) ? data.evidence : []).filter((e) => e && (e.kind === "advisory" || e.kind === "malware_report")));
      return { kind: "warn", line: withIds(line || "KarmaDue flagged this version.", ids), alts, format: "current" };
    }
    if (QUIET.has(dec)) return { kind: "ok", format: "current" };
    return { kind: "unparsed", why: `decision missing (enforce "${clip(enf, 40)}")` };
  }
  return { kind: "unparsed", why: "reply has neither data.decision nor data.install_decision" };
}

function evaluate(res) {
  const p = res.pkg;
  if (res.error) return { kind: "error", pkg: p, line: res.error };
  if (res.unparsed) return { kind: "unparsed", pkg: p, line: `KarmaDue's reply could not be read: ${res.unparsed}. This package was NOT checked.` };
  const r = interpret(res.body);
  if (r.kind === "unparsed") return { kind: "unparsed", pkg: p, line: `KarmaDue's reply could not be read: ${r.why}. This package was NOT checked (the hook may be out of date: re-download it from https://karmadue.expo.app/hooks/karmadue-preinstall.js).` };
  if (r.kind === "ok") return { kind: "ok", pkg: p };
  return { kind: r.kind, pkg: p, line: clip(r.line, 400), alts: r.alts };
}

function packageAllowed(p, env) {
  const list = String(env.KARMADUE_ALLOW || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(p.name.toLowerCase()) || list.includes(`${p.name}@${p.version || ""}`.toLowerCase());
}

async function decide(input, env) {
  if (env.KARMADUE_DISABLE === "1") return null;
  if (!input || input.tool_name !== "Bash") return null;
  const command = input.tool_input && input.tool_input.command;
  const pkgs = extractInstalls(command).filter((p) => !packageAllowed(p, env));
  if (!pkgs.length) return null;
  const checked = pkgs.slice(0, MAX_CHECKS);
  const results = (await Promise.all(checked.map((p) => preflight(p, env)))).map(evaluate);
  const strict = env.KARMADUE_STRICT === "1" || env.KARMADUE_STRICT === "true";
  const denies = results.filter((r) => r.kind === "deny");
  const warns = results.filter((r) => r.kind === "warn");
  const errors = results.filter((r) => r.kind === "error");
  const unparsed = results.filter((r) => r.kind === "unparsed");
  const more = pkgs.length > MAX_CHECKS ? ` (${pkgs.length - MAX_CHECKS} more packages in this command were not checked)` : "";
  const block = (r) => [`- ${label(r.pkg)}: ${r.line}`].concat(r.alts && r.alts.length ? ["  Alternatives KarmaDue suggests by similarity and evidence (not endorsed; check them yourself):", ...r.alts] : []).join("\n");

  if (denies.length || (strict && (errors.length || unparsed.length))) {
    const parts = [];
    if (denies.length) parts.push("KarmaDue pre-install check blocked this command:\n" + denies.map(block).join("\n"));
    if (strict && (errors.length || unparsed.length)) parts.push("KarmaDue strict mode: these could not be checked, so the command is blocked:\n" + errors.concat(unparsed).map((r) => `- ${label(r.pkg)}: ${r.line}`).join("\n"));
    if (warns.length) parts.push("Also flagged:\n" + warns.map(block).join("\n"));
    if (!strict && (errors.length || unparsed.length)) parts.push("Not checked:\n" + errors.concat(unparsed).map((r) => `- ${label(r.pkg)}: ${r.line}`).join("\n"));
    parts.push("Pick a different version or package. If you are sure, the user can run the install themselves or add the package to KARMADUE_ALLOW." + more);
    const reason = parts.join("\n\n");
    return {
      systemMessage: `KarmaDue blocked: ${denies.map((r) => label(r.pkg)).concat(strict ? errors.concat(unparsed).map((r) => label(r.pkg) + " (unchecked, strict)") : []).join(", ")}`,
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    };
  }
  if (warns.length || unparsed.length) {
    const parts = [];
    if (warns.length) parts.push("KarmaDue pre-install check flagged (the command was not blocked):\n" + warns.map(block).join("\n") + "\nConsider a fixed version or another package. Tell the user what was flagged.");
    if (unparsed.length) parts.push("KarmaDue pre-install check could NOT read KarmaDue's reply, so these were not checked (do not treat them as safe):\n" + unparsed.map((r) => `- ${label(r.pkg)}: ${r.line}`).join("\n") + "\nTell the user the check did not run.");
    if (errors.length) parts.push("Not checked:\n" + errors.map((r) => `- ${label(r.pkg)}: ${r.line}`).join("\n"));
    const text = parts.join("\n\n") + more;
    const msg = [];
    if (warns.length) msg.push(`KarmaDue warning: ${warns.map((r) => label(r.pkg)).join(", ")}`);
    if (unparsed.length) msg.push(`KarmaDue check NOT done (unreadable reply; hook may be out of date): ${unparsed.map((r) => label(r.pkg)).join(", ")}`);
    const out = {
      systemMessage: msg.join(" | "),
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: text },
    };
    if ((env.KARMADUE_WARN || "").toLowerCase() === "ask") {
      out.hookSpecificOutput.permissionDecision = "ask";
      out.hookSpecificOutput.permissionDecisionReason = clip(text, 1500);
    }
    return out;
  }
  if (errors.length) {
    return { systemMessage: `KarmaDue pre-install check skipped (${clip(errors[0].line, 120)}); the command was not checked (fail-open).` };
  }
  return null;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  let input = null;
  try { input = JSON.parse(await readStdin()); } catch (_) { process.exit(0); }
  let out = null;
  try { out = await decide(input, process.env); } catch (e) {
    if (process.env.KARMADUE_STRICT === "1") {
      out = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `KarmaDue hook error in strict mode: ${clip(e && e.message, 200)}` } };
    } else {
      process.stderr.write(`karmadue-preinstall: ${e && e.message}\n`);
      out = { systemMessage: `KarmaDue pre-install hook error (${clip(e && e.message, 160)}); the command was not checked (fail-open).` };
    }
  }
  if (out) process.stdout.write(JSON.stringify(out) + "\n");
  process.exit(0);
}

if (require.main === module) main();
module.exports = { extractInstalls, splitSegments, targetFor, decide, interpret, VERSION };
