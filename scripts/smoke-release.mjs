#!/usr/bin/env node
// Test de fumée d'une archive de version, en NODE_ENV=production, avec de vrais services :
// PostgreSQL, ClamAV (clamd), stockage S3 (MinIO ou fournisseur), SMTP (Mailpit). Aucun déploiement public :
// le serveur écoute sur 127.0.0.1. Usage :
//   node scripts/smoke-release.mjs <archive.tar.gz>
// Variables : SMOKE_DATABASE_URL, S3_TEST_ENDPOINT/ACCESS_KEY/SECRET_KEY, SMTP_TEST_URL, MAILPIT_TEST_API, CLAMD_TEST_PORT.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";

const tarball = path.resolve(process.argv[2] ?? "");
if (!fs.existsSync(tarball)) throw new Error("Archive introuvable : " + tarball);
const expected = fs.readFileSync(tarball + ".sha256", "utf8").split(/\s+/)[0];
const actual = crypto.createHash("sha256").update(fs.readFileSync(tarball)).digest("hex");
if (expected !== actual) throw new Error("Empreinte de l'archive incorrecte");

const env = (k, d) => process.env[k] ?? d;
const DB = env("SMOKE_DATABASE_URL", "postgres://vyra:vyra@127.0.0.1:5432/vyra_smoke");
const S3 = { endpoint: env("S3_TEST_ENDPOINT", "http://127.0.0.1:9000"), ak: env("S3_TEST_ACCESS_KEY", ""), sk: env("S3_TEST_SECRET_KEY", "") };
const SMTP = env("SMTP_TEST_URL", "smtp://127.0.0.1:1025");
const MAILPIT = env("MAILPIT_TEST_API", "http://127.0.0.1:8025");
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const step = (m) => console.log("✓ " + m);

// 1. Installation telle qu'en production
const work = fs.mkdtempSync(path.join(os.tmpdir(), "vyra-smoke-"));
execFileSync("tar", ["-xzf", tarball, "-C", work]);
const app = path.join(work, fs.readdirSync(work)[0]);
execFileSync("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: app, stdio: "inherit" });
if (fs.existsSync(path.join(app, "node_modules/tsx"))) throw new Error("tsx ne doit pas être installé en production");
step("archive vérifiée et installée sans dépendances de développement (pas de tsx)");

// 2. Base et compartiment neufs
const pg = (await import("pg")).default;
const admin = new pg.Client({ connectionString: DB.replace(/\/[^/]+$/, "/postgres") });
await admin.connect().catch(async () => {});
const dbName = DB.split("/").pop();
await admin.query(`DROP DATABASE IF EXISTS ${dbName}`).catch(() => {});
await admin.query(`CREATE DATABASE ${dbName}`);
await admin.end();
const bucket = "vyra-smoke-" + crypto.randomBytes(3).toString("hex");
await new S3Client({ endpoint: S3.endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: S3.ak, secretAccessKey: S3.sk } }).send(new CreateBucketCommand({ Bucket: bucket }));
await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });

// 3. Rôles PostgreSQL (lot H1) : création, préparation de la base, mots de passe de test aléatoires.
//    Puis migration par vyra_migrator (rôle propriétaire pris pendant la migration), droits de transition,
//    et démarrage du serveur avec vyra_app, sans aucun privilège de migration.
const runSql = async (url, file) => {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(fs.readFileSync(path.join(app, "scripts/db", file), "utf8"));
  } finally {
    await c.end();
  }
};
await runSql(DB.replace(/\/[^/]+$/, "/postgres"), "roles.sql");
await runSql(DB, "database-setup.sql");
const pw = { migrator: crypto.randomBytes(18).toString("hex"), app: crypto.randomBytes(18).toString("hex") };
{
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  await c.query(`ALTER ROLE vyra_migrator PASSWORD '${pw.migrator}'`);
  await c.query(`ALTER ROLE vyra_app PASSWORD '${pw.app}'`);
  await c.end();
}
const asRole = (role, password) => DB.replace(/^postgres(ql)?:\/\/[^@]+@/, `postgres://${role}:${password}@`);
const MIGRATOR_URL = asRole("vyra_migrator", pw.migrator);
const APP_URL = asRole("vyra_app", pw.app);
const metricsToken = crypto.randomBytes(24).toString("hex");
const prodEnv = {
  PATH: process.env.PATH, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(PORT), PUBLIC_URL: "https://studio.vyra.example",
  SECRET_KEY: crypto.randomBytes(32).toString("base64"), WEB_DIST_DIR: path.join(app, "dist/web"),
  MAIL_TRANSPORT: "smtp", SMTP_URL: SMTP, MAIL_FROM: "VYRA <no-reply@vyra.example>",
  FILE_SCAN: "clamd", CLAMD_PORT: env("CLAMD_TEST_PORT", "3310"),
  STORAGE_DRIVER: "s3", S3_ENDPOINT: S3.endpoint, S3_REGION: "us-east-1", S3_BUCKET: bucket, S3_ACCESS_KEY_ID: S3.ak, S3_SECRET_ACCESS_KEY: S3.sk,
  METRICS_TOKEN: metricsToken, LOG_LEVEL: "warn",
};
execFileSync(process.execPath, ["dist/api/migrate.mjs"], {
  cwd: app, stdio: "inherit",
  env: { ...prodEnv, DATABASE_URL: APP_URL, MIGRATION_DATABASE_URL: MIGRATOR_URL, MIGRATION_SET_ROLE: "vyra_owner" },
});
await runSql(MIGRATOR_URL, "grants-h1.sql");
step("migration séparée par vyra_migrator, objets possédés par vyra_owner, droits de transition appliqués");

