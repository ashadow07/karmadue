#!/usr/bin/env node
// The one-line installer, run against dist/ over file:// (no network): installs, shims work, a tampered file is refused.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnP, check, done } = require("./helpers");
(async () => {
  const dist = path.join(__dirname, "..", "dist");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "kd-guard-home-"));
  const env = { PATH: process.env.PATH, HOME: home, KARMADUE_GUARD_BASE: `file://${dist}` };
  let o = await spawnP("sh", [path.join(dist, "install.sh")], env);
  check("install.sh installs and prints the PATH line", o.code === 0 && /export PATH="[^"]*\.karmadue\/shims:\$PATH"/.test(o.out), o.out + o.err);
  check("shims and CLI present", ["npm", "pip", "uv", "npx"].every((t) => fs.existsSync(path.join(home, ".karmadue", "shims", t))) && fs.existsSync(path.join(home, ".karmadue", "guard", "lib", "karmadue-preinstall.js")));
  o = await spawnP(path.join(home, ".karmadue", "shims", "npm"), ["--version"], { PATH: `${path.join(home, ".karmadue", "shims")}:${process.env.PATH}`, HOME: home });
  check("installed shim passes non-install commands to the real npm", o.code === 0 && /^\d+\.\d+/.test(o.out.trim()), o.out + o.err);
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), "kd-guard-bad-"));
  fs.cpSync(dist, bad, { recursive: true });
  fs.appendFileSync(path.join(bad, "karmadue-guard.js"), "\n// tampered\n");
  const home2 = fs.mkdtempSync(path.join(os.tmpdir(), "kd-guard-home2-"));
  o = await spawnP("sh", [path.join(bad, "install.sh")], { PATH: process.env.PATH, HOME: home2, KARMADUE_GUARD_BASE: `file://${bad}` });
  check("tampered download: checksum mismatch, nothing installed", o.code !== 0 && /checksum mismatch/.test(o.err) && !fs.existsSync(path.join(home2, ".karmadue", "guard", "karmadue-guard.js")), o.err);
  done();
})();
