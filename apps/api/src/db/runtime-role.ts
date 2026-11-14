// Contrôle du rôle PostgreSQL de l'API au démarrage (lot H1) : l'API ne doit disposer d'aucun privilège de
// migration ni d'administration. En production, un rôle trop puissant empêche le démarrage ; ailleurs, il est
// signalé (les bases de développement utilisent souvent un superutilisateur local).
import type { Db } from "./pool.js";

export interface RuntimeRoleReport {
  role: string;
  problems: string[];
}

export async function checkRuntimeRole(db: Pick<Db, "query">): Promise<RuntimeRoleReport> {
  const { rows } = await db.query(`
    SELECT current_user AS role, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
           has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public,
           EXISTS (SELECT 1 FROM pg_roles o WHERE o.rolname = 'vyra_owner' AND pg_has_role(current_user, o.oid, 'SET')) AS can_set_owner,
           (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S','v','m') AND pg_has_role(current_user, c.relowner, 'USAGE')) AS owned
      FROM pg_roles r WHERE r.rolname = current_user`);
  const r = rows[0];
  const problems: string[] = [];
  if (r.rolsuper) problems.push("superutilisateur");
  if (r.rolbypassrls) problems.push("contourne RLS (BYPASSRLS)");
  if (r.rolcreaterole) problems.push("peut créer des rôles");
  if (r.rolcreatedb) problems.push("peut créer des bases");
  if (r.can_create_public) problems.push("peut créer des objets dans le schéma public");
  if (r.can_set_owner) problems.push("peut prendre le rôle vyra_owner");
  if (r.owned > 0) problems.push(`propriétaire (directement ou par héritage) de ${r.owned} objet(s)`);
  return { role: r.role, problems };
}
