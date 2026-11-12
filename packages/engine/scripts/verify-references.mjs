#!/usr/bin/env node
// Régénère les 24 fichiers de référence des 8 motifs dans un dossier, vérifie leurs
// empreintes contre le registre v0.2.0 et, si pyembroidery est disponible (PYTHON=…),
// compare la lecture pyembroidery à celle des lecteurs VYRA (points, dimensions, couleurs).
// Usage : node packages/engine/scripts/verify-references.mjs [dossier] ; PYTHON=chemin/python
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import * as E from "../src/generated/engine.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../fixtures");
const out = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "vyra-ref-"));
fs.mkdirSync(out, { recursive: true });
const reg = new Map(
  fs.readFileSync(path.join(fixtures, "empreintes-reference-v0.2.0.sha256"), "utf8").split("\n")
    .filter((l) => l && !l.startsWith("#")).map((l) => { const [h, f] = l.split(/\s+/); return [f.replace("13_EXPORTS/", ""), h]; }),
);
let ok = 0, ko = 0;
for (const m of E.DEMO_MOTIFS) {
  const png = PNG.sync.read(fs.readFileSync(path.join(fixtures, "motifs", m + ".png")));
  const opts = { ...E.DEFAULT_TRACE_OPTIONS, targetWidthMm: 100, maxHeightMm: 170, colors: E.DEMO_COLORS[m] ?? 6 };
  const plan = E.buildPlan(E.traceImage({ width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }, opts, m).design);
  for (const [ext, bytes] of [["pes", E.writePES1(plan, m)], ["v6.pes", E.writePES6(plan, m)], ["dst", E.writeDST(plan, m)]]) {
    const rel = `motifs/${m}.${ext}`;
    fs.writeFileSync(path.join(out, `${m}.${ext}`), bytes);
    const h = crypto.createHash("sha256").update(bytes).digest("hex");
    if (h === reg.get(rel)) ok++; else { ko++; console.log("DIFFÉRENT", rel); }
  }
}
console.log(`${ok}/24 fichiers identiques au registre v0.2.0 (${ko} différent(s)) — dossier ${out}`);
if (process.env.PYTHON) {
  const py = path.join(here, "pyembroidery_check.py");
  console.log(execFileSync(process.env.PYTHON, ["-I", py, out], { encoding: "utf8" }));
}
process.exit(ko ? 1 : 0);
