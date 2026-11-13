#!/usr/bin/env node
// Archive de version reproductible : application compilée + manifestes d'installation verrouillés.
// Déploiement : extraire, `npm ci --omit=dev --ignore-scripts`, puis `node dist/api/server.mjs`.
// Usage : npm run build && node scripts/release.mjs [dossier]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
for (const f of ["dist/api/server.mjs", "dist/api/worker.mjs", "dist/web/studio/index.html"]) {
  if (!fs.existsSync(path.join(root, f))) throw new Error(`${f} absent : lancez d'abord npm run build`);
}
const version = JSON.parse(fs.readFileSync(path.join(root, "apps/api/package.json"), "utf8")).version;
const sha = execFileSync("git", ["rev-parse", "--short=10", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim() !== "";
const name = `vyra-${version}-${sha}${dirty ? "-modifie" : ""}`;
const outDir = path.resolve(process.argv[2] ?? path.join(root, "release"));
const stage = path.join(outDir, name);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.cpSync(path.join(root, "dist"), path.join(stage, "dist"), { recursive: true });
for (const f of ["package.json", "package-lock.json", ".env.example"]) fs.copyFileSync(path.join(root, f), path.join(stage, f));
// Manifestes des espaces de travail : nécessaires à `npm ci` ; leur code est déjà compilé dans dist/.
for (const ws of ["apps/api", "apps/studio", "packages/engine", "packages/shared", "packages/ui"]) {
  fs.mkdirSync(path.join(stage, ws), { recursive: true });
  fs.copyFileSync(path.join(root, ws, "package.json"), path.join(stage, ws, "package.json"));
}
fs.writeFileSync(path.join(stage, "RELEASE.json"), JSON.stringify({ name, version, git: sha, modifiedTree: dirty, builtAt: new Date().toISOString(), node: ">=22" }, null, 2));
const tarball = path.join(outDir, `${name}.tar.gz`);
execFileSync("tar", ["-czf", tarball, "-C", outDir, name]);
const hash = crypto.createHash("sha256").update(fs.readFileSync(tarball)).digest("hex");
fs.writeFileSync(tarball + ".sha256", `${hash}  ${path.basename(tarball)}\n`);
console.log(tarball);
