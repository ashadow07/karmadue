"use strict";
// 0.4.0 real-registry checks (needs network to registry.npmjs.org, pypi.org and KarmaDue). Asserts stable historical facts only.
const fs = require("fs"), os = require("os"), path = require("path");
const { run, check, done } = require("./helpers");
(async () => {
  const E = () => ({ KARMADUE_DETAIL: "", KARMADUE_PROVENANCE: "ask", KARMADUE_NO_CACHE: "", KARMADUE_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "kd-pl-")) });
  let r = await run(["check", "npm install express@5.1.0"], E());
  check("real npm: express@5.1.0 (published by wesleytodd; 4.21.2 before it by jonchurch) shows a publisher-change WARN, no pause", /WARN express@5\.1\.0: publisher jonchurch -> wesleytodd/.test(r.err) && !/HIJACK/.test(r.err), r.err);
  r = await run(["check", "npm install sigstore@5.0.0"], E());
  check("real npm: sigstore@5.0.0 (GitHub trusted publisher, provenance) raises no hijack signal", !/HIJACK|lost provenance/.test(r.err), r.err);
  r = await run(["check", "npm install is-number@7.0.0"], E());
  check("real npm: old stable release is a plain ok", /pintree ok is-number@7\.0\.0/.test(r.err) && !/WARN|HIJACK|new \(/.test(r.err), r.err);
  r = await run(["check", "pip install sigstore==4.5.0"], E());
  check("real pypi: sigstore==4.5.0 (has PEP 740 provenance) raises no signal", !/HIJACK|lost provenance/.test(r.err), r.err);
  r = await run(["check", "pip install requests==2.32.3"], E());
  check("real pypi: requests==2.32.3 raises no provenance signal (KarmaDue advisories are separate)", !/HIJACK|lost provenance/.test(r.err), r.err);
  const e = E(); let t = Date.now(); await run(["check", "npm install react@19.0.0"], e); const cold = Date.now() - t; t = Date.now(); await run(["check", "npm install react@19.0.0"], e); const warm = Date.now() - t;
  process.stdout.write(`info react@19.0.0 (7 MB packument): cold ${cold} ms, cached ${warm} ms\n`);
  check("real: cached run stays fast (< 600 ms)", warm < 600, warm);
  done();
})();
