-- VYRA — retour arrière du lot H2 (schéma vyra → public), SANS PERTE DE DONNÉES. Exceptionnel : la voie normale
-- est le retour en avant (nouvelle migration corrective). À utiliser seulement pour revenir au code du lot H1.
--
-- Exécution : par vyra_migrator (le script prend lui-même le rôle propriétaire), connecté à la base, API arrêtée.
--   psql "<url vyra_migrator>" -v ON_ERROR_STOP=1 --single-transaction -f scripts/db/rollback-h2.sql
-- Ensuite, par l'administrateur (facultatif) : ALTER ROLE … IN DATABASE … RESET search_path pour chaque rôle.
--
-- Effets, dans une seule transaction (tout ou rien) :
--   1. contrôles : registre dans vyra, migrations 007-009 appliquées (et éventuellement 010 [H3], 011 [H4]),
--      aucune autre ; les déclencheurs et fonctions du dernier administrateur (011) sont retirés ;
--   2. les 16 tables et le registre reviennent dans public (catalogue seulement, aucune copie) ;
--   3. droits de transition du lot H1 rétablis (vyra_app : opérations de données sur toutes les tables du socle) ;
--   4. lignes 007-011 retirées du registre (le runner H1 ne les connaît pas : sinon il refuserait de démarrer) ;
--   5. schéma vyra supprimé s'il est vide (sinon échec et annulation) : le runner H1 y recréerait un registre vide.
-- La clé étrangère corrigée par 007 (ON DELETE SET NULL) est conservée : elle est compatible avec le code H1.
SET ROLE vyra_owner;
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE
  t text;
  tabs text[] := ARRAY['users', 'user_roles', 'sessions', 'auth_tokens', 'email_outbox', 'files', 'audit_log',
                       'projects', 'project_versions', 'project_exports', 'project_files',
                       'user_recovery_codes', 'mfa_challenges', 'thread_charts', 'auth_throttle', 'rate_limits'];
  applied text[];
BEGIN
  IF to_regclass('vyra.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Registre absent du schéma vyra : rien à défaire.';
  END IF;
  SELECT array_agg(name ORDER BY name) INTO applied FROM vyra.schema_migrations WHERE name >= '007';
  IF applied IS DISTINCT FROM ARRAY['007_core_user_roles_fk.sql', '008_core_schema_vyra.sql', '009_core_privileges.sql']
     AND applied IS DISTINCT FROM ARRAY['007_core_user_roles_fk.sql', '008_core_schema_vyra.sql', '009_core_privileges.sql', '010_core_privileges_split.sql']
     AND applied IS DISTINCT FROM ARRAY['007_core_user_roles_fk.sql', '008_core_schema_vyra.sql', '009_core_privileges.sql', '010_core_privileges_split.sql', '011_core_session_assurance.sql'] THEN
    RAISE EXCEPTION 'Migrations postérieures à H1 inattendues : % (retour arrière refusé).', applied;
  END IF;

  -- Lot H4 : déclencheurs et fonctions du dernier administrateur (inconnus du code H1). Les colonnes de niveau
  -- de session restent (valeurs par défaut compatibles avec le code H1).
  DROP TRIGGER IF EXISTS user_roles_admin_guard_note ON vyra.user_roles;
  DROP TRIGGER IF EXISTS user_roles_admin_guard_check ON vyra.user_roles;
  DROP TRIGGER IF EXISTS users_admin_guard_note ON vyra.users;
  DROP TRIGGER IF EXISTS users_admin_guard_check ON vyra.users;
  DROP FUNCTION IF EXISTS vyra.admin_guard_check();
  DROP FUNCTION IF EXISTS vyra.admin_guard_note();
  DROP FUNCTION IF EXISTS vyra.admin_guard_count();

  FOREACH t IN ARRAY tabs || ARRAY['schema_migrations'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      RAISE EXCEPTION 'Table % déjà présente dans public : retour arrière refusé.', t;
    END IF;
    EXECUTE format('ALTER TABLE vyra.%I SET SCHEMA public', t);
  END LOOP;

  -- Droits de transition du lot H1 (ancien scripts/db/grants-h1.sql).
  FOREACH t IN ARRAY tabs || ARRAY['schema_migrations'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, vyra_app, vyra_system, vyra_worker, vyra_market', t);
  END LOOP;
  FOREACH t IN ARRAY tabs LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO vyra_app', t);
  END LOOP;
  GRANT SELECT ON public.schema_migrations TO vyra_app;
  FOREACH t IN ARRAY ARRAY['email_outbox_id_seq', 'audit_log_id_seq', 'project_versions_id_seq', 'user_recovery_codes_id_seq'] LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC, vyra_app, vyra_system, vyra_worker, vyra_market', t);
    EXECUTE format('GRANT USAGE ON SEQUENCE public.%I TO vyra_app', t);
  END LOOP;

  DELETE FROM public.schema_migrations WHERE name IN ('007_core_user_roles_fk.sql', '008_core_schema_vyra.sql', '009_core_privileges.sql', '010_core_privileges_split.sql', '011_core_session_assurance.sql');
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE vyra_owner GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
DROP SCHEMA vyra RESTRICT;
RESET ROLE;
