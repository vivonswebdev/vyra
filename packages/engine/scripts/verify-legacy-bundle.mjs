#!/usr/bin/env node
// Exécute le build d'origine VYRA Studio v0.2 (legacy/vyra-studio-0.2/index.html) dans Chromium,
// exporte les 8 motifs de test en PES v1, PES v6 et DST par son interface, et compare chaque fichier
// au registre d'empreintes v0.2.0. Preuve indépendante du moteur extrait. Aucun fichier n'est modifié.
// Usage : node packages/engine/scripts/verify-legacy-bundle.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../legacy/vyra-studio-0.2");
const reg = new Map(
  fs.readFileSync(path.join(root, "registre/empreintes-reference-v0.2.0.sha256"), "utf8").split("\n")
    .filter((l) => l && !l.startsWith("#")).map((l) => { const [h, f] = l.split(/\s+/); return [h, f]; }),
);
const types = { ".html": "text/html", ".png": "image/png", ".json": "application/json", ".sha256": "text/plain" };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) return r.writeHead(404).end();
  r.writeHead(200, { "content-type": types[path.extname(f)] ?? "application/octet-stream" });
  fs.createReadStream(f).pipe(r);
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch();
const page = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForTimeout(1000);
const motifs = ["01-chat", "02-fleur", "03-papillon", "04-logo", "05-prenom", "06-motif-arabe", "07-geometrique", "08-illustration"];
let ok = 0;
const rows = [];
for (const m of motifs) {
  await page.selectOption("select[aria-label]", m);
  await page.waitForTimeout(300);
  const replace = page.getByRole("button", { name: "Remplacer" });
  if (await replace.isVisible().catch(() => false)) await replace.click();
  await page.waitForFunction((m) => window.__stitch?.design?.name?.includes(m.slice(3)) && window.__stitch?.plan?.stitches?.length > 0, m, { timeout: 90_000 });
  for (const fmt of ["PES v1", "PES v6", "DST"]) {
    await page.locator("header.top .menu-wrap > button").click();
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(".menu-wrap button", { has: page.locator("b", { hasText: new RegExp(`^${fmt}$`) }) }).click(),
    ]);
    const h = crypto.createHash("sha256").update(fs.readFileSync(await dl.path())).digest("hex");
    const ref = reg.get(h);
    if (ref) ok++;
    rows.push(`${ref ? "IDENTIQUE" : "DIFFÉRENT"}  ${m} ${fmt}  ${h}  ${ref ?? "aucune référence"}`);
  }
}
await browser.close();
server.close();
console.log(rows.join("\n"));
console.log(`${ok}/24 exports du build d'origine identiques au registre v0.2.0.`);
process.exit(ok === 24 ? 0 : 1);
