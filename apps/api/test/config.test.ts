import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const prod = {
  NODE_ENV: "production",
  PUBLIC_URL: "https://studio.vyra.example",
  SECRET_KEY: Buffer.alloc(32, 9).toString("base64"),
  MAIL_TRANSPORT: "brevo",
  BREVO_API_KEY: "cle-brevo",
  DATABASE_URL: "postgres://u:p@db/vyra",
  FILE_SCAN: "clamd",
} as unknown as NodeJS.ProcessEnv;

describe("configuration de production", () => {
  it("démarre un Studio seul sans paiement", () => {
    const c = loadConfig(prod);
    expect(c.isProd).toBe(true);
    expect(c.secureCookies).toBe(true);
    expect(c.PAYMENTS_PROVIDER).toBe("none");
    expect(c.DEV_MAILBOX).toBe(false);
  });
  it.each([
    [{ SECRET_KEY: undefined }, /SECRET_KEY/],
    [{ SECRET_KEY: "trop-court" }, /SECRET_KEY/],
    [{ PUBLIC_URL: "http://studio.vyra.example" }, /https/],
    [{ MAIL_TRANSPORT: "outbox" }, /MAIL_TRANSPORT/],
    [{ BREVO_API_KEY: undefined }, /BREVO_API_KEY/],
    [{ PAYMENTS_PROVIDER: "sandbox" }, /sandbox/],
    [{ PAYMENTS_PROVIDER: "stripe" }, /STRIPE_SECRET_KEY/],
    [{ DEV_MAILBOX: "true" }, /DEV_MAILBOX/],
    [{ STORAGE_DRIVER: "s3" }, /S3_BUCKET/],
    [{ FILE_SCAN: "off" }, /FILE_SCAN=clamd/],
    [{ RATE_LIMIT_STORE: "memory" }, /RATE_LIMIT_STORE/],
  ])("refuse une configuration dangereuse : %o", (override, msg) => {
    expect(() => loadConfig({ ...prod, ...override } as any)).toThrow(msg);
  });
});
