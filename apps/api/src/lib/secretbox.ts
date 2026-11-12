// Chiffrement des secrets au repos (secret TOTP) : AES-256-GCM, clé SECRET_KEY du serveur.
import crypto from "node:crypto";

export class SecretBox {
  private key: Buffer;
  constructor(secretKeyB64: string) {
    const k = Buffer.from(secretKeyB64, "base64");
    if (k.length !== 32) throw new Error("SECRET_KEY doit contenir 32 octets encodés en base64.");
    this.key = k;
  }
  seal(plain: string): string {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
  }
  open(sealed: string): string {
    const [v, iv, tag, enc] = sealed.split(".");
    if (v !== "v1") throw new Error("format de secret inconnu");
    const d = crypto.createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
  }
}
