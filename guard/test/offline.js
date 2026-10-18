#!/usr/bin/env node
// Offline tests: parsing, decisions against a local mock of POST /v1/preflight, loud failure, strict mode, shims.
"use strict";
const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { sandbox, run, spawnP, check, done } = require("./helpers");
const guard = require("../karmadue-guard.js");

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const r = (decision, enforce, headline, extra = {}) => ({ status: 200, body: { ok: true, data: { decision, enforce, headline, reasons: [], evidence: [], alternatives: [], ...extra }, request_id: `req-${decision}` } });
const REPLIES = {
  "npm:bad-pkg@1.0.0": r("deny", "block", "Do not install bad-pkg@1.0.0: malicious-package report MAL-2099-1.", { evidence: [{ kind: "malware_report", ref: "https://osv.dev/vulnerability/MAL-2099-1" }], alternatives: [{ name: "good-pkg", why: "same job" }] }),
  "pypi:old-lib==1.0": r("warn", "require_human_approval", "Caution before you install old-lib==1.0: 3 published advisories affect old-lib@1.0. Fixed in 2.0.", { reasons: ["3 published advisories affect old-lib@1.0. Fixed in 2.0."] }),
  "npm:clean-pkg": r("no_known_issues", "proceed_with_care", "No advisories or malicious-package reports cover clean-pkg@2.0.0.", { receipt_id: "kdr_test1" }),
  "npm:mystery": r("unknown", "require_human_approval", "Not assessed: KarmaDue has no safety evidence for mystery."),
  "npm:ghost-name": r("unverified_existence", "require_human_approval", "Cannot establish that ghost-name exists on npm."),
  "npm:server-error": { status: 500, raw: "oops" },
  "npm:not-json": { status: 200, raw: "<html>maintenance</html>" },
  "npm:drift": { status: 200, body: { ok: true, data: { verdict: "fine" } } },
};
const seen = [];
const server = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const j = JSON.parse(b || "{}"); seen.push(j);
    const rep = REPLIES[j.target] || r("no_known_issues", "proceed_with_care", `No advisories cover ${j.target}.`);
    res.writeHead(rep.status, { "content-type": "application/json" });
    res.end(rep.raw != null ? rep.raw : JSON.stringify(rep.body));
  });
});

