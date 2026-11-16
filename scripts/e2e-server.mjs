// Serveur des tests navigateur : base vyra_e2e remise à zéro, applications compilées servies par l'API.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";

const url = process.env.DATABASE_URL_E2E ?? "postgres://vyra:vyra@127.0.0.1:5432/vyra_e2e";
const db = new pg.Client({ connectionString: url });
await db.connect();
// Lot H2 : comme en production — rôles, base préparée (schéma vyra), migration par vyra_migrator sous le rôle
// propriétaire, serveur sous vyra_app (droits de la matrice seulement). Mots de passe aléatoires, locaux au test.
await db.query(fs.readFileSync("scripts/db/roles.sql", "utf8"));
await db.query("DROP SCHEMA IF EXISTS vyra CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
await db.query(fs.readFileSync("scripts/db/database-setup.sql", "utf8"));
const asRole = async (role) => {
  const pw = crypto.randomBytes(16).toString("hex");
  await db.query(`ALTER ROLE ${role} PASSWORD '${pw}'`);
  const u = new URL(url);
  u.username = role;
  u.password = pw;
  return u.toString();
};
const migratorUrl = await asRole("vyra_migrator");
const appUrl = await asRole("vyra_app");
// Lot H3 : un pool par rôle, comme en production.
const systemUrl = await asRole("vyra_system");
const workerUrl = await asRole("vyra_worker");
await db.end();
// Lot H1 : le serveur ne migre plus ; la commande de migration est lancée avant lui, comme en production.
execFileSync(process.execPath, ["dist/api/migrate.mjs"], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "test", DATABASE_URL: appUrl, MIGRATION_DATABASE_URL: migratorUrl, MIGRATION_SET_ROLE: "vyra_owner" },
});
const storage = fs.mkdtempSync(path.join(os.tmpdir(), "vyra-e2e-"));
// Le serveur testé est la version compilée pour la production (npm run build).
const child = spawn(process.execPath, ["dist/api/server.mjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: appUrl,
    SYSTEM_DATABASE_URL: systemUrl,
    WORKER_DATABASE_URL: workerUrl,
    PORT: "8788",
    PUBLIC_URL: "http://127.0.0.1:8788",
    WEB_DIST_DIR: path.resolve("dist/web"),
    STORAGE_DIR: storage,
    LOG_LEVEL: "warn",
    AUTH_RATE_LIMIT: "1000",
    DEV_MAILBOX: "1",
  },
});
const stop = () => child.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (c) => process.exit(c ?? 0));
