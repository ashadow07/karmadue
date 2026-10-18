#!/usr/bin/env node
// Live tests against KarmaDue's public check (no account). Stub "real" tools record whether they ran.
//   node test/live.js          stubs only (nothing is installed)
//   node test/live.js --real   also drives the real npm and pip through the shims in a temp dir (CI)
// Guarantees: blocks event-stream@3.3.6, postmark-mcp@1.0.18 and the PyPI typosquat rsquests (MAL-2026-5304);
// warns on jinja2==2.11.2; allows is-number.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { sandbox, run, spawnP, check, done } = require("./helpers");

const real = process.argv.includes("--real");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const sb = sandbox();
  const env = { PATH: `${sb.stubs}:${process.env.PATH}`, KARMADUE_TIMEOUT_MS: "15000" };
  // A transient "NOT CHECKED" (network blip, cold start) is retried once; a wrong decision is not.
  const ex = async (cmd, extra = {}) => {
    for (let i = 0; ; i++) {
      sb.reset();
      const o = await run(["exec", ...cmd], { ...env, ...extra });
      if (!/NOT CHECKED/.test(o.err) || i >= 2) return { ...o, ran: sb.ran() };
      process.stdout.write(`     (retrying after a transient failure: ${o.err.split("\n")[1] || ""})\n`); await sleep(4000);
    }
  };
  const CASES = [
    { cmd: ["npm", "install", "event-stream@3.3.6"], block: true, must: [/BLOCKED event-stream@3\.3\.6/, /GHSA-mh6f-8j2x-4483/] },
    { cmd: ["npx", "-y", "postmark-mcp@1.0.18"], block: true, must: [/BLOCKED postmark-mcp@1\.0\.18/, /MAL-2025-47604/] },
    { cmd: ["pip", "install", "rsquests"], block: true, must: [/BLOCKED rsquests \(pypi\)/, /MAL-2026-5304/] },
    { cmd: ["uv", "pip", "install", "rsquests"], block: true, must: [/MAL-2026-5304/] },
    { cmd: ["pnpm", "add", "event-stream@3.3.6"], block: true, must: [/GHSA-mh6f-8j2x-4483/] },
    { cmd: ["pip", "install", "jinja2==2.11.2"], block: false, pause: true, must: [/WARNING jinja2==2\.11\.2 \(pypi\)/, /3\.1\.6/] },
    { cmd: ["npm", "install", "is-number"], block: false, must: [/ok is-number \(npm\)/, /\[(request|receipt) [\w-]+\]/], mustNot: [/WARNING|BLOCKED|NOT CHECKED/] },
    { cmd: ["npm", "install", "is-number@7.0.0"], block: false, must: [/ok is-number@7\.0\.0/] },
  ];
  for (const c of CASES) {
    const o = await ex(c.cmd);
    const ok = (c.pause ? o.code === 2 && o.ran.length === 0 && /PAUSED|needs your/.test(o.err) : c.block ? o.code === 1 && o.ran.length === 0 : o.code === 0 && o.ran.length === 1) && c.must.every((re) => re.test(o.err)) && !(c.mustNot || []).some((re) => re.test(o.err));
    check(`${c.cmd.join(" ")} -> ${c.pause ? "paused for approval" : c.block ? "blocked" : "runs"}`, ok, `exit ${o.code}, ran ${JSON.stringify(o.ran)}\n${o.err}`);
  }
  sb.reset();
  const s = await run(["exec", "npm", "install", "is-number"], { ...env, KARMADUE_API: "http://127.0.0.1:9", KARMADUE_STRICT: "1" });
  check("KarmaDue unreachable + KARMADUE_STRICT=1 -> blocked, loudly", s.code === 1 && /NOT CHECKED/.test(s.err) && sb.ran().length === 0, s.err);

  if (real) {
    await run(["install-shims", sb.shims], env);
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "kd-guard-real-"));
    // A venv for pip (system pythons refuse installs under PEP 668); the shims sit ahead of it on PATH.
    await spawnP("python3", ["-m", "venv", path.join(work, "venv")], process.env, 120000);
    const renv = { PATH: `${sb.shims}:${path.join(work, "venv", "bin")}:${process.env.PATH}`, HOME: process.env.HOME, KARMADUE_TIMEOUT_MS: "15000" };
    const sh = (cmd) => spawnP("sh", ["-c", `cd ${JSON.stringify(work)} && ${cmd}`], renv, 240000);
    await sh("npm init -y >/dev/null");
    let o = await sh("npm install --no-audit --no-fund event-stream@3.3.6");
    check("real npm via shim: event-stream@3.3.6 not installed", o.code !== 0 && !fs.existsSync(path.join(work, "node_modules", "event-stream")) && /GHSA-mh6f-8j2x-4483/.test(o.err), o.err);
    o = await sh("npm install --no-audit --no-fund is-number@7.0.0");
    check("real npm via shim: is-number@7.0.0 installed", o.code === 0 && fs.existsSync(path.join(work, "node_modules", "is-number", "package.json")), o.err);
    o = await sh("KARMADUE_APPROVED=1 pip install --dry-run --no-deps jinja2==2.11.2");
    check("real pip via shim: jinja2==2.11.2 warned, pip ran", o.code === 0 && /WARNING jinja2==2\.11\.2/.test(o.err) && /Would install|jinja2/i.test(o.out + o.err), o.out + o.err);
    o = await sh("pip install --dry-run rsquests");
    check("real pip via shim: rsquests blocked before pip ran", o.code === 1 && /MAL-2026-5304/.test(o.err) && !/Collecting|Would install/.test(o.out + o.err), o.out + o.err);
  }
  done();
})();
