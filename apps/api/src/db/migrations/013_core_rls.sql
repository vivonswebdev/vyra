-- Socle H5 (2/2) : sécurité au niveau des lignes (RLS), forcée, sur les 13 tables rattachées à un utilisateur
-- (H2-RLS-ARCHITECTURE §2 et §4). Politiques et activation dans la même migration : activer sans politique
-- bloquerait tout.
--
-- Règles :
-- * une politique par rôle et par opération, toujours avec TO (jamais PUBLIC) ;
-- * vyra_app : lignes de l'utilisateur du contexte vérifié, ctx = (SELECT vyra.ctx_user()), évalué une fois par
--   instruction. Sans contexte valide : aucune ligne, aucune écriture (un oubli de withUser échoue fermé) ;
-- * vyra_system (authentification, sans utilisateur) : USING (true), limité par ses droits de colonnes (009) ;
-- * vyra_worker (tâches de fond) : seulement les lignes que chaque purge traite ;
-- * vyra_owner : les tables sont FORCE, donc le propriétaire est filtré lui aussi. Il ne reçoit que la lecture
--   des comptes, sessions et rôles (fonctions de contexte, garde du dernier administrateur) et, pour les
--   fonctions d'administration (012), les écritures sur les comptes des autres, sous condition d'un
--   administrateur avec un TOTP récent dans le contexte ;
-- * vyra_market : aucune politique sur le socle ; vyra_backup : BYPASSRLS (pg_dump complet).
-- Hors RLS (aucun propriétaire de ligne, aucun accès de vyra_app) : mfa_challenges, auth_throttle, rate_limits,
-- schema_migrations.
--
-- Migrations futures qui modifient des données de ces tables (exécutées en vyra_owner) : sous FORCE, un UPDATE
-- toucherait 0 ligne sans erreur. Règle : ALTER TABLE … NO FORCE ROW LEVEL SECURITY, reprise, puis FORCE de
-- nouveau, dans la même transaction (docs/DEPLOIEMENT.md).
--
-- Idempotent : les politiques existantes de ces tables sont retirées puis recréées.

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'vyra'
             AND tablename IN ('users', 'user_roles', 'sessions', 'auth_tokens', 'user_recovery_codes', 'email_outbox', 'files',
                               'audit_log', 'projects', 'project_versions', 'project_exports', 'project_files', 'thread_charts') LOOP
    EXECUTE format('DROP POLICY %I ON vyra.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- Les rôles attribués aux autres ne passent plus que par vyra.admin_set_role (012).
REVOKE INSERT, DELETE ON vyra.user_roles FROM vyra_app;

-- ---------------------------------------------------------------- users
CREATE POLICY users_app_select ON vyra.users FOR SELECT TO vyra_app USING (id = (SELECT vyra.ctx_user()));
CREATE POLICY users_app_update ON vyra.users FOR UPDATE TO vyra_app USING (id = (SELECT vyra.ctx_user())) WITH CHECK (id = (SELECT vyra.ctx_user()));
CREATE POLICY users_app_delete ON vyra.users FOR DELETE TO vyra_app USING (id = (SELECT vyra.ctx_user()));
CREATE POLICY users_system_select ON vyra.users FOR SELECT TO vyra_system USING (true);
CREATE POLICY users_system_insert ON vyra.users FOR INSERT TO vyra_system WITH CHECK (true);
CREATE POLICY users_system_update ON vyra.users FOR UPDATE TO vyra_system USING (true) WITH CHECK (true);
-- Purge des comptes jamais confirmés depuis 7 jours.
CREATE POLICY users_worker_select ON vyra.users FOR SELECT TO vyra_worker USING (email_verified_at IS NULL AND created_at < now() - interval '7 days');
CREATE POLICY users_worker_delete ON vyra.users FOR DELETE TO vyra_worker USING (email_verified_at IS NULL AND created_at < now() - interval '7 days');
CREATE POLICY users_owner_select ON vyra.users FOR SELECT TO vyra_owner USING (true);
CREATE POLICY users_owner_update ON vyra.users FOR UPDATE TO vyra_owner
  USING ((SELECT vyra.has_staff_role('admin', 15, true))) WITH CHECK ((SELECT vyra.has_staff_role('admin', 15, true)));

-- ---------------------------------------------------------------- user_roles
CREATE POLICY user_roles_app_select ON vyra.user_roles FOR SELECT TO vyra_app USING (user_id = (SELECT vyra.ctx_user()));
CREATE POLICY user_roles_system_select ON vyra.user_roles FOR SELECT TO vyra_system USING (true);
CREATE POLICY user_roles_owner_select ON vyra.user_roles FOR SELECT TO vyra_owner USING (true);
CREATE POLICY user_roles_owner_insert ON vyra.user_roles FOR INSERT TO vyra_owner WITH CHECK ((SELECT vyra.has_staff_role('admin', 15, true)));
CREATE POLICY user_roles_owner_delete ON vyra.user_roles FOR DELETE TO vyra_owner USING ((SELECT vyra.has_staff_role('admin', 15, true)));

-- ---------------------------------------------------------------- sessions
CREATE POLICY sessions_app_select ON vyra.sessions FOR SELECT TO vyra_app USING (user_id = (SELECT vyra.ctx_user()));
CREATE POLICY sessions_app_insert ON vyra.sessions FOR INSERT TO vyra_app WITH CHECK (user_id = (SELECT vyra.ctx_user()));
CREATE POLICY sessions_app_update ON vyra.sessions FOR UPDATE TO vyra_app USING (user_id = (SELECT vyra.ctx_user())) WITH CHECK (user_id = (SELECT vyra.ctx_user()));
CREATE POLICY sessions_app_delete ON vyra.sessions FOR DELETE TO vyra_app USING (user_id = (SELECT vyra.ctx_user()));
CREATE POLICY sessions_system_select ON vyra.sessions FOR SELECT TO vyra_system USING (true);
CREATE POLICY sessions_system_insert ON vyra.sessions FOR INSERT TO vyra_system WITH CHECK (true);
CREATE POLICY sessions_system_update ON vyra.sessions FOR UPDATE TO vyra_system USING (true) WITH CHECK (true);
CREATE POLICY sessions_system_delete ON vyra.sessions FOR DELETE TO vyra_system USING (true);
CREATE POLICY sessions_worker_select ON vyra.sessions FOR SELECT TO vyra_worker USING (expires_at < now());
CREATE POLICY sessions_worker_delete ON vyra.sessions FOR DELETE TO vyra_worker USING (expires_at < now());
CREATE POLICY sessions_owner_select ON vyra.sessions FOR SELECT TO vyra_owner USING (true);
CREATE POLICY sessions_owner_delete ON vyra.sessions FOR DELETE TO vyra_owner USING ((SELECT vyra.has_staff_role('admin', 15, true)));

-- ---------------------------------------------------------------- auth_tokens
CREATE POLICY auth_tokens_app_select ON vyra.auth_tokens FOR SELECT TO vyra_app USING (user_id = (SELECT vyra.ctx_user()));
CREATE POLICY auth_tokens_app_insert ON vyra.auth_tokens FOR INSERT TO vyra_app WITH CHECK (user_id = (SELECT vyra.ctx_user()));
CREATE POLICY auth_tokens_app_update ON vyra.auth_tokens FOR UPDATE TO vyra_app USING (user_id = (SELECT vyra.ctx_user())) WITH CHECK (user_id = (SELECT vyra.ctx_user()));
CREATE POLICY auth_tokens_system_select ON vyra.auth_tokens FOR SELECT TO vyra_system USING (true);
CREATE POLICY auth_tokens_system_insert ON vyra.auth_tokens FOR INSERT TO vyra_system WITH CHECK (true);
CREATE POLICY auth_tokens_system_update ON vyra.auth_tokens FOR UPDATE TO vyra_system USING (true) WITH CHECK (true);
CREATE POLICY auth_tokens_worker_select ON vyra.auth_tokens FOR SELECT TO vyra_worker USING (expires_at < now() - interval '7 days');
CREATE POLICY auth_tokens_worker_delete ON vyra.auth_tokens FOR DELETE TO vyra_worker USING (expires_at < now() - interval '7 days');

-- ---------------------------------------------------------------- user_recovery_codes
CREATE POLICY recovery_app_select ON vyra.user_recovery_codes FOR SELECT TO vyra_app USING (user_id = (SELECT vyra.ctx_user()));
CREATE POLICY recovery_app_insert ON vyra.user_recovery_codes FOR INSERT TO vyra_app WITH CHECK (user_id = (SELECT vyra.ctx_user()));
CREATE POLICY recovery_app_update ON vyra.user_recovery_codes FOR UPDATE TO vyra_app USING (user_id = (SELECT vyra.ctx_user())) WITH CHECK (user_id = (SELECT vyra.ctx_user()));
CREATE POLICY recovery_app_delete ON vyra.user_recovery_codes FOR DELETE TO vyra_app USING (user_id = (SELECT vyra.ctx_user()));
CREATE POLICY recovery_system_select ON vyra.user_recovery_codes FOR SELECT TO vyra_system USING (true);
CREATE POLICY recovery_system_update ON vyra.user_recovery_codes FOR UPDATE TO vyra_system USING (true) WITH CHECK (true);
CREATE POLICY recovery_owner_select ON vyra.user_recovery_codes FOR SELECT TO vyra_owner USING ((SELECT vyra.has_staff_role('admin', 15, true)));
CREATE POLICY recovery_owner_delete ON vyra.user_recovery_codes FOR DELETE TO vyra_owner USING ((SELECT vyra.has_staff_role('admin', 15, true)));

-- ---------------------------------------------------------------- email_outbox
-- vyra_app n'écrit qu'à l'adresse de son propre compte, sauf l'alerte envoyée par un administrateur à un autre
-- compte (réinitialisation de la double authentification).
-- INSERT … ON CONFLICT (dedupe_key) lit la colonne d'arbitrage : PostgreSQL applique alors aussi les politiques
-- de lecture à la nouvelle ligne. D'où la lecture accordée à vyra_system (qui n'a que la colonne dedupe_key) et,
-- pour l'alerte, à l'administrateur (vyra_app : colonnes to_email et dedupe_key seulement).
CREATE POLICY outbox_app_select ON vyra.email_outbox FOR SELECT TO vyra_app
  USING (to_email = (SELECT u.email FROM vyra.users u WHERE u.id = (SELECT vyra.ctx_user())) OR (SELECT vyra.has_staff_role('admin', 15, true)));