server.listen(0, "127.0.0.1", async () => {
  const API = `http://127.0.0.1:${server.address().port}`;
  const sb = sandbox();
  const env = { KARMADUE_API: API, PATH: `${sb.stubs}:${process.env.PATH}`, KARMADUE_TIMEOUT_MS: "3000" };
  const ex = (cmd, extra = {}) => { sb.reset(); seen.length = 0; return run(["exec", ...cmd], { ...env, ...extra }); };

  // parser: the hook's code, unchanged
  const hookSrc = path.join(__dirname, "..", "..", "claude-code", "hooks", "karmadue-preinstall.js");
  if (fs.existsSync(hookSrc)) check("vendored parser is byte-identical to claude-code/hooks/karmadue-preinstall.js (1.1.0)", sha(hookSrc) === sha(path.join(__dirname, "..", "lib", "karmadue-preinstall.js")));
  const t = (w) => guard.targets(w).map((p) => `${p.ecosystem}:${p.name}${p.version ? "@" + p.version : ""}|${p.via}`);
  check("npm install: names and pinned versions", JSON.stringify(t(["npm", "install", "-D", "a@1.2.3", "@s/b", "--save-exact"])) === JSON.stringify(["npm:a@1.2.3|npm install", "npm:@s/b|npm install"]), t(["npm", "install", "-D", "a@1.2.3", "@s/b"]));
  check("npx -y pkg@ver is a run", t(["npx", "-y", "postmark-mcp@1.0.18"])[0] === "npm:postmark-mcp@1.0.18|npx");
  check("pip install with == pin", t(["pip", "install", "jinja2==2.11.2"])[0] === "pypi:jinja2@2.11.2|pip install");
  check("uv pip install", t(["uv", "pip", "install", "rsquests"])[0] === "pypi:rsquests|uv pip install");
  check("pnpm add / yarn add", t(["pnpm", "add", "x@1.0.0"])[0] === "npm:x@1.0.0|pnpm add" && t(["yarn", "add", "y"])[0] === "npm:y|yarn add");
  check("arguments with spaces or quotes do not become packages", t(["pip", "install", "--index-url", "https://x y", "z"]).join() === "pypi:z|pip install", t(["pip", "install", "--index-url", "https://x y", "z"]));
  check("not an install: no packages", t(["npm", "run", "build"]).length === 0 && t(["pip", "list"]).length === 0 && t(["uv", "sync"]).length === 0);

  // decisions through exec (the shims' path)
  let o = await ex(["npm", "install", "bad-pkg@1.0.0"]);
  check("deny blocks: exit 1, real npm not run, reason and alternatives printed", o.code === 1 && sb.ran().length === 0 && /BLOCKED bad-pkg@1\.0\.0/.test(o.err) && /MAL-2099-1/.test(o.err) && /good-pkg/.test(o.err) && /NOT run/.test(o.err), o.err);
  check("install action sent for npm install", seen[0] && seen[0].action === "install");
  o = await ex(["npx", "-y", "clean-pkg"]);
  check("npx sends action run", seen[0] && seen[0].action === "run", JSON.stringify(seen));
  o = await ex(["pip", "install", "old-lib==1.0"]);
  check("0.2.1: require_human_approval PAUSES (exit 2, real pip not run)", o.code === 2 && sb.ran().length === 0 && /WARNING old-lib==1\.0 \(pypi\)/.test(o.err) && /PAUSED/.test(o.err), o.err);
  o = await ex(["pip", "install", "old-lib==1.0"], { KARMADUE_APPROVED: "1" });
  check("0.2.1: KARMADUE_APPROVED=1 runs it after the person agrees", o.code === 0 && sb.ran()[0] === "pip install old-lib==1.0", o.err);
  o = await ex(["pip", "install", "old-lib==1.0"], { KARMADUE_WARN: "block" });
  check("KARMADUE_WARN=block blocks a warn", o.code === 1 && sb.ran().length === 0);
  o = await ex(["npm", "install", "clean-pkg"]);
  check("clean: one line with the receipt id, then runs", o.code === 0 && sb.ran().length === 1 && /ok clean-pkg \(npm\).*\[receipt kdr_test1\]/.test(o.err), o.err);
  o = await ex(["npm", "install", "clean-pkg"], { KARMADUE_QUIET: "1" });
  check("KARMADUE_QUIET=1: nothing printed for a clean package", o.code === 0 && o.err.trim() === "", o.err);
  o = await ex(["npm", "install", "mystery"]);
  check("unknown: says not assessed, runs", o.code === 0 && sb.ran().length === 1 && /NOT ASSESSED mystery/.test(o.err), o.err);
  o = await ex(["npm", "install", "mystery"], { KARMADUE_STRICT: "1" });
  check("unknown under KARMADUE_STRICT=1: blocked", o.code === 1 && sb.ran().length === 0, o.err);
  o = await ex(["npm", "install", "ghost-name"]);
  check("unverified_existence (approval): pauses, not run", o.code === 2 && sb.ran().length === 0 && /WARNING ghost-name/.test(o.err), o.err);
  o = await ex(["npm", "install", "ghost-name"], { KARMADUE_STRICT: "1" });
  check("unverified_existence under strict: blocked", o.code === 1 && sb.ran().length === 0);
  for (const name of ["server-error", "not-json", "drift"]) {
    o = await ex(["npm", "install", name]);
    check(`${name}: loud NOT CHECKED banner, runs (fail-open, never silent)`, o.code === 0 && sb.ran().length === 1 && /NOT CHECKED/.test(o.err) && /\*{20}/.test(o.err), o.err);
    o = await ex(["npm", "install", name], { KARMADUE_STRICT: "1" });
    check(`${name} under strict: blocked`, o.code === 1 && sb.ran().length === 0, o.err);
  }
  o = await ex(["npm", "install", "clean-pkg"], { KARMADUE_API: "http://127.0.0.1:9" });
  check("API unreachable: loud, runs", o.code === 0 && /NOT CHECKED clean-pkg.*could not reach KarmaDue/.test(o.err) && sb.ran().length === 1, o.err);
  o = await ex(["npm", "install", "clean-pkg"], { KARMADUE_API: "http://127.0.0.1:9", KARMADUE_STRICT: "1" });
  check("API unreachable under strict: blocked", o.code === 1 && sb.ran().length === 0);
  o = await ex(["npm", "install", "bad-pkg@1.0.0"], { KARMADUE_ALLOW: "bad-pkg" });
  check("KARMADUE_ALLOW skips the check and says so", o.code === 0 && /skipped \(KARMADUE_ALLOW\)/.test(o.err) && seen.length === 0);
  o = await ex(["npm", "install", "bad-pkg@1.0.0"], { KARMADUE_DISABLE: "1" });
  check("KARMADUE_DISABLE=1 runs and says it was not checked", o.code === 0 && /WITHOUT a KarmaDue check/.test(o.err));
  o = await ex(["npm", "run", "build"]);
  check("non-install commands pass straight through, no calls, no output", o.code === 0 && seen.length === 0 && o.err === "" && sb.ran()[0] === "npm run build");
  o = await ex(["npm", "ci"]);
  check("lockfile install: says it is not checked here", o.code === 0 && /NOT checked here/.test(o.err));
  o = await ex(["pip", "install", "-r", "requirements.txt"]);
  check("pip -r: says requirements files are not checked", /requirements, constraints and editable files are NOT checked/.test(o.err));
  o = await ex(["npm", "install", "clean-pkg"], { STUB_EXIT: "7" });
  check("real tool's exit code is passed through", o.code === 7);
  o = await run(["check", "npm install bad-pkg@1.0.0 clean-pkg"], env);
  check("check mode: exit 1 for a block, nothing run", o.code === 1 && /would not be run/.test(o.err));

  // shims on PATH ahead of the real tools: no recursion, real tool found
  await run(["install-shims", sb.shims], env);
  const shimEnv = { ...env, PATH: `${sb.shims}:${sb.stubs}:${process.env.PATH}` };
  check("install-shims wrote 9 executable shims", ["npm", "npx", "pnpm", "pnpx", "yarn", "pip", "pip3", "uv", "uvx"].every((x) => fs.statSync(path.join(sb.shims, x)).mode & 0o100));
  sb.reset();
  let s = await spawnP(path.join(sb.shims, "npm"), ["install", "bad-pkg@1.0.0"], shimEnv);
  check("shim npm blocks deny", s.code === 1 && sb.ran().length === 0 && /BLOCK/.test(s.err), s.err);
  sb.reset();
  s = await spawnP("sh", ["-c", "uv pip install old-lib==1.0"], { ...shimEnv, KARMADUE_APPROVED: "1" });
  check("shim found via PATH (uv pip install): approved warn runs the real uv once", s.code === 0 && JSON.stringify(sb.ran()) === JSON.stringify(["uv pip install old-lib==1.0"]), s.err + JSON.stringify(sb.ran()));
  const init = await run(["init"], { ...env, KARMADUE_SHIM_DIR: sb.shims });
  check("init prints the PATH line", init.out.trim() === `export PATH="${sb.shims}:$PATH"`, init.out);
  const al = await run(["init", "--aliases"], env);
  check("init --aliases prints 9 aliases", al.out.trim().split("\n").length === 9 && /alias npm=/.test(al.out));
  server.close();
  done();
});
