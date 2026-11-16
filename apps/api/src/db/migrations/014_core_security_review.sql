-- Socle H6 : corrections issues de la revue de sécurité des lots H2 à H5. Hypothèse d'attaque commune : une
-- injection SQL qui s'exécute sous vyra_app dans le contexte vérifié d'un utilisateur (ou d'un autre rôle de
-- connexion). Rien ici ne touche aux données existantes. Idempotente.

-- 1. Garde du dernier administrateur (011) : deux faiblesses corrigées.
--    a. Le verrou consultatif 7279432 pouvait être pris et gardé par n'importe quel rôle de connexion
--       (pg_advisory_lock ne demande aucun droit) : toutes les opérations gardées restaient alors bloquées.
--       Remplacé par le verrou d'une ligne d'une table que seul le propriétaire peut lire et verrouiller.
--    b. L'état « avant » était noté dans un paramètre (vyra.admin_guard_before) que tout rôle peut poser : le
--       mettre à 0 avant de retirer le dernier administrateur désarmait la garde. Il est désormais noté dans une
--       table du propriétaire, par transaction.
CREATE TABLE IF NOT EXISTS vyra.admin_guard_lock (id boolean PRIMARY KEY DEFAULT true CHECK (id));
INSERT INTO vyra.admin_guard_lock (id) VALUES (true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS vyra.admin_guard_tx (xid xid8 PRIMARY KEY, before int NOT NULL);
REVOKE ALL ON vyra.admin_guard_lock, vyra.admin_guard_tx FROM PUBLIC, vyra_app, vyra_system, vyra_worker, vyra_market;

CREATE OR REPLACE FUNCTION vyra.admin_guard_lock() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM vyra.admin_guard_lock FOR UPDATE;
END $$;

CREATE OR REPLACE FUNCTION vyra.admin_guard_note() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO vyra.admin_guard_tx (xid, before) VALUES (pg_catalog.pg_current_xact_id(), vyra.admin_guard_count())
    ON CONFLICT (xid) DO NOTHING;
  -- Déclencheur BEFORE : rendre NEW pour une mise à jour (rendre OLD l'annulerait sans erreur), OLD pour une suppression.
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION vyra.admin_guard_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  before int;
BEGIN
  PERFORM vyra.admin_guard_lock();
  -- Sous le verrou (contrôles sérialisés) : les lignes des transactions terminées, seules visibles hors la
  -- sienne, sont sans usage et retirées. Pas dans le déclencheur « avant » : deux transactions y supprimeraient
  -- la même ligne et la seconde attendrait la fin de la première.
  DELETE FROM vyra.admin_guard_tx t WHERE t.xid <> pg_catalog.pg_current_xact_id();
  SELECT t.before INTO before FROM vyra.admin_guard_tx t WHERE t.xid = pg_catalog.pg_current_xact_id();
  IF coalesce(before, 0) > 0 AND vyra.admin_guard_count() = 0 THEN
    RAISE EXCEPTION 'last_admin: la plateforme doit garder au moins un administrateur actif avec la double authentification.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

-- c. L'API n'a plus besoin du nombre d'administrateurs (qu'elle révélait à tout utilisateur) : seulement de savoir
--    si l'opération retirerait le dernier, pour soi-même ou, pour un administrateur, pour un autre compte.
CREATE OR REPLACE FUNCTION vyra.admin_guard_is_last(p_user uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_user IS NULL OR (p_user IS DISTINCT FROM vyra.ctx_user() AND NOT vyra.has_staff_role('admin', 15, true)) THEN RETURN NULL; END IF;
  RETURN EXISTS (SELECT 1 FROM vyra.user_roles r JOIN vyra.users u ON u.id = r.user_id
                  WHERE r.user_id = p_user AND r.role = 'admin' AND u.status = 'active' AND u.totp_enabled_at IS NOT NULL)
         AND vyra.admin_guard_count() <= 1;
END $$;

REVOKE ALL ON FUNCTION vyra.admin_guard_lock(), vyra.admin_guard_is_last(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vyra.admin_guard_count() FROM vyra_app;
GRANT EXECUTE ON FUNCTION vyra.admin_guard_lock(), vyra.admin_guard_is_last(uuid) TO vyra_app;

-- 2. Fraîcheur du second facteur : une date future (posée par une injection) ne vaut pas « vérifié à l'instant ».
--    Limite qui demeure : la base ne peut pas vérifier un code TOTP (secret chiffré par la clé du serveur) ;
--    une injection dans la session d'un administrateur peut donc marquer cette session « vérifiée maintenant ».
--    L'API reste l'autorité ; la base borne ce qu'une telle injection peut faire (voir docs/SECURITE-BASE.md).
CREATE OR REPLACE FUNCTION vyra.has_staff_role(p_role text, p_max_age_min int, p_totp_only boolean) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  me uuid := vyra.ctx_user();
BEGIN
  IF me IS NULL OR p_role IS NULL OR p_max_age_min IS NULL OR p_totp_only IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM vyra.sessions s JOIN vyra.users u ON u.id = s.user_id
     WHERE s.user_id = me
       AND s.token_hash = pg_catalog.decode(pg_catalog.current_setting('vyra.session', true), 'hex')
       AND u.totp_enabled_at IS NOT NULL
       AND s.auth_level = 'mfa'
       AND s.mfa_at > pg_catalog.now() - pg_catalog.make_interval(mins => p_max_age_min)
       AND s.mfa_at <= pg_catalog.now()
       AND (NOT p_totp_only OR s.mfa_via = 'totp')
       AND EXISTS (SELECT 1 FROM vyra.user_roles r WHERE r.user_id = me AND r.role IN (p_role, 'admin')));
END $$;

-- 3. Sessions et jetons créés par vyra_app pour son propre compte : durée bornée (SESSION_DAYS ≤ 90 ; lien de
--    confirmation 48 h), jamais de vérification datée du futur, et vyra_app ne crée que des liens de
--    confirmation d'adresse (jamais de lien de réinitialisation du mot de passe).
DROP POLICY IF EXISTS sessions_app_insert ON vyra.sessions;
CREATE POLICY sessions_app_insert ON vyra.sessions FOR INSERT TO vyra_app
  WITH CHECK (user_id = (SELECT vyra.ctx_user()) AND expires_at <= now() + interval '90 days' AND (mfa_at IS NULL OR mfa_at <= now()));
DROP POLICY IF EXISTS sessions_app_update ON vyra.sessions;
CREATE POLICY sessions_app_update ON vyra.sessions FOR UPDATE TO vyra_app
  USING (user_id = (SELECT vyra.ctx_user())) WITH CHECK (user_id = (SELECT vyra.ctx_user()) AND (mfa_at IS NULL OR mfa_at <= now()));
DROP POLICY IF EXISTS auth_tokens_app_insert ON vyra.auth_tokens;
CREATE POLICY auth_tokens_app_insert ON vyra.auth_tokens FOR INSERT TO vyra_app
  WITH CHECK (user_id = (SELECT vyra.ctx_user()) AND purpose = 'verify_email' AND expires_at <= now() + interval '48 hours');

-- 4. Verdict antivirus : écrit par vyra_worker (tâche serveur), plus par le contexte de l'utilisateur. Un
--    utilisateur ne crée que des fichiers « en attente », ou des exports produits par le serveur ; il ne peut plus
--    se déclarer « sain » ni déplacer un fichier dans le stockage. Il garde la mise à la corbeille (deleted_at).
REVOKE UPDATE (storage_key, scan_status, scan_detail, scan_engine, scanned_at) ON vyra.files FROM vyra_app;
DROP POLICY IF EXISTS files_app_insert ON vyra.files;
CREATE POLICY files_app_insert ON vyra.files FOR INSERT TO vyra_app
  WITH CHECK (owner_id = (SELECT vyra.ctx_user()) AND (scan_status = 'pending' OR (scan_status = 'not_required' AND kind = 'export')));

-- 5. Journal d'audit : l'utilisateur ne modifie ses lignes que pour les anonymiser (suppression du compte).
DROP POLICY IF EXISTS audit_app_update ON vyra.audit_log;
CREATE POLICY audit_app_update ON vyra.audit_log FOR UPDATE TO vyra_app
  USING (actor_id = (SELECT vyra.ctx_user())) WITH CHECK (actor_id = (SELECT vyra.ctx_user()) AND ip IS NULL AND details = '{}'::jsonb);

-- 6. File d'e-mails : la clé anti-doublon d'un utilisateur porte son propre identifiant (sinon il pourrait
--    occuper d'avance la clé d'une alerte destinée à un autre compte) ; l'exception « administrateur » se limite
--    aux alertes de sécurité.
DROP POLICY IF EXISTS outbox_app_select ON vyra.email_outbox;
CREATE POLICY outbox_app_select ON vyra.email_outbox FOR SELECT TO vyra_app
  USING (to_email = (SELECT u.email FROM vyra.users u WHERE u.id = (SELECT vyra.ctx_user()))
         OR (template = 'security' AND (SELECT vyra.has_staff_role('admin', 15, true))));
DROP POLICY IF EXISTS outbox_app_insert ON vyra.email_outbox;
CREATE POLICY outbox_app_insert ON vyra.email_outbox FOR INSERT TO vyra_app
  WITH CHECK ((to_email = (SELECT u.email FROM vyra.users u WHERE u.id = (SELECT vyra.ctx_user()))
               AND (dedupe_key IS NULL OR dedupe_key LIKE '%:' || (SELECT vyra.ctx_user())::text || ':%'))
              OR (template = 'security' AND (SELECT vyra.has_staff_role('admin', 15, true))));

-- 7. Versions : l'auteur enregistré est l'utilisateur du contexte (ou personne).
DROP POLICY IF EXISTS versions_app_insert ON vyra.project_versions;
CREATE POLICY versions_app_insert ON vyra.project_versions FOR INSERT TO vyra_app
  WITH CHECK (EXISTS (SELECT 1 FROM vyra.projects p WHERE p.id = project_id AND p.owner_id = (SELECT vyra.ctx_user()))
              AND (created_by IS NULL OR created_by = (SELECT vyra.ctx_user())));
