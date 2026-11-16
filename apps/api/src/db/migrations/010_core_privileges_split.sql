-- Socle H3 : fin de la transition du lot H2. L'API a désormais un pool par rôle (vyra_app, vyra_system,
-- vyra_worker) : vyra_app ne garde que les droits des requêtes faites pour l'utilisateur connecté
-- (bloc 3 de 009_core_privileges, à l'identique). Les droits de vyra_system et de vyra_worker ne changent pas.
--
-- Méthode : tout est retiré à vyra_app sur les tables et séquences du socle, puis ses droits propres sont
-- reposés. vyra_app perd ainsi, entre autres, l'accès aux défis de double authentification, aux compteurs
-- anti-force brute et de limitation de débit, à l'envoi des e-mails et aux purges.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'user_roles', 'sessions', 'auth_tokens', 'email_outbox', 'files', 'audit_log',
                           'projects', 'project_versions', 'project_exports', 'project_files',
                           'user_recovery_codes', 'mfa_challenges', 'thread_charts', 'auth_throttle', 'rate_limits',
                           'schema_migrations'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE vyra.%I FROM vyra_app', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['email_outbox_id_seq', 'audit_log_id_seq', 'project_versions_id_seq', 'user_recovery_codes_id_seq'] LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE vyra.%I FROM vyra_app', t);
  END LOOP;
END $$;

-- vyra_app : requêtes faites pour l'utilisateur connecté (matrice H2, §3.3).
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

-- Complément constaté au lot H3 (pools séparés) : INSERT … ON CONFLICT (dedupe_key) exige la lecture de la
-- colonne d'arbitrage. vyra_app l'avait jusqu'ici par les droits transitoires ; vyra_system ne l'avait pas.
GRANT SELECT (dedupe_key) ON vyra.email_outbox TO vyra_app, vyra_system;
