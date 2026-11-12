// Configuration lue dans l'environnement, validée au démarrage.
// En production, les réglages dangereux (paiement de test, e-mails non envoyés,
// cookies non sécurisés) font échouer le démarrage au lieu de passer en silence.
import path from "node:path";
import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(8787),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().default("postgres://vyra:vyra@127.0.0.1:5432/vyra_dev"),
  PUBLIC_URL: z.string().url().default("http://127.0.0.1:8787"),
  STORAGE_DIR: z.string().default(path.resolve(process.cwd(), "storage")),
  MAIL_TRANSPORT: z.enum(["outbox", "brevo"]).default("outbox"),
  MAIL_FROM: z.string().default("VYRA <no-reply@vyra.invalid>"),
  BREVO_API_KEY: z.string().optional(),
  PAYMENTS_PROVIDER: z.enum(["sandbox", "stripe"]).default("sandbox"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /** Requêtes par minute et par adresse IP sur les routes de connexion, inscription et réinitialisation. */
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
  TRUST_PROXY: z.coerce.boolean().default(false),
  WEB_DIST_DIR: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Config = z.infer<typeof Env> & { isProd: boolean; secureCookies: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const parsed = Env.parse({ ...env, ...overrides });
  const cfg: Config = {
    ...parsed,
    ...overrides,
    isProd: parsed.NODE_ENV === "production",
    secureCookies: parsed.PUBLIC_URL.startsWith("https://"),
  };
  if (cfg.isProd) {
    const problems: string[] = [];
    if (cfg.PAYMENTS_PROVIDER !== "stripe") problems.push("PAYMENTS_PROVIDER doit valoir « stripe » en production (le bac à sable est interdit).");
    if (cfg.PAYMENTS_PROVIDER === "stripe" && (!cfg.STRIPE_SECRET_KEY || !cfg.STRIPE_WEBHOOK_SECRET))
      problems.push("STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET sont requis.");
    if (cfg.MAIL_TRANSPORT === "outbox") problems.push("MAIL_TRANSPORT doit être un vrai transport (brevo) en production.");
    if (cfg.MAIL_TRANSPORT === "brevo" && !cfg.BREVO_API_KEY) problems.push("BREVO_API_KEY est requis.");
    if (!cfg.secureCookies) problems.push("PUBLIC_URL doit être en https en production.");
    if (problems.length) throw new Error("Configuration de production refusée :\n- " + problems.join("\n- "));
  }
  return cfg;
}
