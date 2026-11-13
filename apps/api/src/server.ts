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
  db.query("DELETE FROM rate_limits WHERE reset_at < now()").catch((e) => app.log.error(e));
  db.query("DELETE FROM auth_throttle WHERE window_start < now() - interval '1 day' AND (locked_until IS NULL OR locked_until < now())").catch((e) => app.log.error(e));
  db.query("DELETE FROM mfa_challenges WHERE expires_at < now()").catch((e) => app.log.error(e));
  // Comptes jamais confirmés depuis 7 jours et sans projet : supprimés.
  db.query(
    "DELETE FROM users WHERE email_verified_at IS NULL AND created_at < now() - interval '7 days' AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.owner_id = users.id)",
  ).catch((e) => app.log.error(e));
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
