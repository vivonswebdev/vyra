// Stockage objet privé. Aucun fichier n'est servi par une URL publique : chaque lecture
// passe par l'API, qui vérifie le droit d'accès avant de diffuser le contenu.
// Pilote local (disque) pour le développement et un serveur unique ; un pilote compatible S3
// (Scaleway, OVHcloud, Cloudflare R2…) implémentera la même interface (lot 8).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface Storage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Facultatif : URL temporaire signée (stockage S3). */
  presignGet?(key: string, opts: { expiresInSeconds: number; filename: string }): Promise<string>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]{0,250}$/;

export function newStorageKey(prefix: string, ext: string): string {
  const d = new Date();
  const id = crypto.randomUUID();
  return `${prefix}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${id}${ext.toLowerCase()}`;
}

export class LocalStorage implements Storage {
  constructor(private root: string) {
    fs.mkdirSync(root, { recursive: true });
  }

  private resolve(key: string): string {
    if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error("clé de stockage invalide");
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("clé de stockage hors du dossier");
    return p;
  }

  async put(key: string, bytes: Uint8Array) {
    const p = this.resolve(key);
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    const tmp = p + ".tmp-" + process.pid;
    await fs.promises.writeFile(tmp, bytes);
    await fs.promises.rename(tmp, p);
  }

  get(key: string) {
    return fs.promises.readFile(this.resolve(key));
  }

  async delete(key: string) {
    await fs.promises.rm(this.resolve(key), { force: true });
  }

  async exists(key: string) {
    return fs.promises.access(this.resolve(key)).then(
      () => true,
      () => false,
    );
  }
}
