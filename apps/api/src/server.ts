import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { migrate } from "./db/migrations.js";
import { buildApp } from "./app.js";
import { flushOutbox } from "./lib/mailer.js";

const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL);
await migrate(db, (m) => console.log(m));
const app = await buildApp({ cfg, db });

// Envoi des e-mails en attente toutes les 15 secondes (transport réel uniquement).
const mailTimer = setInterval(() => flushOutbox(db, cfg).catch((e) => app.log.error(e)), 15_000);
// Purge des sessions et jetons expirés, toutes les heures.
const purgeTimer = setInterval(() => {
  db.query("DELETE FROM sessions WHERE expires_at < now()").catch((e) => app.log.error(e));
  db.query("DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days'").catch((e) => app.log.error(e));
}, 3600_000);

const stop = async () => {
  clearInterval(mailTimer);
  clearInterval(purgeTimer);
  await app.close();
  await db.end();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await app.listen({ port: cfg.PORT, host: cfg.HOST });
