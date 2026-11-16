-- Socle H5 (1/2) : fonctions du contexte utilisateur et opérations d'administration (document 19 ; H2-RLS-ARCHITECTURE
-- §3). Aucune politique ici : RLS est activé par 013_core_rls, dans la même livraison.
--
-- Règles communes : SECURITY DEFINER (propriétaire vyra_owner), chemin de recherche vide, tous les noms qualifiés
-- (une table temporaire homonyme ne peut pas s'interposer), aucun EXECUTE public ; EXECUTE accordé à vyra_app
-- seulement. Idempotent (CREATE OR REPLACE).

-- 1. Utilisateur du contexte. Le contexte posé par l'API (set_config(…, true) dans withUser) n'est pas une
--    preuve : l'identifiant n'est retenu que si une session non expirée de CET utilisateur, compte actif, porte
--    l'empreinte fournie. Sinon NULL : toute politique qui compare à NULL est fausse (aucune ligne, aucune
--    écriture). Une valeur mal formée donne NULL, jamais une erreur.
CREATE OR REPLACE FUNCTION vyra.ctx_user() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid text := pg_catalog.current_setting('vyra.user_id', true);
  sess text := pg_catalog.current_setting('vyra.session', true);
  found uuid;
BEGIN
  IF uid IS NULL OR uid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
  IF sess IS NULL OR sess !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT s.user_id INTO found
    FROM vyra.sessions s JOIN vyra.users u ON u.id = s.user_id
   WHERE s.token_hash = pg_catalog.decode(sess, 'hex') AND s.user_id = uid::uuid
     AND s.expires_at > pg_catalog.now() AND u.status = 'active';
  RETURN found;
END $$;

-- 2. Rôle du personnel avec second facteur récent (même règle que checkAssurance, @vyra/shared) : rôle (ou
--    admin), double authentification activée, session courante de niveau « mfa » vérifiée depuis moins de
--    p_max_age_min minutes, par un code TOTP si p_totp_only. Seconde barrière : l'API vérifie la même règle.
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
       AND s.auth_level = 'mfa' AND s.mfa_at > pg_catalog.now() - pg_catalog.make_interval(mins => p_max_age_min)
       AND (NOT p_totp_only OR s.mfa_via = 'totp')
       AND EXISTS (SELECT 1 FROM vyra.user_roles r WHERE r.user_id = me AND r.role IN (p_role, 'admin')));
END $$;

-- 3. Dernier administrateur (lot H4) : l'utilisateur p_user est-il compté parmi les administrateurs actifs avec
--    double authentification ? Réponse donnée seulement pour soi-même ou à un administrateur (opération
--    « roles ») ; sinon NULL.
CREATE OR REPLACE FUNCTION vyra.admin_guard_counts(p_user uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_user IS NULL OR (p_user IS DISTINCT FROM vyra.ctx_user() AND NOT vyra.has_staff_role('admin', 15, true)) THEN RETURN NULL; END IF;
  RETURN EXISTS (SELECT 1 FROM vyra.user_roles r JOIN vyra.users u ON u.id = r.user_id
                  WHERE r.user_id = p_user AND r.role = 'admin' AND u.status = 'active' AND u.totp_enabled_at IS NOT NULL);
END $$;

-- 4. Opérations d'administration (routes /api/admin, lot H4). Sous RLS, vyra_app ne voit et ne modifie que les
--    lignes de l'utilisateur du contexte ; ces fonctions sont le seul passage vers les comptes des autres, et ne
--    renvoient ni ne modifient que ce que l'opération exige (jamais d'empreinte de mot de passe, de secret TOTP
--    ni d'empreinte de session). Chacune exige un administrateur avec un TOTP de moins de 15 minutes.
CREATE OR REPLACE FUNCTION vyra.admin_find_user(p_email text)
RETURNS TABLE (id uuid, email text, display_name text, status text, mfa boolean, roles text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT vyra.has_staff_role('admin', 15, true) THEN
    RAISE EXCEPTION 'staff_required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT u.id, u.email, u.display_name, u.status, u.totp_enabled_at IS NOT NULL,
           COALESCE((SELECT pg_catalog.array_agg(r.role ORDER BY r.role) FROM vyra.user_roles r WHERE r.user_id = u.id), '{}'::text[])
      FROM vyra.users u WHERE u.email = pg_catalog.lower(p_email);
END $$;

-- Renvoie les rôles après l'opération, ou NULL si le compte n'existe pas ou n'est pas actif.
CREATE OR REPLACE FUNCTION vyra.admin_set_role(p_user uuid, p_role text, p_grant boolean) RETURNS text[]
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  me uuid := vyra.ctx_user();
BEGIN
  IF NOT vyra.has_staff_role('admin', 15, true) THEN
    RAISE EXCEPTION 'staff_required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_grant IS NULL OR p_role IS NULL THEN RAISE EXCEPTION 'invalid_argument' USING ERRCODE = 'invalid_parameter_value'; END IF;
  IF NOT EXISTS (SELECT 1 FROM vyra.users u WHERE u.id = p_user AND u.status = 'active') THEN RETURN NULL; END IF;
  IF p_grant THEN
    INSERT INTO vyra.user_roles (user_id, role, granted_by) VALUES (p_user, p_role, me) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM vyra.user_roles r WHERE r.user_id = p_user AND r.role = p_role;
  END IF;
  RETURN COALESCE((SELECT pg_catalog.array_agg(r.role ORDER BY r.role) FROM vyra.user_roles r WHERE r.user_id = p_user), '{}'::text[]);
END $$;

-- Récupération, cas 2 (document 21 §1) : facteurs effacés, codes de secours supprimés, sessions fermées.
-- status : 'ok' | 'not_found' | 'not_enabled' | 'self' ; l'adresse et la langue servent à l'alerte e-mail.
CREATE OR REPLACE FUNCTION vyra.admin_reset_mfa(p_user uuid)
RETURNS TABLE (status text, email text, display_name text, locale text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t record;
BEGIN
  IF NOT vyra.has_staff_role('admin', 15, true) THEN
    RAISE EXCEPTION 'staff_required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_user IS NOT DISTINCT FROM vyra.ctx_user() THEN RETURN QUERY SELECT 'self'::text, NULL::text, NULL::text, NULL::text; RETURN; END IF;
  SELECT u.email, u.display_name, u.locale, u.totp_enabled_at INTO t FROM vyra.users u WHERE u.id = p_user;
  IF NOT FOUND THEN RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::text, NULL::text; RETURN; END IF;
  IF t.totp_enabled_at IS NULL THEN RETURN QUERY SELECT 'not_enabled'::text, NULL::text, NULL::text, NULL::text; RETURN; END IF;
  UPDATE vyra.users u SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE u.id = p_user;
  DELETE FROM vyra.user_recovery_codes c WHERE c.user_id = p_user;
  DELETE FROM vyra.sessions s WHERE s.user_id = p_user;
  RETURN QUERY SELECT 'ok'::text, t.email::text, t.display_name::text, t.locale::text;
END $$;

REVOKE ALL ON FUNCTION vyra.ctx_user(), vyra.has_staff_role(text, int, boolean), vyra.admin_guard_counts(uuid),
  vyra.admin_find_user(text), vyra.admin_set_role(uuid, text, boolean), vyra.admin_reset_mfa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vyra.ctx_user(), vyra.has_staff_role(text, int, boolean), vyra.admin_guard_counts(uuid),
  vyra.admin_find_user(text), vyra.admin_set_role(uuid, text, boolean), vyra.admin_reset_mfa(uuid) TO vyra_app;
