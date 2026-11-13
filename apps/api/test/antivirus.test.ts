// Antivirus : protocole clamd, quarantaine, refus des fichiers infectés, erreurs du service.
// 1) Faux service clamd contrôlé (toujours exécuté). 2) Vrai démon ClamAV si CLAMD_TEST=1
//    (base de signatures de test EICAR : voir docs/ANTIVIRUS.md).
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { ClamdScanner } from "../src/lib/scanner.js";
import { rescanUnscanned } from "../src/lib/quarantine.js";
import { Client, setup, signup, teardown, type Ctx } from "./helpers.js";

// Chaîne de test EICAR assemblée à l'exécution (le dépôt ne la contient pas d'un seul tenant).
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$" + "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const PNG = fs.readFileSync(new URL("../../../packages/engine/fixtures/motifs/02-fleur.png", import.meta.url));
const TRAPPED = Buffer.concat([PNG, Buffer.from(EICAR)]);

// ------------------------------------------------------------------ faux clamd
type Mode = "ok" | "found" | "error" | "hang" | "close";
let mode: Mode = "ok";
let received: Buffer[] = [];
let fake: net.Server;
let fakePort = 0;

function startFake() {
  fake = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    let cmd: string | null = null;
    const body: Buffer[] = [];
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (cmd === null) {
        const z = buf.indexOf(0);
        if (z < 0) return;
        cmd = buf.subarray(0, z).toString();
        buf = buf.subarray(z + 1);
        if (cmd === "zPING") return sock.end("PONG\0");
      }
      while (buf.length >= 4) {
        const n = buf.readUInt32BE(0);
        if (n === 0) {
          received.push(Buffer.concat(body));
          if (mode === "hang") return;
          if (mode === "close") return sock.destroy();
          const reply = mode === "ok" ? "stream: OK" : mode === "found" ? "stream: Faux.Malware.Test FOUND" : "INSTREAM size limit exceeded. ERROR";
          return sock.end(reply + "\0");
        }
        if (buf.length < 4 + n) return;
        body.push(buf.subarray(4, 4 + n));
        buf = buf.subarray(4 + n);
      }
    });
    sock.on("error", () => {});
  });
  return new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => ((fakePort = (fake.address() as net.AddressInfo).port), r())));
}

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
  await startFake();
});
afterAll(async () => {
  fake.close();
  await teardown(ctx);
});

const appWith = (over: Record<string, unknown>) =>
  buildApp({
    cfg: loadConfig({ NODE_ENV: "test" } as any, {
      DATABASE_URL: "unused",
      STORAGE_DIR: ctx.storageDir,
      LOG_LEVEL: "silent",
      PUBLIC_URL: "http://vyra.test",
      AUTH_RATE_LIMIT: 10_000,
      FILE_SCAN: "clamd",
      CLAMD_HOST: "127.0.0.1",
      CLAMD_PORT: fakePort,
      CLAMD_TIMEOUT_MS: 500,
      ...over,
    } as any),
    db: ctx.db,
  });