CREATE POLICY outbox_app_insert ON vyra.email_outbox FOR INSERT TO vyra_app
  WITH CHECK (to_email = (SELECT u.email FROM vyra.users u WHERE u.id = (SELECT vyra.ctx_user())) OR (SELECT vyra.has_staff_role('admin', 15, true)));
CREATE POLICY outbox_app_delete ON vyra.email_outbox FOR DELETE TO vyra_app
  USING (to_email = (SELECT u.email FROM vyra.users u WHERE u.id = (SELECT vyra.ctx_user())));
CREATE POLICY outbox_system_select ON vyra.email_outbox FOR SELECT TO vyra_system USING (true);
CREATE POLICY outbox_system_insert ON vyra.email_outbox FOR INSERT TO vyra_system WITH CHECK (true);
CREATE POLICY outbox_worker_select ON vyra.email_outbox FOR SELECT TO vyra_worker USING (true);
CREATE POLICY outbox_worker_update ON vyra.email_outbox FOR UPDATE TO vyra_worker USING (true) WITH CHECK (true);
CREATE POLICY outbox_worker_delete ON vyra.email_outbox FOR DELETE TO vyra_worker USING (true);

-- ---------------------------------------------------------------- files
CREATE POLICY files_app_select ON vyra.files FOR SELECT TO vyra_app USING (owner_id = (SELECT vyra.ctx_user()));
CREATE POLICY files_app_insert ON vyra.files FOR INSERT TO vyra_app WITH CHECK (owner_id = (SELECT vyra.ctx_user()));
CREATE POLICY files_app_update ON vyra.files FOR UPDATE TO vyra_app USING (owner_id = (SELECT vyra.ctx_user())) WITH CHECK (owner_id = (SELECT vyra.ctx_user()));
CREATE POLICY files_worker_select ON vyra.files FOR SELECT TO vyra_worker USING (true);
CREATE POLICY files_worker_update ON vyra.files FOR UPDATE TO vyra_worker USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------- audit_log
CREATE POLICY audit_app_select ON vyra.audit_log FOR SELECT TO vyra_app USING (actor_id = (SELECT vyra.ctx_user()));
CREATE POLICY audit_app_insert ON vyra.audit_log FOR INSERT TO vyra_app WITH CHECK (actor_id = (SELECT vyra.ctx_user()));
CREATE POLICY audit_app_update ON vyra.audit_log FOR UPDATE TO vyra_app USING (actor_id = (SELECT vyra.ctx_user())) WITH CHECK (actor_id = (SELECT vyra.ctx_user()));
CREATE POLICY audit_system_insert ON vyra.audit_log FOR INSERT TO vyra_system WITH CHECK (true);
CREATE POLICY audit_worker_insert ON vyra.audit_log FOR INSERT TO vyra_worker WITH CHECK (true);

