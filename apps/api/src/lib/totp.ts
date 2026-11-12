// Mots de passe à usage unique basés sur le temps (RFC 6238 / RFC 4226) : SHA-1, 30 s, 6 chiffres,
// compatibles avec les applications d'authentification courantes.
import crypto from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error("base32 invalide");
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", secret).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const timeStep = (ms = Date.now()) => Math.floor(ms / 1000 / 30);

/** Vérifie un code (fenêtre ±1 pas) ; renvoie le pas accepté, ou null. */
export function verifyTotp(secretB32: string, code: string, opts: { now?: number; lastStep?: number | null } = {}): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const step = timeStep(opts.now);
  for (const s of [step, step - 1, step + 1]) {
    if (opts.lastStep != null && s <= opts.lastStep) continue; // pas de rejeu
    const expected = hotp(secret, s);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return s;
  }
  return null;
}

export function newTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function otpauthUri(secretB32: string, account: string, issuer = "VYRA"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
