"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const GUARD = path.join(__dirname, "..", "karmadue-guard.js");
const TOOLS = ["npm", "npx", "pnpm", "pnpx", "yarn", "pip", "pip3", "uv", "uvx"];

// A temp dir with stub "real" tools that log their argv and exit with $STUB_EXIT (default 0), plus a shim dir.
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kd-guard-"));
  const stubs = path.join(root, "stubs"); const shims = path.join(root, "shims"); const log = path.join(root, "ran.log");
  fs.mkdirSync(stubs);
  for (const t of TOOLS) fs.writeFileSync(path.join(stubs, t), `#!/bin/sh\necho "${t} $*" >> ${JSON.stringify(log)}\nexit \${STUB_EXIT:-0}\n`, { mode: 0o755 });
  const ran = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : []);
  const reset = () => { try { fs.unlinkSync(log); } catch (_) { /* none */ } };
  return { root, stubs, shims, ran, reset };
}

// Async on purpose: the offline mock server lives in this process and must keep answering while the child runs.
function spawnP(file, args, env, timeout = 90000) {
  return new Promise((resolve) => {
    const c = spawn(file, args, { env });
    let out = "", err = "";
    c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => c.kill("SIGKILL"), timeout);
    c.on("close", (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}
function run(args, env, opts = {}) {
  return spawnP(process.execPath, [GUARD, ...args], { PATH: process.env.PATH, HOME: process.env.HOME, KARMADUE_DETAIL: "1", KARMADUE_NO_CACHE: "1", KARMADUE_PROVENANCE: "off", KARMADUE_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "kd-home-")), ...env }, opts.timeout);
}

let failures = 0, passes = 0;
function check(name, cond, detail) {
  if (cond) { passes++; process.stdout.write(`ok   ${name}\n`); }
  else { failures++; process.stdout.write(`FAIL ${name}\n${detail ? String(detail).split("\n").map((l) => "     " + l).join("\n") + "\n" : ""}`); }
}
function done() { process.stdout.write(`\n${passes} passed, ${failures} failed\n`); process.exit(failures ? 1 : 0); }

module.exports = { GUARD, sandbox, run, spawnP, check, done };