-- ---------------------------------------------------------------- projects et tables rattachées
CREATE POLICY projects_app_select ON vyra.projects FOR SELECT TO vyra_app USING (owner_id = (SELECT vyra.ctx_user()));
CREATE POLICY projects_app_insert ON vyra.projects FOR INSERT TO vyra_app WITH CHECK (owner_id = (SELECT vyra.ctx_user()));
CREATE POLICY projects_app_update ON vyra.projects FOR UPDATE TO vyra_app USING (owner_id = (SELECT vyra.ctx_user())) WITH CHECK (owner_id = (SELECT vyra.ctx_user()));
CREATE POLICY projects_app_delete ON vyra.projects FOR DELETE TO vyra_app USING (owner_id = (SELECT vyra.ctx_user()));
-- Purge des comptes non confirmés : seulement s'ils n'ont aucun projet (colonne owner_id seule, 009).
CREATE POLICY projects_worker_select ON vyra.projects FOR SELECT TO vyra_worker USING (true);

CREATE POLICY versions_app_select ON vyra.project_versions FOR SELECT TO vyra_app
  USING (EXISTS (SELECT 1 FROM vyra.projects p WHERE p.id = project_id AND p.owner_id = (SELECT vyra.ctx_user())));
CREATE POLICY versions_app_insert ON vyra.project_versions FOR INSERT TO vyra_app
  WITH CHECK (EXISTS (SELECT 1 FROM vyra.projects p WHERE p.id = project_id AND p.owner_id = (SELECT vyra.ctx_user())));
