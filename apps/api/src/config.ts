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
  /** « local » (disque) ou « s3 » (stockage objet privé compatible S3). */
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("fr-par"),
  S3_BUCKET: z.string().optional(),
  S3_PREFIX: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_SSE: z.enum(["none", "AES256"]).default("none"),
  MAIL_TRANSPORT: z.enum(["outbox", "brevo"]).default("outbox"),
  MAIL_FROM: z.string().default("VYRA <no-reply@vyra.invalid>"),
  BREVO_API_KEY: z.string().optional(),
  /** Paiements (VYRA Market, lots 5 à 7) : « none » tant que le Market n'est pas ouvert. */
  PAYMENTS_PROVIDER: z.enum(["none", "sandbox", "stripe"]).default("none"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /** Requêtes par minute et par adresse IP sur les routes de connexion, inscription et réinitialisation. */
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
  TRUST_PROXY: z.coerce.boolean().default(false),
  WEB_DIST_DIR: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Clé de chiffrement des secrets (32 octets en base64). Obligatoire en production. */
  SECRET_KEY: z.string().optional(),
  /** Boîte aux lettres de développement (/dev/mailbox) : expose les liens de connexion, jamais en production. */
  DEV_MAILBOX: z.stringbool().default(false),
  /** Calculs du moteur côté serveur : workers, délai maximal, file d'attente, mémoire par worker. */
  ENGINE_WORKERS: z.coerce.number().int().min(1).max(16).default(2),
  ENGINE_TIMEOUT_MS: z.coerce.number().int().min(1).default(20_000),
  ENGINE_QUEUE: z.coerce.number().int().min(0).default(20),
  ENGINE_MEMORY_MB: z.coerce.number().int().min(64).default(512),
});

export type Config = z.infer<typeof Env> & { isProd: boolean; secureCookies: boolean; secretKey: string };

// Clé de développement fixe : les secrets chiffrés en local restent lisibles d'un démarrage à l'autre.
const DEV_SECRET_KEY = Buffer.alloc(32, "vyra-dev-only").toString("base64");

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const parsed = Env.parse({ ...env, ...overrides });
  const cfg: Config = {
    ...parsed,
    ...overrides,
    isProd: parsed.NODE_ENV === "production",
    secureCookies: parsed.PUBLIC_URL.startsWith("https://"),
    secretKey: (overrides as any).SECRET_KEY ?? parsed.SECRET_KEY ?? DEV_SECRET_KEY,
  };
  if (cfg.isProd) {
    const problems: string[] = [];
    if (cfg.PAYMENTS_PROVIDER === "sandbox") problems.push("PAYMENTS_PROVIDER=sandbox est interdit en production (aucun argent réel ne circule).");
    if (cfg.PAYMENTS_PROVIDER === "stripe" && (!cfg.STRIPE_SECRET_KEY || !cfg.STRIPE_WEBHOOK_SECRET))
      problems.push("STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET sont requis.");
    if (cfg.MAIL_TRANSPORT === "outbox") problems.push("MAIL_TRANSPORT doit être un vrai transport (brevo) en production.");
    if (cfg.MAIL_TRANSPORT === "brevo" && !cfg.BREVO_API_KEY) problems.push("BREVO_API_KEY est requis.");
    if (!cfg.secureCookies) problems.push("PUBLIC_URL doit être en https en production.");
    if (!parsed.SECRET_KEY || Buffer.from(parsed.SECRET_KEY, "base64").length !== 32) problems.push("SECRET_KEY (32 octets en base64) est requis en production : openssl rand -base64 32.");
    if (cfg.STORAGE_DRIVER === "s3" && (!cfg.S3_BUCKET || !cfg.S3_ACCESS_KEY_ID || !cfg.S3_SECRET_ACCESS_KEY))
      problems.push("STORAGE_DRIVER=s3 exige S3_BUCKET, S3_ACCESS_KEY_ID et S3_SECRET_ACCESS_KEY.");
    if (cfg.DEV_MAILBOX) problems.push("DEV_MAILBOX est interdit en production (il expose les liens de connexion).");
    if (problems.length) throw new Error("Configuration de production refusée :\n- " + problems.join("\n- "));
  }
  return cfg;
}
