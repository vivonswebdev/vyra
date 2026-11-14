-- Socle H2 : les tables du socle et le registre des migrations passent du schéma public au schéma dédié vyra.
--
-- * Aucune copie de données : ALTER TABLE … SET SCHEMA ne modifie que le catalogue. Index, contraintes, séquences
--   possédées (bigserial), valeurs par défaut et droits suivent chaque table.
-- * Tables nommées explicitement (jamais « tout le schéma ») : les tables du Market (006_market_identity) ne sont
--   pas concernées ; 050_market_hardening les normalisera, que 006 ait été appliquée avant ou après celle-ci.
-- * Idempotente et convergente : sur une base neuve préparée par scripts/db/database-setup.sql, le schéma vyra
--   existe déjà et les migrations 001-006 y ont créé leurs tables : rien n'est déplacé.
-- * Une table présente dans les deux schémas est une anomalie : la migration est annulée, rien n'est fusionné.
SET LOCAL lock_timeout = '10s';

DO $$
DECLARE
  t text;
  pub regclass;
  dst regclass;
  tabs text[] := ARRAY['users', 'user_roles', 'sessions', 'auth_tokens', 'email_outbox', 'files', 'audit_log',
                       'projects', 'project_versions', 'project_exports', 'project_files',
                       'user_recovery_codes', 'mfa_challenges', 'thread_charts', 'auth_throttle', 'rate_limits',
                       'schema_migrations'];
BEGIN
  -- En production, le schéma est créé par l'administrateur (database-setup.sql) : le propriétaire n'a pas le
  -- droit de créer des schémas dans la base. Ici, seulement pour une base de développement ou de test.
  IF to_regnamespace('vyra') IS NULL THEN
    CREATE SCHEMA vyra AUTHORIZATION vyra_owner;
  END IF;

  FOREACH t IN ARRAY tabs LOOP
    pub := to_regclass(format('public.%I', t));
    dst := to_regclass(format('vyra.%I', t));
    IF pub IS NOT NULL AND dst IS NOT NULL THEN
      RAISE EXCEPTION 'Table % présente dans public et dans vyra : situation anormale, migration annulée.', t;
    ELSIF pub IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA vyra', t);
    ELSIF dst IS NULL THEN
      RAISE EXCEPTION 'Table % introuvable (ni public, ni vyra).', t;
    END IF;
    -- Propriétaire : déjà vyra_owner quand la migration est appliquée par le migrateur ; une base de
    -- développement migrée par un superutilisateur est remise au propriétaire prévu.
    IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = format('vyra.%I', t)::regclass) <> 'vyra_owner' THEN
      EXECUTE format('ALTER TABLE vyra.%I OWNER TO vyra_owner', t);
    END IF;
  END LOOP;

  -- Contrôles : tout est dans vyra, au bon propriétaire ; plus aucune table du socle dans public.
  IF EXISTS (SELECT 1 FROM unnest(tabs) x WHERE to_regclass(format('public.%I', x)) IS NOT NULL) THEN
    RAISE EXCEPTION 'Contrôle : une table du socle est restée dans public.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'vyra'::regnamespace AND c.relkind IN ('r', 'S', 'i')
               AND pg_get_userbyid(c.relowner) <> 'vyra_owner') THEN
    RAISE EXCEPTION 'Contrôle : un objet du schéma vyra n''appartient pas à vyra_owner.';
  END IF;
END $$;
