-- Socle H2 : droits exacts des rôles d'exécution sur le schéma vyra (matrice H2-ROLE-PRIVILEGES-MATRIX).
--
-- Règles :
-- * chaque droit correspond à un accès réel du code (fichier:ligne dans la matrice) ; aucun droit de commodité ;
-- * droits par colonne dès que la requête le permet ; jamais « ON ALL TABLES » ; jamais TRUNCATE, REFERENCES,
--   TRIGGER ; aucun droit de création dans vyra ;
-- * vyra_system (authentification, accès sans utilisateur) et vyra_worker (tâches de fond, santé) reçoivent leurs
--   droits cibles dès maintenant, bien que l'API ne les utilise qu'au lot H3 ;
-- * TRANSITION (jusqu'à 010_core_privileges_split, lot H3) : l'API n'a encore qu'un seul pool, celui de
--   vyra_app, qui exécute aussi les requêtes d'authentification et de tâches de fond. vyra_app reçoit donc, en
--   plus de ses droits propres (bloc 3), exactement les droits de vyra_system et de vyra_worker (blocs 4 et 5 :
--   chaque GRANT y nomme vyra_app en second). Rien de plus.
-- * vyra_market : aucun droit sur les tables du socle. vyra_backup : lecture par pg_read_all_data (roles.sql).

-- 1. Les droits larges du lot H1 ont suivi les tables lors du changement de schéma (008) : tout est retiré
--    d'abord, la matrice est ensuite posée explicitement.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'user_roles', 'sessions', 'auth_tokens', 'email_outbox', 'files', 'audit_log',
                           'projects', 'project_versions', 'project_exports', 'project_files',
                           'user_recovery_codes', 'mfa_challenges', 'thread_charts', 'auth_throttle', 'rate_limits',
                           'schema_migrations'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE vyra.%I FROM PUBLIC, vyra_app, vyra_system, vyra_worker, vyra_market', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['email_outbox_id_seq', 'audit_log_id_seq', 'project_versions_id_seq', 'user_recovery_codes_id_seq'] LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE vyra.%I FROM PUBLIC, vyra_app, vyra_system, vyra_worker, vyra_market', t);
  END LOOP;
END $$;

-- 2. Schéma : utilisation seulement, aucune création. Privilèges par défaut : une fonction future n'est pas
--    exécutable par tous (PostgreSQL accorde EXECUTE à PUBLIC par défaut ; seule la forme globale peut le retirer).
REVOKE ALL ON SCHEMA vyra FROM PUBLIC;
GRANT USAGE ON SCHEMA vyra TO vyra_app, vyra_system, vyra_worker, vyra_market, vyra_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE vyra_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 3. vyra_app : requêtes faites pour l'utilisateur connecté.
GRANT SELECT (id, email, display_name, email_verified_at, locale, theme, preferences, status, created_at, updated_at,
              password_hash, totp_secret_enc, totp_pending_enc, totp_enabled_at, totp_last_step) ON vyra.users TO vyra_app;
GRANT UPDATE (display_name, locale, theme, preferences, password_hash,
              totp_secret_enc, totp_pending_enc, totp_enabled_at, totp_last_step, updated_at) ON vyra.users TO vyra_app;
