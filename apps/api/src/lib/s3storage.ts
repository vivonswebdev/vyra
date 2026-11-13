// Stockage objet privé compatible S3 (Scaleway, OVHcloud, Cloudflare R2, MinIO, AWS).
// Les objets ne sont jamais publics : aucune ACL publique, aucune URL signée remise au navigateur ;
// chaque lecture passe par l'API, qui vérifie la propriété (ou le droit d'achat) avant de diffuser.
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import type { Storage } from "./storage.js";

export interface S3Options {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;
  forcePathStyle?: boolean;
  serverSideEncryption?: "AES256";
  /** Délais réseau (ms) : une panne du fournisseur ne bloque pas les requêtes indéfiniment. */
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]{0,250}$/;

export class S3Storage implements Storage {
  private client: S3Client;
  constructor(private o: S3Options) {
    this.client = new S3Client({
      region: o.region,
      endpoint: o.endpoint,
      forcePathStyle: o.forcePathStyle ?? true,
      credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey },
      // Sommes de contrôle uniquement quand le service les exige : compatibilité des fournisseurs S3 européens.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      maxAttempts: 2,
      requestHandler: new NodeHttpHandler({ connectionTimeout: o.connectionTimeoutMs ?? 3000, requestTimeout: o.requestTimeoutMs ?? 30_000 }),
    });
  }

  private key(k: string) {
    if (!SAFE_KEY.test(k) || k.includes("..")) throw new Error("clé de stockage invalide");
    return (this.o.prefix ? this.o.prefix.replace(/\/+$/, "") + "/" : "") + k;
  }

  async put(key: string, bytes: Uint8Array) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.o.bucket,
        Key: this.key(key),
        Body: bytes,
        ContentType: "application/octet-stream",
        ...(this.o.serverSideEncryption ? { ServerSideEncryption: this.o.serverSideEncryption } : {}),
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.o.bucket, Key: this.key(key) }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.o.bucket, Key: this.key(key) }));
  }

  /**
   * URL de téléchargement temporaire, signée, à remettre au navigateur APRÈS contrôle d'accès par l'API.
   * Durée courte ; téléchargement forcé (pièce jointe) et type neutre pour éviter toute exécution.
   */
  async presignGet(key: string, opts: { expiresInSeconds: number; filename: string }): Promise<string> {
    const ascii = opts.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.o.bucket,
        Key: this.key(key),
        ResponseContentDisposition: `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(opts.filename)}`,
        ResponseContentType: "application/octet-stream",
      }),
      { expiresIn: Math.max(1, Math.min(opts.expiresInSeconds, 3600)) },
    );
  }

  /** Clés stockées (relatives au préfixe), pour la sauvegarde. */
  async list(): Promise<string[]> {
    const out: string[] = [];
    const prefix = this.o.prefix ? this.o.prefix.replace(/\/+$/, "") + "/" : "";
    let token: string | undefined;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.o.bucket, Prefix: prefix || undefined, ContinuationToken: token }));
      for (const o of r.Contents ?? []) if (o.Key) out.push(o.Key.slice(prefix.length));
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.o.bucket, Key: this.key(key) }));
      return true;
    } catch (e: any) {
      if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound" || e?.name === "NoSuchKey") return false;
      throw e;
    }
  }
}