// 4. Démarrage en production avec vyra_app
const child = spawn(process.execPath, ["dist/api/server.mjs"], {
  cwd: app,
  env: {
    ...prodEnv, DATABASE_URL: APP_URL,
  },
  stdio: ["ignore", "inherit", "inherit"],
});
const stop = () => child.kill("SIGTERM");
try {
  for (let i = 0; i < 60; i++) {
    if ((await fetch(`${BASE}/api/health`).catch(() => null))?.ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const ready = await (await fetch(`${BASE}/api/ready`)).json();
  if (!ready.ok) throw new Error("ready : " + JSON.stringify(ready.checks));
  step("démarrage en production avec vyra_app (sans privilège de migration) : base, migrations, stockage S3, moteur, antivirus, e-mails prêts");

  // 5. Parcours réel
  const H = { "x-vyra-client": "web", "content-type": "application/json", origin: "https://studio.vyra.example" };
  const email = `smoke-${Date.now()}@example.com`;
  let r = await fetch(`${BASE}/api/auth/signup`, { method: "POST", headers: H, body: JSON.stringify({ email, password: "motdepasse-solide-42", displayName: "Smoke", acceptTerms: true }) });
  if (r.status !== 202) throw new Error("signup " + r.status);
  let token = null;
  for (let i = 0; i < 40 && !token; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    const s = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
    if (s.messages?.length) token = /token=([A-Za-z0-9_-]+)/.exec((await (await fetch(`${MAILPIT}/api/v1/message/${s.messages[0].ID}`)).json()).Text)?.[1];
  }
  if (!token) throw new Error("e-mail de vérification non reçu");
  step("inscription : e-mail réellement envoyé par SMTP et reçu");
  r = await fetch(`${BASE}/api/auth/verify-email`, { method: "POST", headers: H, body: JSON.stringify({ token }) });
  const cookie = r.headers.get("set-cookie") ?? "";
  if (!/^__Host-vyra_session=[^;]+;.*HttpOnly;.*Secure;.*SameSite=Lax/i.test(cookie)) throw new Error("cookie : " + cookie);
  const C = { ...H, cookie: cookie.split(";")[0] };
  step("confirmation : session ouverte, cookie __Host- HttpOnly Secure SameSite=Lax");
  const p = (await (await fetch(`${BASE}/api/projects`, { method: "POST", headers: C, body: JSON.stringify({ name: "smoke", design: null }) })).json()).project;
  const png = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), "../packages/engine/fixtures/motifs/02-fleur.png"));
  const fd = new FormData();
  fd.append("file", new Blob([png], { type: "image/png" }), "fleur.png");
  r = await fetch(`${BASE}/api/projects/${p.id}/source`, { method: "POST", headers: { "x-vyra-client": "web", cookie: C.cookie }, body: fd });
  const file = (await r.json()).file;
  if (r.status !== 200 || file.scanStatus !== "clean") throw new Error("dépôt " + r.status);
  r = await fetch(`${BASE}/api/files/${file.id}`, { headers: { cookie: C.cookie } });
  if (!Buffer.from(await r.arrayBuffer()).equals(png)) throw new Error("relecture du fichier");
  step("dépôt d'image : analysé par ClamAV, stocké dans S3, relu à l'identique");
  r = await fetch(`${BASE}/api/metrics`, { headers: { authorization: `Bearer ${metricsToken}` } });
  if (!(await r.text()).includes("vyra_http_requests_total")) throw new Error("métriques");
  if ((await fetch(`${BASE}/api/dev/mailbox`)).status !== 404) throw new Error("la boîte de développement est exposée");
  if (!(await fetch(`${BASE}/studio/`)).ok) throw new Error("Studio non servi");
  step("métriques protégées, boîte de développement absente, Studio servi");
  console.log("Test de fumée de l'archive réussi.");
} finally {
  stop();
  fs.rmSync(work, { recursive: true, force: true });
}