GRANT DELETE ON vyra.users TO vyra_app;
GRANT SELECT (user_id, role) ON vyra.user_roles TO vyra_app;
GRANT SELECT (id, token_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent) ON vyra.sessions TO vyra_app;
GRANT INSERT (token_hash, user_id, expires_at, ip, user_agent) ON vyra.sessions TO vyra_app;
GRANT DELETE ON vyra.sessions TO vyra_app;
GRANT SELECT (user_id, purpose, used_at) ON vyra.auth_tokens TO vyra_app;
GRANT INSERT (token_hash, user_id, purpose, expires_at) ON vyra.auth_tokens TO vyra_app;
GRANT UPDATE (used_at) ON vyra.auth_tokens TO vyra_app;
GRANT SELECT (id, user_id, code_hash, used_at) ON vyra.user_recovery_codes TO vyra_app;
GRANT INSERT (user_id, code_hash) ON vyra.user_recovery_codes TO vyra_app;
GRANT UPDATE (used_at) ON vyra.user_recovery_codes TO vyra_app;
GRANT DELETE ON vyra.user_recovery_codes TO vyra_app;
GRANT SELECT (to_email) ON vyra.email_outbox TO vyra_app;
GRANT INSERT (to_email, template, subject, body_text, dedupe_key) ON vyra.email_outbox TO vyra_app;
GRANT DELETE ON vyra.email_outbox TO vyra_app;
GRANT SELECT ON vyra.files TO vyra_app;
GRANT INSERT (owner_id, kind, storage_key, filename, mime, size_bytes, sha256, scan_status, scan_detail, scan_engine, scanned_at) ON vyra.files TO vyra_app;
GRANT UPDATE (storage_key, scan_status, scan_detail, scan_engine, scanned_at, deleted_at) ON vyra.files TO vyra_app;
GRANT SELECT ON vyra.audit_log TO vyra_app;
GRANT INSERT (actor_id, action, subject, ip, details) ON vyra.audit_log TO vyra_app;
GRANT UPDATE (ip, details) ON vyra.audit_log TO vyra_app;
GRANT SELECT ON vyra.projects TO vyra_app;
GRANT INSERT (owner_id, name, design, settings, revision) ON vyra.projects TO vyra_app;
GRANT UPDATE (name, design, settings, revision, thumbnail_svg, thumbnail_revision, deleted_at, updated_at) ON vyra.projects TO vyra_app;
GRANT DELETE ON vyra.projects TO vyra_app;
GRANT SELECT ON vyra.project_versions TO vyra_app;
GRANT INSERT (project_id, revision, label, name, design, settings, created_by) ON vyra.project_versions TO vyra_app;
GRANT DELETE ON vyra.project_versions TO vyra_app;
GRANT SELECT ON vyra.project_exports TO vyra_app;
GRANT INSERT (project_id, file_id, format, revision, machine_id, hoop_id, stats, qc) ON vyra.project_exports TO vyra_app;
GRANT SELECT ON vyra.project_files TO vyra_app;
GRANT INSERT (project_id, file_id, role) ON vyra.project_files TO vyra_app;
GRANT SELECT ON vyra.thread_charts TO vyra_app;
GRANT INSERT (owner_id, brand, product, status, source, source_url, entries) ON vyra.thread_charts TO vyra_app;
GRANT DELETE ON vyra.thread_charts TO vyra_app;
GRANT SELECT ON vyra.schema_migrations TO vyra_app;
GRANT USAGE ON SEQUENCE vyra.email_outbox_id_seq, vyra.audit_log_id_seq, vyra.project_versions_id_seq, vyra.user_recovery_codes_id_seq TO vyra_app;

-- 4. vyra_system : authentification, limitation de débit (aucun utilisateur connecté). Aucun accès au Studio.
--    vyra_app, second bénéficiaire : TRANSITION jusqu'au lot H3.
GRANT SELECT (id, email, password_hash, display_name, email_verified_at, locale, theme, preferences, status, created_at,
              failed_logins, locked_until, totp_secret_enc, totp_enabled_at, totp_last_step) ON vyra.users TO vyra_system, vyra_app;
