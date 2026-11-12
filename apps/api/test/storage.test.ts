// Pilote de stockage S3 : testé contre un serveur S3 local qui vérifie la signature AWS SigV4 de
// chaque requête (comme un vrai fournisseur) et refuse tout en-tête rendant un objet public.
import http from "node:http";
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3Storage } from "../src/lib/s3storage.js";
import { LocalStorage } from "../src/lib/storage.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AK = "AKIAVYRATEST";
const SK = "secret-de-test-ne-pas-utiliser";
const objects = new Map<string, Buffer>();
const seen: { method: string; url: string; headers: http.IncomingHttpHeaders }[] = [];
let server: http.Server;
let endpoint = "";

const hmac = (k: Buffer | string, d: string) => crypto.createHmac("sha256", k).update(d).digest();
const hex = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");

function verifySigV4(req: http.IncomingMessage, body: Buffer): string | null {
  const auth = String(req.headers.authorization ?? "");
  const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(auth);
  if (!m) return "en-tête Authorization absent ou non SigV4";
  const [, ak, date, region, signed, sig] = m;
  if (ak !== AK) return "clé inconnue";
  const payloadHash = String(req.headers["x-amz-content-sha256"] ?? "");
  if (payloadHash !== "UNSIGNED-PAYLOAD" && payloadHash !== hex(body)) return "empreinte du contenu incorrecte";
  const u = new URL(req.url!, "http://x");
  const query = [...u.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const headers = signed.split(";");
  const canonical = [req.method, u.pathname, query, headers.map((h) => `${h}:${String(req.headers[h] ?? "").trim().replace(/\s+/g, " ")}\n`).join(""), signed, payloadHash].join("\n");
  const amzDate = String(req.headers["x-amz-date"]);
  const scope = `${date}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, hex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac("AWS4" + SK, date), region), "s3"), "aws4_request");
  const expected = hmac(key, toSign).toString("hex");
  return expected === sig ? null : "signature invalide";
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method!, url: req.url!, headers: req.headers });
      const err = verifySigV4(req, body);
      if (err) {
        res.writeHead(403, { "content-type": "application/xml" });
        return res.end(`<Error><Code>SignatureDoesNotMatch</Code><Message>${err}</Message></Error>`);
      }
      if (String(req.headers["x-amz-acl"] ?? "").startsWith("public")) {
        res.writeHead(400);
        return res.end("<Error><Code>PublicAclRefused</Code></Error>");
      }
      const key = new URL(req.url!, "http://x").pathname;
      if (req.method === "PUT") {
        objects.set(key, body);
        res.writeHead(200, { etag: '"' + crypto.createHash("md5").update(body).digest("hex") + '"' });
        return res.end();
      }
      const obj = objects.get(key);
      if (req.method === "DELETE") {
        objects.delete(key);
        res.writeHead(204);
        return res.end();
      }
      if (!obj) {
        res.writeHead(404, { "content-type": "application/xml" });
        return res.end(req.method === "HEAD" ? undefined : "<Error><Code>NoSuchKey</Code></Error>");
      }
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": obj.length });
      return res.end(req.method === "HEAD" ? undefined : obj);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("stockage S3 privé", () => {
  const store = () => new S3Storage({ endpoint, region: "fr-par", bucket: "vyra-test", prefix: "prod", accessKeyId: AK, secretAccessKey: SK });

  it("écrit, relit, vérifie l'existence et supprime avec des requêtes signées", async () => {
    const s = store();
    const bytes = crypto.randomBytes(70_000);
    await s.put("exports/2026/11/abc.pes", bytes);
    expect(objects.has("/vyra-test/prod/exports/2026/11/abc.pes")).toBe(true);
    expect(Buffer.compare(await s.get("exports/2026/11/abc.pes"), bytes)).toBe(0);
    expect(await s.exists("exports/2026/11/abc.pes")).toBe(true);
    await s.delete("exports/2026/11/abc.pes");
    expect(await s.exists("exports/2026/11/abc.pes")).toBe(false);
    await expect(s.get("exports/2026/11/abc.pes")).rejects.toBeTruthy();
  });

  it("n'envoie jamais d'ACL publique et signe chaque requête", async () => {
    await store().put("sources/x.png", Buffer.from("png"));
    for (const r of seen) {
      expect(r.headers["x-amz-acl"]).toBeUndefined();
      expect(String(r.headers.authorization)).toMatch(/^AWS4-HMAC-SHA256 /);
    }
  });

  it("échoue avec de mauvais identifiants (le serveur refuse la signature)", async () => {
    const bad = new S3Storage({ endpoint, region: "fr-par", bucket: "vyra-test", accessKeyId: AK, secretAccessKey: "mauvais" });
    await expect(bad.put("a/b.bin", Buffer.from("x"))).rejects.toBeTruthy();
  });

  it("refuse les clés dangereuses avant tout appel réseau (pilotes S3 et disque)", async () => {
    const before = seen.length;
    for (const k of ["../etc/passwd", "/abs", "a/../../b", "A-majuscule", ""]) await expect(store().put(k, Buffer.from("x"))).rejects.toThrow(/clé/);
    expect(seen.length).toBe(before);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyra-local-"));
    const local = new LocalStorage(dir);
    for (const k of ["../evil", "a/../../evil"]) await expect(local.put(k, Buffer.from("x"))).rejects.toThrow(/clé/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
