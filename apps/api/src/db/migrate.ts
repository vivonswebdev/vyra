import { loadConfig } from "../config.js";
import { createPool } from "./pool.js";
import { migrate } from "./migrations.js";

const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL);
const applied = await migrate(db, console.log);
console.log(applied.length ? `${applied.length} migration(s) appliquée(s).` : "Base à jour.");
await db.end();
