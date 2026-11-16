-- Socle H4 : niveau d'authentification des sessions et protection du dernier administrateur.
--
-- 1. Niveau de session (document 21 §1). La session reste valable SESSION_DAYS ; seule la fraîcheur de la
--    vérification du second facteur (mfa_at) expire. mfa_via distingue un code TOTP d'un code de secours : les
--    opérations sur les rôles du personnel exigent un TOTP récent, jamais un code de secours.
--    Idempotent : un retour arrière (scripts/db/rollback-h2.sql) laisse ces colonnes en place, sans rien effacer ;
--    la migration peut alors être réappliquée.
ALTER TABLE vyra.sessions ADD COLUMN IF NOT EXISTS auth_level text NOT NULL DEFAULT 'password' CHECK (auth_level IN ('password', 'mfa'));
ALTER TABLE vyra.sessions ADD COLUMN IF NOT EXISTS mfa_at timestamptz;
ALTER TABLE vyra.sessions ADD COLUMN IF NOT EXISTS mfa_via text CHECK (mfa_via IN ('totp', 'recovery'));
ALTER TABLE vyra.sessions DROP CONSTRAINT IF EXISTS sessions_mfa_consistent;
ALTER TABLE vyra.sessions ADD CONSTRAINT sessions_mfa_consistent
  CHECK ((auth_level = 'password' AND mfa_at IS NULL AND mfa_via IS NULL) OR (auth_level = 'mfa' AND mfa_at IS NOT NULL AND mfa_via IS NOT NULL));

-- Droits sur les nouvelles colonnes (les droits par colonne ne couvrent pas les colonnes ajoutées ensuite) :
-- vyra_system crée les sessions à la connexion ; vyra_app les crée au changement de mot de passe et les met à
-- jour lors d'une nouvelle saisie du code (step-up) ou de l'activation de la double authentification.
GRANT INSERT (auth_level, mfa_at, mfa_via) ON vyra.sessions TO vyra_system, vyra_app;
GRANT SELECT (auth_level, mfa_at, mfa_via) ON vyra.sessions TO vyra_app;
GRANT UPDATE (auth_level, mfa_at, mfa_via) ON vyra.sessions TO vyra_app;

-- 2. Rôles du personnel attribués et retirés par un administrateur (routes /api/admin du socle) : vyra_app.
GRANT INSERT (user_id, role, granted_by) ON vyra.user_roles TO vyra_app;
GRANT DELETE ON vyra.user_roles TO vyra_app;

-- 3. Dernier administrateur : une transaction ne peut pas laisser la plateforme sans administrateur actif ayant
--    la double authentification, s'il y en avait un au début de la transaction. Contrôle aussi fait dans l'API
--    (messages clairs) ; ici, la garantie, quel que soit le chemin (API, requête directe, cascade).
--
--    * Avant chaque changement touchant un administrateur, l'état initial est noté dans la transaction
--      (paramètre local vyra.admin_guard_before) ;
--    * à la validation (déclencheurs de contrainte différés), le verrou consultatif 7279432 sérialise les
--      transactions concernées, puis l'état final est relu : deux retraits simultanés ne peuvent pas passer
--      tous les deux.
--    Écart assumé avec le document 21 (« droits de l'appelant ») : les fonctions sont SECURITY DEFINER, avec un
--    chemin de recherche vide et des noms qualifiés. En droits de l'appelant, vyra_worker (purge des comptes non
--    confirmés) n'aurait pas le droit de lire les rôles, et au lot H5, sous RLS, chaque rôle ne verrait que ses
--    propres lignes : le décompte des administrateurs serait faux. Aucun droit EXECUTE n'est accordé.
CREATE OR REPLACE FUNCTION vyra.admin_guard_count() RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*)::int FROM vyra.user_roles r JOIN vyra.users u ON u.id = r.user_id
   WHERE r.role = 'admin' AND u.status = 'active' AND u.totp_enabled_at IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION vyra.admin_guard_note() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(pg_catalog.current_setting('vyra.admin_guard_before', true), '') = '' THEN
    PERFORM pg_catalog.set_config('vyra.admin_guard_before', vyra.admin_guard_count()::text, true);
  END IF;
  -- Déclencheur BEFORE : rendre NEW pour une mise à jour (rendre OLD l'annulerait sans erreur), OLD pour une suppression.
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION vyra.admin_guard_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  before int := nullif(pg_catalog.current_setting('vyra.admin_guard_before', true), '')::int;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(7279432);
  IF coalesce(before, 0) > 0 AND vyra.admin_guard_count() = 0 THEN
    RAISE EXCEPTION 'last_admin: la plateforme doit garder au moins un administrateur actif avec la double authentification.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION vyra.admin_guard_count(), vyra.admin_guard_note(), vyra.admin_guard_check() FROM PUBLIC;

DROP TRIGGER IF EXISTS user_roles_admin_guard_note ON vyra.user_roles;
DROP TRIGGER IF EXISTS user_roles_admin_guard_check ON vyra.user_roles;
DROP TRIGGER IF EXISTS users_admin_guard_note ON vyra.users;
DROP TRIGGER IF EXISTS users_admin_guard_check ON vyra.users;
CREATE TRIGGER user_roles_admin_guard_note BEFORE DELETE OR UPDATE ON vyra.user_roles
  FOR EACH ROW WHEN (OLD.role = 'admin') EXECUTE FUNCTION vyra.admin_guard_note();
CREATE CONSTRAINT TRIGGER user_roles_admin_guard_check AFTER DELETE OR UPDATE ON vyra.user_roles
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.role = 'admin') EXECUTE FUNCTION vyra.admin_guard_check();

CREATE TRIGGER users_admin_guard_note BEFORE DELETE OR UPDATE OF status, totp_enabled_at ON vyra.users
  FOR EACH ROW WHEN (OLD.status = 'active' AND OLD.totp_enabled_at IS NOT NULL) EXECUTE FUNCTION vyra.admin_guard_note();
CREATE CONSTRAINT TRIGGER users_admin_guard_check AFTER DELETE OR UPDATE OF status, totp_enabled_at ON vyra.users
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (OLD.status = 'active' AND OLD.totp_enabled_at IS NOT NULL) EXECUTE FUNCTION vyra.admin_guard_check();

-- L'API vérifie aussi la règle avant d'agir, pour répondre par un message clair (même décompte, même verrou).
GRANT EXECUTE ON FUNCTION vyra.admin_guard_count() TO vyra_app;
