#!/usr/bin/env node
// Génère une base de signatures ClamAV DE TEST (fichier EICAR seul ou dissimulé dans un fichier) et un
// fichier de configuration clamd, pour tester l'intégration antivirus sans les signatures officielles.
// Ce n'est PAS une protection réelle : en production, clamd utilise les bases officielles (freshclam).
// Usage : node scripts/clamav-test-db.mjs <dossier> [port]   puis   clamd --config-file=<dossier>/clamd.conf
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const dir = path.resolve(process.argv[2] ?? "clamav-test");
const port = Number(process.argv[3] ?? 3310);
// Chaîne de test EICAR assemblée à l'exécution (aucun fichier du dépôt ne la contient d'un seul tenant).
const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$" + "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
fs.mkdirSync(path.join(dir, "db"), { recursive: true });
fs.writeFileSync(path.join(dir, "db", "vyra-test.hdb"), `${crypto.createHash("md5").update(eicar).digest("hex")}:${eicar.length}:VYRA.Test.EICAR\n`);
fs.writeFileSync(path.join(dir, "db", "vyra-test.ndb"), `VYRA.Test.EICAR.Body:0:*:${eicar.toString("hex")}\n`);
fs.writeFileSync(
  path.join(dir, "clamd.conf"),
  [`DatabaseDirectory ${path.join(dir, "db")}`, `TCPSocket ${port}`, "TCPAddr 127.0.0.1", "StreamMaxLength 25M", "MaxFileSize 25M", "MaxScanSize 100M", `LogFile ${path.join(dir, "clamd.log")}`].join("\n") + "\n",
);
console.log(path.join(dir, "clamd.conf"));
