// Analyse antivirus des fichiers déposés. Client du démon ClamAV (clamd) en TCP, commande INSTREAM.
// Le résultat est l'un de : sain, infecté (avec la signature), erreur (service indisponible,
// délai dépassé, réponse illisible). Une erreur n'est jamais traitée comme « sain ».
import net from "node:net";

export type ScanVerdict = { verdict: "clean" } | { verdict: "infected"; signature: string } | { verdict: "error"; detail: string };

export interface FileScanner {
  readonly engine: string;
  scan(bytes: Uint8Array): Promise<ScanVerdict>;
  ping(): Promise<boolean>;
}

export class ClamdScanner implements FileScanner {
  readonly engine: string;
  constructor(
    private host: string,
    private port: number,
    private timeoutMs = 15_000,
  ) {
    this.engine = `clamd@${host}:${port}`;
  }

  private exchange(write: (s: net.Socket) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error(`délai dépassé (${this.timeoutMs} ms)`));
      }, this.timeoutMs);
      sock.on("connect", () => write(sock));
      sock.on("data", (d) => chunks.push(d));
      sock.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      sock.on("close", () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString("utf8").replace(/\0+$/, "").trim());
      });
    });
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.exchange((s) => s.end("zPING\0"))) === "PONG";
    } catch {
      return false;
    }
  }

  async scan(bytes: Uint8Array): Promise<ScanVerdict> {
    let reply: string;
    try {
      reply = await this.exchange((s) => {
        s.write("zINSTREAM\0");
        const CHUNK = 64 * 1024;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          const part = bytes.subarray(i, Math.min(bytes.length, i + CHUNK));
          const len = Buffer.alloc(4);
          len.writeUInt32BE(part.length);
          s.write(len);
          s.write(part);
        }
        s.end(Buffer.alloc(4)); // bloc de longueur nulle : fin du flux
      });
    } catch (e) {
      return { verdict: "error", detail: String((e as Error).message ?? e) };
    }
    const m = /^stream: (.+?)( FOUND| ERROR)?$/.exec(reply);
    if (reply === "stream: OK") return { verdict: "clean" };
    if (m && m[2] === " FOUND") return { verdict: "infected", signature: m[1] };
    return { verdict: "error", detail: reply ? reply.slice(0, 200) : "réponse vide" };
  }
}

/** Aucun antivirus (développement uniquement, refusé en production) : les fichiers restent « non analysés ». */
export class NoScanner implements FileScanner {
  readonly engine = "aucun";
  async scan(): Promise<ScanVerdict> {
    return { verdict: "error", detail: "aucun antivirus configuré" };
  }
  async ping() {
    return false;
  }
}
