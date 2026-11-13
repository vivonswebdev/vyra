#!/usr/bin/env node
// Sauvegarde complète : base PostgreSQL (pg_dump, format custom) + fichiers du stockage local,
// avec un manifeste d'empreintes SHA-256 vérifié à la restauration.
// Usage : DATABASE_URL=… STORAGE_DIR=… node scripts/backup.mjs <dossier-de-sortie>
// Stockage S3 : sauvegarder le compartiment côté fournisseur (versionnage + réplication) ; ce script
// ne sauvegarde alors que la base (STORAGE_DIR absent).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const url = process.env.DATABASE_URL;
const storage = process.env.STORAGE_DIR;
const out = process.argv[2];
if (!url || !out) {
  console.error("Usage : DATABASE_URL=… [STORAGE_DIR=…] node scripts/backup.mjs <dossier>");
  process.exit(2);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = path.resolve(out, `vyra-${stamp}`);
fs.mkdirSync(dir, { recursive: true });
execFileSync("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", path.join(dir, "base.dump"), url], { stdio: "inherit" });
if (process.env.STORAGE_DRIVER === "s3") {
  // Stockage S3 : chaque objet du préfixe est copié, puis archivé avec la base.
  const { s3Client, s3Prefix } = await import("./s3-env.mjs");
  const { ListObjectsV2Command, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = s3Client();
  const prefix = s3Prefix();
  const tmp = path.join(dir, "stockage");
  let token;
  let count = 0;
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: prefix || undefined, ContinuationToken: token }));
    for (const o of r.Contents ?? []) {
      const rel = o.Key.slice(prefix.length);
      const obj = await client.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: o.Key }));
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, rel), Buffer.from(await obj.Body.transformToByteArray()));
      count++;
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  fs.mkdirSync(tmp, { recursive: true });
  execFileSync("tar", ["-czf", path.join(dir, "stockage.tar.gz"), "-C", tmp, "."], { stdio: "inherit" });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.error(`${count} objet(s) S3 sauvegardé(s).`);
} else if (storage && fs.existsSync(storage)) execFileSync("tar", ["-czf", path.join(dir, "stockage.tar.gz"), "-C", storage, "."], { stdio: "inherit" });
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex");
const files = fs.readdirSync(dir).filter((f) => f !== "manifeste.json");
const manifest = { cree_le: new Date().toISOString(), outil: "vyra scripts/backup.mjs", fichiers: Object.fromEntries(files.map((f) => [f, sha(f)])) };
fs.writeFileSync(path.join(dir, "manifeste.json"), JSON.stringify(manifest, null, 2));
console.log(dir);
