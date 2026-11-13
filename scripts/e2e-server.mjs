// Serveur des tests navigateur : base vyra_e2e remise à zéro, applications compilées servies par l'API.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL_E2E ?? "postgres://vyra:vyra@127.0.0.1:5432/vyra_e2e";
const db = new pg.Client({ connectionString: url });
await db.connect();
await db.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
await db.end();
const storage = fs.mkdtempSync(path.join(os.tmpdir(), "vyra-e2e-"));
// Le serveur testé est la version compilée pour la production (npm run build).
const child = spawn(process.execPath, ["dist/api/server.mjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: url,
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
