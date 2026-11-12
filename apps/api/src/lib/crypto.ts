// Mots de passe : scrypt (node:crypto), paramètres OWASP (N=2^15, r=8, p=3).
// Jetons : 32 octets aléatoires ; seule leur empreinte SHA-256 est stockée.
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const PARAMS = { N: 2 ** 15, r: 8, p: 3, maxmem: 128 * 1024 * 1024 };
const KEYLEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64url");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/** Empreinte calculée une fois : sert à rendre la durée d'une connexion indépendante de l'existence du compte. */
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hashPassword(crypto.randomBytes(16).toString("hex")));

export function newToken(): { token: string; hash: Buffer } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: tokenHash(token) };
}

export const tokenHash = (token: string) => crypto.createHash("sha256").update(token).digest();

export const sha256Hex = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");
