-- VYRA — récupération d'un administrateur sans aucun facteur (cas 3, docs/SECURITE-BASE.md §5.4).
--
-- MODIFICATION D'UN COMPTE DE PRODUCTION : uniquement sur décision explicite du responsable, à chaque fois, à deux
-- personnes, avec une trace écrite hors de la base. API arrêtée ou non : le script est transactionnel.
--
--   psql "<url vyra_migrator>" -v ON_ERROR_STOP=1 --single-transaction -v email='admin@exemple.be' -f scripts/db/recover-last-admin.sql
--
-- Effet, dans une seule transaction : double authentification et codes de secours effacés pour ce compte, ses
-- sessions fermées. La garde du dernier administrateur et le forçage RLS ne sont levés que pendant la transaction.
-- Refus (rien n'est modifié) si l'adresse ne désigne pas exactement un administrateur actif.
-- Ensuite : l'intéressé se connecte par mot de passe et réactive immédiatement la double authentification.
SET LOCAL ROLE vyra_owner;
SET LOCAL lock_timeout = '10s';
SELECT set_config('vyra.recover_email', lower(:'email'), true);

DO $$
DECLARE
  target uuid;
BEGIN
  ALTER TABLE vyra.users NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE vyra.user_recovery_codes NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE vyra.sessions NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE vyra.audit_log NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE vyra.users DISABLE TRIGGER users_admin_guard_check;

  SELECT u.id INTO target FROM vyra.users u JOIN vyra.user_roles r ON r.user_id = u.id AND r.role = 'admin'
   WHERE u.email = current_setting('vyra.recover_email') AND u.status = 'active';
  IF target IS NULL THEN
    RAISE EXCEPTION 'Aucun administrateur actif avec l''adresse % : rien n''est modifié.', current_setting('vyra.recover_email');
  END IF;
  UPDATE vyra.users SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL, updated_at = now()
   WHERE id = target;
  DELETE FROM vyra.user_recovery_codes WHERE user_id = target;
  DELETE FROM vyra.sessions WHERE user_id = target;
  INSERT INTO vyra.audit_log (actor_id, action, subject, details)
  VALUES (NULL, 'ops.admin_mfa_recovered', 'user:' || target, '{"procedure": "recover-last-admin.sql"}');

  ALTER TABLE vyra.users ENABLE TRIGGER users_admin_guard_check;
  ALTER TABLE vyra.audit_log FORCE ROW LEVEL SECURITY;
  ALTER TABLE vyra.sessions FORCE ROW LEVEL SECURITY;
  ALTER TABLE vyra.user_recovery_codes FORCE ROW LEVEL SECURITY;
  ALTER TABLE vyra.users FORCE ROW LEVEL SECURITY;
  RAISE NOTICE 'Double authentification effacée pour %.', current_setting('vyra.recover_email');
END $$;
