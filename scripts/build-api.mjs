#!/usr/bin/env node
// Compilation de l'API pour la production : JavaScript autonome dans dist/api, sans tsx.
// Les paquets du dépôt (@vyra/*, moteur figé compris) sont intégrés ; les dépendances tierces restent
// externes (installées par `npm ci --omit=dev`). Le moteur n'est pas modifié : il est copié tel quel
// dans le bundle du worker de calcul.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "dist/api");
fs.rmSync(out, { recursive: true, force: true });

const externalThirdParty = {
  name: "externes",
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => (args.path.startsWith("@vyra/") ? undefined : { path: args.path, external: true }));
  },
};

const common = { bundle: true, platform: "node", target: "node22", format: "esm", sourcemap: true, plugins: [externalThirdParty], logLevel: "warning",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } };

await build({ ...common, entryPoints: { server: path.join(root, "apps/api/src/server.ts"), migrate: path.join(root, "apps/api/src/db/migrate.ts") }, outdir: out, outExtension: { ".js": ".mjs" } });
await build({ ...common, entryPoints: { worker: path.join(root, "apps/api/src/engine/worker.mjs") }, outdir: out, outExtension: { ".js": ".mjs" } });
fs.cpSync(path.join(root, "apps/api/src/db/migrations"), path.join(out, "migrations"), { recursive: true });
const sha = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "inconnu";
  }
})();
fs.writeFileSync(path.join(out, "BUILD.json"), JSON.stringify({ builtAt: new Date().toISOString(), version: JSON.parse(fs.readFileSync(path.join(root, "apps/api/package.json"), "utf8")).version, git: sha }, null, 2));
console.log("dist/api :", fs.readdirSync(out).join(", "));