GRANT INSERT (email, password_hash, display_name, locale) ON vyra.users TO vyra_system, vyra_app;
GRANT UPDATE (password_hash, display_name, locale, email_verified_at, failed_logins, locked_until, totp_last_step, updated_at) ON vyra.users TO vyra_system, vyra_app;
GRANT SELECT (user_id, role) ON vyra.user_roles TO vyra_system, vyra_app;
GRANT SELECT ON vyra.sessions TO vyra_system, vyra_app;
GRANT INSERT (token_hash, user_id, expires_at, ip, user_agent) ON vyra.sessions TO vyra_system, vyra_app;
GRANT UPDATE (last_seen_at, expires_at) ON vyra.sessions TO vyra_system, vyra_app;
GRANT DELETE ON vyra.sessions TO vyra_system, vyra_app;
GRANT SELECT ON vyra.auth_tokens TO vyra_system, vyra_app;
GRANT INSERT (token_hash, user_id, purpose, expires_at) ON vyra.auth_tokens TO vyra_system, vyra_app;
GRANT UPDATE (used_at) ON vyra.auth_tokens TO vyra_system, vyra_app;
GRANT SELECT ON vyra.mfa_challenges TO vyra_system, vyra_app;
GRANT INSERT (token_hash, user_id, expires_at) ON vyra.mfa_challenges TO vyra_system, vyra_app;
GRANT UPDATE (attempts) ON vyra.mfa_challenges TO vyra_system, vyra_app;
GRANT DELETE ON vyra.mfa_challenges TO vyra_system, vyra_app;
GRANT SELECT (id, user_id, code_hash, used_at) ON vyra.user_recovery_codes TO vyra_system, vyra_app;
GRANT UPDATE (used_at) ON vyra.user_recovery_codes TO vyra_system, vyra_app;
GRANT INSERT (to_email, template, subject, body_text, dedupe_key) ON vyra.email_outbox TO vyra_system, vyra_app;
GRANT INSERT (actor_id, action, subject, ip, details) ON vyra.audit_log TO vyra_system, vyra_app;
GRANT SELECT, INSERT, DELETE ON vyra.auth_throttle TO vyra_system, vyra_app;
GRANT UPDATE (failures, window_start, locked_until) ON vyra.auth_throttle TO vyra_system, vyra_app;
GRANT SELECT, INSERT ON vyra.rate_limits TO vyra_system, vyra_app;
GRANT UPDATE (count, reset_at) ON vyra.rate_limits TO vyra_system, vyra_app;
GRANT USAGE ON SEQUENCE vyra.email_outbox_id_seq, vyra.audit_log_id_seq TO vyra_system, vyra_app;

-- 5. vyra_worker : purges, envoi des e-mails, réanalyse antivirus, santé et métriques.
--    vyra_app, second bénéficiaire : TRANSITION jusqu'au lot H3.
GRANT SELECT (id, email_verified_at, created_at) ON vyra.users TO vyra_worker, vyra_app;
GRANT DELETE ON vyra.users TO vyra_worker, vyra_app;
GRANT SELECT (owner_id) ON vyra.projects TO vyra_worker, vyra_app;
GRANT SELECT (expires_at) ON vyra.sessions TO vyra_worker, vyra_app;
GRANT DELETE ON vyra.sessions TO vyra_worker, vyra_app;
GRANT SELECT (expires_at) ON vyra.auth_tokens TO vyra_worker, vyra_app;
GRANT DELETE ON vyra.auth_tokens TO vyra_worker, vyra_app;
GRANT SELECT (expires_at) ON vyra.mfa_challenges TO vyra_worker, vyra_app;
GRANT DELETE ON vyra.mfa_challenges TO vyra_worker, vyra_app;
GRANT SELECT ON vyra.email_outbox TO vyra_worker, vyra_app;
GRANT UPDATE (claimed_until, attempts, sent_at, last_error) ON vyra.email_outbox TO vyra_worker, vyra_app;
GRANT DELETE ON vyra.email_outbox TO vyra_worker, vyra_app;
GRANT SELECT ON vyra.files TO vyra_worker, vyra_app;
GRANT UPDATE (storage_key, scan_status, scan_detail, scan_engine, scanned_at, deleted_at) ON vyra.files TO vyra_worker, vyra_app;
GRANT INSERT (actor_id, action, subject, ip, details) ON vyra.audit_log TO vyra_worker, vyra_app;
GRANT SELECT (window_start, locked_until) ON vyra.auth_throttle TO vyra_worker, vyra_app;
GRANT DELETE ON vyra.auth_throttle TO vyra_worker, vyra_app;
GRANT SELECT (reset_at) ON vyra.rate_limits TO vyra_worker, vyra_app;
GRANT DELETE ON vyra.rate_limits TO vyra_worker, vyra_app;
GRANT SELECT ON vyra.schema_migrations TO vyra_worker, vyra_app;
GRANT USAGE ON SEQUENCE vyra.audit_log_id_seq TO vyra_worker, vyra_app;