function multipart(filename: string, bytes: Buffer, type = "image/png") {
  const b = "----vyra" + crypto.randomBytes(6).toString("hex");
  return {
    body: Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`), bytes, Buffer.from(`\r\n--${b}--\r\n`)]),
    type: `multipart/form-data; boundary=${b}`,
  };
}

async function upload(c: Client, projectId: string, bytes: Buffer, filename = "image.png") {
  const mp = multipart(filename, bytes);
  return c.req("POST", `/api/projects/${projectId}/source`, mp.body, { "content-type": mp.type });
}

const filesUnder = (dir: string): string[] =>
  fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath ?? (e as any).path, e.name)) : [];

describe("client clamd (faux service contrôlé)", () => {
  it("transmet le fichier complet par blocs et interprète les réponses", async () => {
    const s = new ClamdScanner("127.0.0.1", fakePort, 1000);
    expect(await s.ping()).toBe(true);
    const big = crypto.randomBytes(300_000);
    mode = "ok";
    received = [];
    expect(await s.scan(big)).toEqual({ verdict: "clean" });
    expect(Buffer.compare(received[0], big)).toBe(0);
    mode = "found";
    expect(await s.scan(big)).toEqual({ verdict: "infected", signature: "Faux.Malware.Test" });
    mode = "error";
    expect((await s.scan(big)).verdict).toBe("error");
    mode = "close";
    expect((await s.scan(big)).verdict).toBe("error");
  });

  it("un service bloqué ou injoignable donne une erreur, jamais « sain »", async () => {
    mode = "hang";
    const t0 = Date.now();
    const r = await new ClamdScanner("127.0.0.1", fakePort, 300).scan(Buffer.from("x"));
    expect(r.verdict).toBe("error");
    expect(Date.now() - t0).toBeLessThan(2000);
    const closed = await new ClamdScanner("127.0.0.1", 1, 300).scan(Buffer.from("x"));
    expect(closed.verdict).toBe("error");
    expect(await new ClamdScanner("127.0.0.1", 1, 300).ping()).toBe(false);
  });
});

describe("quarantaine des fichiers déposés", () => {
  it("fichier sain : analysé puis mis à disposition hors de la quarantaine", async () => {
    mode = "ok";
    const app = await appWith({});
    const { c } = await signup(app);
    const p = (await c.post("/api/projects", { name: "src", design: null })).json.project;
    const r = await upload(c, p.id, PNG);
    expect(r.status).toBe(200);
    expect(r.json.file.scanStatus).toBe("clean");
    const { rows } = await ctx.db.query("SELECT storage_key, scan_engine, scanned_at FROM files WHERE id = $1", [r.json.file.id]);
    expect(rows[0].storage_key).toMatch(/^sources\//);
    expect(rows[0].scan_engine).toBe(`clamd@127.0.0.1:${fakePort}`);
    expect(rows[0].scanned_at).not.toBeNull();
    expect(Buffer.compare((await c.get(`/api/files/${r.json.file.id}`)).res.rawPayload, PNG)).toBe(0);
    await app.close();
  });

  it("fichier infecté : refusé, effacé, journalisé, jamais rattaché au projet", async () => {
    mode = "found";
    const app = await appWith({});
    const { c, user } = await signup(app);
    const p = (await c.post("/api/projects", { name: "src", design: null })).json.project;
    const before = filesUnder(path.join(ctx.storageDir, "quarantaine")).length;
    const r = await upload(c, p.id, TRAPPED);
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("file_infected");
    expect(filesUnder(path.join(ctx.storageDir, "quarantaine")).length).toBe(before);
    const { rows } = await ctx.db.query("SELECT id, scan_status, scan_detail, deleted_at FROM files WHERE owner_id = $1", [user.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scan_status: "infected", scan_detail: "Faux.Malware.Test" });
    expect(rows[0].deleted_at).not.toBeNull();
    expect((await ctx.db.query("SELECT count(*)::int n FROM project_files WHERE project_id = $1", [p.id])).rows[0].n).toBe(0);
    expect((await ctx.db.query("SELECT details FROM audit_log WHERE action = 'file.infected' AND actor_id = $1", [user.id])).rows[0].details.signature).toBe("Faux.Malware.Test");
    expect((await c.get(`/api/files/${rows[0].id}`)).status).toBe(404);
    await app.close();
  });

  it("antivirus indisponible : fichier gardé en quarantaine, jamais servi, ni exporté", async () => {
    for (const m of ["hang", "error"] as Mode[]) {
      mode = m;
      const app = await appWith({});
      const { c, user } = await signup(app);
      const p = (await c.post("/api/projects", { name: "src", design: null })).json.project;
      const r = await upload(c, p.id, PNG);
      expect(r.status, m).toBe(503);
      expect(r.json.error.code).toBe("scan_unavailable");
      const { rows } = await ctx.db.query("SELECT id, storage_key, scan_status FROM files WHERE owner_id = $1", [user.id]);
      expect(rows[0].scan_status).toBe("error");
      expect(rows[0].storage_key).toMatch(/^quarantaine\//);
      expect((await c.get(`/api/files/${rows[0].id}`)).status).toBe(404);
      const zipBody = (await c.get("/api/me/export")).res.rawPayload.toString("latin1");
      expect(zipBody).not.toContain("fichiers/sources/");
      expect((await ctx.db.query("SELECT count(*)::int n FROM audit_log WHERE action = 'file.scan_error' AND actor_id = $1", [user.id])).rows[0].n).toBe(1);
      await app.close();
    }
  });

  it("le type réel et la taille sont contrôlés avant l'antivirus", async () => {
    mode = "ok";
    const app = await appWith({});
    const { c } = await signup(app);
    const p = (await c.post("/api/projects", { name: "src", design: null })).json.project;
    received = [];
    expect((await upload(c, p.id, Buffer.from(EICAR), "virus.png")).status).toBe(400);
    expect(received).toHaveLength(0);
    await app.close();
  });

  it("les fichiers déposés avant l'antivirus sont analysés après coup", async () => {
    const app = await appWith({});
    const { user } = await signup(app);
    const ins = async (bytes: Buffer, key: string) => {
      fs.mkdirSync(path.dirname(path.join(ctx.storageDir, key)), { recursive: true });
      fs.writeFileSync(path.join(ctx.storageDir, key), bytes);
      return (
        await ctx.db.query(
          "INSERT INTO files (owner_id, kind, storage_key, filename, mime, size_bytes, sha256, scan_status) VALUES ($1,'source_image',$2,'a.png','image/png',$3,$4,'unscanned') RETURNING id",
          [user.id, key, bytes.length, crypto.createHash("sha256").update(bytes).digest("hex")],
        )
      ).rows[0].id;
    };
    const a = await ins(PNG, "sources/ancien/a.png");
    mode = "ok";
    expect(await rescanUnscanned(app)).toMatchObject({ clean: 1 });
    const b = await ins(TRAPPED, "sources/ancien/b.png");
    mode = "found";
    expect(await rescanUnscanned(app)).toMatchObject({ infected: 1 });
    const st = (await ctx.db.query("SELECT id, scan_status FROM files WHERE id = ANY($1)", [[a, b]])).rows;
    expect(Object.fromEntries(st.map((r) => [r.id, r.scan_status]))).toEqual({ [a]: "clean", [b]: "infected" });
    expect(fs.existsSync(path.join(ctx.storageDir, "sources/ancien/b.png"))).toBe(false);
    await app.close();
  });
});

describe.runIf(process.env.CLAMD_TEST === "1")("vrai démon ClamAV (base de signatures de test)", () => {
  const port = Number(process.env.CLAMD_TEST_PORT ?? 3310);

  it("détecte EICAR seul et dissimulé dans un PNG, accepte un PNG sain", async () => {
    const s = new ClamdScanner("127.0.0.1", port, 10_000);
    expect(await s.ping()).toBe(true);
    expect((await s.scan(Buffer.from(EICAR))).verdict).toBe("infected");
    const trapped = await s.scan(TRAPPED);
    expect(trapped.verdict).toBe("infected");
    expect((trapped as any).signature).toMatch(/EICAR/);
    expect(await s.scan(PNG)).toEqual({ verdict: "clean" });
  });

  it("de bout en bout par l'API : le PNG piégé est refusé, le PNG sain est servi", async () => {
    const app = await appWith({ CLAMD_PORT: port, CLAMD_TIMEOUT_MS: 10_000 });
    const { c } = await signup(app);
    const p = (await c.post("/api/projects", { name: "src", design: null })).json.project;
    const bad = await upload(c, p.id, TRAPPED);
    expect(bad.status).toBe(422);
    expect(bad.json.error.details.signature).toMatch(/EICAR/);
    const good = await upload(c, p.id, PNG);
    expect(good.status).toBe(200);
    expect(good.json.file.scanStatus).toBe("clean");
    await app.close();
  });
});
