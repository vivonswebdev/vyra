// Reconnaissance du type réel d'un fichier par sa signature (on ne se fie pas au nom ni au type annoncé).

export interface Sniffed {
  mime: string;
  ext: string;
}

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

export function sniffImage(b: Uint8Array, filename = ""): Sniffed | null {
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: ".png" };
  if (starts(b, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: ".jpg" };
  if (starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8)) return { mime: "image/webp", ext: ".webp" };
  if (starts(b, [0x42, 0x4d])) return { mime: "image/bmp", ext: ".bmp" };
  if (starts(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: "application/pdf", ext: ".pdf" };
  const head = new TextDecoder().decode(b.subarray(0, 1024)).trimStart().toLowerCase();
  if ((head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) && /\.svg$/i.test(filename))
    return { mime: "image/svg+xml", ext: ".svg" };
  return null;
}

/** Fichiers de broderie acceptés sur le Marketplace. */
export function sniffEmbroidery(b: Uint8Array): Sniffed | null {
  if (starts(b, [0x23, 0x50, 0x45, 0x53])) return { mime: "application/x-pes", ext: ".pes" };
  if (b.length >= 512 && starts(b, [0x4c, 0x41, 0x3a])) return { mime: "application/x-dst", ext: ".dst" };
  return null;
}