CREATE POLICY versions_app_delete ON vyra.project_versions FOR DELETE TO vyra_app
  USING (EXISTS (SELECT 1 FROM vyra.projects p WHERE p.id = project_id AND p.owner_id = (SELECT vyra.ctx_user())));

-- Les clés étrangères ignorent RLS : sans la seconde condition, un projet pourrait être relié au fichier d'un
-- autre utilisateur (H2-RLS-ARCHITECTURE §5).
CREATE POLICY exports_app_select ON vyra.project_exports FOR SELECT TO vyra_app
  USING (EXISTS (SELECT 1 FROM vyra.projects p WHERE p.id = project_id AND p.owner_id = (SELECT vyra.ctx_user())));
CREATE POLICY exports_app_insert ON vyra.project_exports FOR INSERT TO vyra_app
  WITH CHECK (EXISTS (SELECT 1 FROM vyra.projects p WHERE p.id = project_id AND p.owner_id = (SELECT vyra.ctx_user()))
              AND EXISTS (SELECT 1 FROM vyra.files f WHERE f.id = file_id AND f.owner_id = (SELECT vyra.ctx_user())));

CREATE POLICY project_files_app_select ON vyra.project_files FOR SELECT TO vyra_app
  USING (EXISTS (SELECT 1 FROM vyra.projects p WHERE p.id = project_id AND p.owner_id = (SELECT vyra.ctx_user())));
CREATE POLICY project_files_app_insert ON vyra.project_files FOR INSERT TO vyra_app
  WITH CHECK (EXISTS (SELECT 1 FROM vyra.projects p WHERE p.id = project_id AND p.owner_id = (SELECT vyra.ctx_user()))
              AND EXISTS (SELECT 1 FROM vyra.files f WHERE f.id = file_id AND f.owner_id = (SELECT vyra.ctx_user())));

CREATE POLICY charts_app_select ON vyra.thread_charts FOR SELECT TO vyra_app USING (owner_id = (SELECT vyra.ctx_user()));
CREATE POLICY charts_app_insert ON vyra.thread_charts FOR INSERT TO vyra_app WITH CHECK (owner_id = (SELECT vyra.ctx_user()));
CREATE POLICY charts_app_delete ON vyra.thread_charts FOR DELETE TO vyra_app USING (owner_id = (SELECT vyra.ctx_user()));

-- ---------------------------------------------------------------- activation, forcée, et contrôle
DO $$
DECLARE
  t text;
  tabs text[] := ARRAY['users', 'user_roles', 'sessions', 'auth_tokens', 'user_recovery_codes', 'email_outbox', 'files',
                       'audit_log', 'projects', 'project_versions', 'project_exports', 'project_files', 'thread_charts'];
  missing text[];
BEGIN
  FOREACH t IN ARRAY tabs LOOP
    EXECUTE format('ALTER TABLE vyra.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE vyra.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
  SELECT array_agg(x) INTO missing FROM unnest(tabs) x
   WHERE NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = format('vyra.%I', x)::regclass AND c.relrowsecurity AND c.relforcerowsecurity);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'RLS non forcée sur : %', missing; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'vyra' AND 'public' = ANY (roles)) THEN
    RAISE EXCEPTION 'Politique sans rôle explicite (PUBLIC) dans vyra.';
  END IF;
END $$;
