// Instantané de contrôle d'une base VYRA (lot H2), utilisé par la sauvegarde et la restauration :
// propriétaires, droits, séquences, fonctions, contraintes, index, politiques RLS, privilèges par défaut, et pour
// chaque table le nombre de lignes et une somme de contrôle du contenu. Deux bases identiques donnent le même
// instantané ; toute différence est listée par compare().
//
// Périmètre : schémas vyra et public. Les sommes de contrôle trient les lignes par leur texte : coût linéaire en
// taille de table (acceptable aux volumes actuels ; à revoir si une table devient très grande).
// Une liste de droits égale aux droits par défaut (acldefault) est notée null : « propriétaire seul » explicite et
// liste absente sont équivalents pour PostgreSQL, et pg_dump ne restaure pas la forme explicite.

const SCHEMAS = ["vyra", "public"];

/**
 * q : fonction (texte, paramètres) → lignes. Doit voir toutes les lignes (vyra_backup, ou propriétaire sans RLS
 * forcé). Avec { contents: false }, seule la structure est relevée (tables : voir tableContents).
 */
export async function snapshot(q, { contents = true } = {}) {
  const s = {};
  s.schemas = await q(
    `SELECT nspname AS name, pg_get_userbyid(nspowner) AS owner, nullif(nspacl::text, acldefault('n'::"char", nspowner)::text) AS acl
       FROM pg_namespace WHERE nspname = ANY($1) ORDER BY 1`,
    [SCHEMAS],
  );
  s.relations = await q(
    `SELECT n.nspname || '.' || c.relname AS name, c.relkind AS kind, pg_get_userbyid(c.relowner) AS owner,
            nullif(c.relacl::text, acldefault((CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END)::"char", c.relowner)::text) AS acl, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls, c.relpersistence AS persistence
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'i') ORDER BY 1`,
    [SCHEMAS],
  );
  s.columnAcl = await q(
    `SELECT n.nspname || '.' || c.relname || '.' || a.attname AS name, a.attacl::text AS acl
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1) AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL ORDER BY 1`,
    [SCHEMAS],
  );
  s.constraints = await q(
    `SELECT n.nspname || '.' || r.relname || '.' || c.conname AS name, pg_get_constraintdef(c.oid) AS def, c.convalidated AS valid
       FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = ANY($1) ORDER BY 1`,
    [SCHEMAS],
  );
  s.indexes = await q(`SELECT schemaname || '.' || indexname AS name, indexdef AS def FROM pg_indexes WHERE schemaname = ANY($1) ORDER BY 1`, [SCHEMAS]);
  s.functions = await q(
    `SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name,
            pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer, p.proconfig::text AS config,
            nullif(p.proacl::text, acldefault('f'::"char", p.proowner)::text) AS acl, md5(pg_get_functiondef(p.oid)) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ANY($1) ORDER BY 1`,
    [SCHEMAS],
  );
  s.policies = await q(
    `SELECT schemaname || '.' || tablename || '.' || policyname AS name, permissive, roles::text AS roles, cmd, qual, with_check
       FROM pg_policies WHERE schemaname = ANY($1) ORDER BY 1`,
    [SCHEMAS],
  );
  s.defaultAcl = await q(
    `SELECT pg_get_userbyid(d.defaclrole) AS role, coalesce(n.nspname, '') AS schema, d.defaclobjtype AS type, d.defaclacl::text AS acl
       FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace ORDER BY 1, 2, 3`,
  );
  s.sequences = await q(`SELECT schemaname || '.' || sequencename AS name, last_value::text AS last_value FROM pg_sequences WHERE schemaname = ANY($1) ORDER BY 1`, [SCHEMAS]);
  s.tables = contents ? await tableContents(q, s.relations) : [];
  return s;
}

/** Nombre de lignes et somme de contrôle de chaque table de `relations` (relevé de snapshot). */
export async function tableContents(q, relations) {
  const out = [];
  for (const t of relations.filter((r) => r.kind === "r")) {
    const id = quoteName(t.name);
    const [r] = await q(`SELECT count(*)::int AS rows, coalesce(md5(string_agg(x::text, E'\\n' ORDER BY x::text)), '') AS checksum FROM ${id} x`);
    out.push({ name: t.name, rows: r.rows, checksum: r.checksum });
  }
  return out;
}

/** « schéma.table » → identifiant SQL entre guillemets. */
export const quoteName = (name) => name.split(".").map((p) => `"${p.replace(/"/g, '""')}"`).join(".");

/** Différences entre deux instantanés (liste vide = identiques). */
export function compare(expected, actual, { sequencesAtLeast = false } = {}) {
  const diffs = [];
  for (const key of Object.keys(expected)) {
    // Lot H6 : la valeur d'une séquence n'est pas transactionnelle ; pg_dump la lit après l'instantané de
    // contrôle. Pour la restauration, une valeur restaurée supérieure ou égale est donc normale.
    if (key === "sequences" && sequencesAtLeast) {
      const a = new Map((actual[key] ?? []).map((x) => [x.name, x]));
      for (const v of expected[key]) {
        const got = a.get(v.name);
        if (!got) diffs.push(`${key} : ${v.name} absent`);
        else if (BigInt(got.last_value ?? 0) < BigInt(v.last_value ?? 0)) diffs.push(`${key} : ${v.name} en retard (attendu au moins ${v.last_value}, obtenu ${got.last_value})`);
      }
      for (const k of a.keys()) if (!expected[key].some((v) => v.name === k)) diffs.push(`${key} : ${k} en trop`);
      continue;
    }
    const a = new Map((actual[key] ?? []).map((x) => [x.name ?? JSON.stringify(x), x]));
    const e = new Map(expected[key].map((x) => [x.name ?? JSON.stringify(x), x]));
    for (const [k, v] of e) {
      if (!a.has(k)) diffs.push(`${key} : ${k} absent`);
      else if (JSON.stringify(a.get(k)) !== JSON.stringify(v)) diffs.push(`${key} : ${k} différent (attendu ${JSON.stringify(v)}, obtenu ${JSON.stringify(a.get(k))})`);
    }
    for (const k of a.keys()) if (!e.has(k)) diffs.push(`${key} : ${k} en trop`);
  }
  return diffs;
}

/** Objets applicatifs présents dans la base (hors catalogues système) : 0 pour une base neuve préparée. */
export async function userObjects(q) {
  const [r] = await q(
    `SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%')::int
          + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname NOT IN ('pg_catalog', 'information_schema'))::int AS n`,
  );
  return r.n;
}
