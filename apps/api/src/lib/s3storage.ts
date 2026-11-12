// Stockage objet privé compatible S3 (Scaleway, OVHcloud, Cloudflare R2, MinIO, AWS).
// Les objets ne sont jamais publics : aucune ACL publique, aucune URL signée remise au navigateur ;
// chaque lecture passe par l'API, qui vérifie la propriété (ou le droit d'achat) avant de diffuser.
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
