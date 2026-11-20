-- Roll back only the MFA-specific objects created by
-- 20261119_add_login_mfa.sql. This file is generated for manual review and must
-- never be run automatically against production.
-- IF EXISTS also permits cleanup if the forward migration stopped after creating
-- only one of these two MFA-specific tables.
DROP TABLE IF EXISTS login_mfa_rate_limits;
DROP TABLE IF EXISTS login_mfa_challenges;
