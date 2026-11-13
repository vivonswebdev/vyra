// Client S3 construit à partir des mêmes variables d'environnement que l'API (scripts de sauvegarde et de vérification).
import { S3Client } from "@aws-sdk/client-s3";

export function s3Client() {
  for (const v of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) if (!process.env[v]) throw new Error(`${v} manquant`);
  return new S3Client({
    region: process.env.S3_REGION ?? "fr-par",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

export const s3Prefix = () => (process.env.S3_PREFIX ? process.env.S3_PREFIX.replace(/\/+$/, "") + "/" : "");
