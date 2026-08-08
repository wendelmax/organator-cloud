# Tenant MFA and Secure Login Design

## Goal

Make password and OIDC authentication honor tenant MFA policy without issuing a session before second-factor verification, while supporting one-time recovery codes, bounded lockout, and auditable policy changes.

## Decisions

- Tenant policy is persisted as a single `TenantSecurityPolicy` row with `mfaMode` (`optional`, `required_for_roles`, `required_for_all`) and JSON `requiredRoles`.
- Password login returns a short-lived opaque MFA challenge when policy requires MFA. The challenge token is stored only as a hash and expires after five minutes; no JWT is issued until verification succeeds.
- OIDC remains compatible with the existing bearer flow. Its callback resolves the local user and applies the same policy check; when MFA is required, the strategy returns a pending challenge identity and the API exposes a verification endpoint rather than treating the IdP token as sufficient.
- Ten recovery codes are generated during enrollment/re-enrollment, displayed once, and stored as salted bcrypt hashes in `MfaRecoveryCode`. A code is atomically consumed and cannot be reused.
- Invalid TOTP/recovery attempts update per-user counters. Five failures within fifteen minutes lock verification for fifteen minutes. Counters reset after success.
- Audited actions: `auth.mfa_challenge_created`, `auth.mfa_succeeded`, `auth.mfa_failed`, `auth.mfa_recovery_used`, `auth.mfa_policy_changed`, `auth.mfa_reenrolled`. Secrets, codes, challenge tokens, and passwords never enter audit changes.
- Schema rollout is additive and reversible: new nullable/defaulted columns and tables first; application reads old users as MFA-disabled/optional; rollback removes only the new objects after traffic is drained.

## API

- `POST /v1/auth/login`: preserves the existing success response when MFA is not required; otherwise returns `{ mfa_required: true, challenge_token, expires_at, user }` without `access_token`.
- `POST /v1/auth/mfa/verify`: accepts `{ challenge_token, code?, recovery_code? }`, returns the normal login token on success.
- `POST /v1/auth/mfa/recovery-codes`: authenticated, requires current TOTP or re-authentication, replaces codes and returns plaintext codes once.
- `GET /v1/auth/mfa/policy`: tenant admin/owner only.
- `PUT /v1/auth/mfa/policy`: tenant admin/owner only; validates mode and role list and records an audit event.

## Authorization and isolation

Policy reads always use the authenticated actor's tenant. Administrative policy writes reject cross-tenant user IDs and non-owner/admin roles. MFA verification resolves the challenge's user and tenant from the hashed opaque token, never from caller-supplied tenant data.

## Testing

Unit tests cover policy resolution, challenge expiry/one-time use, lockout, recovery-code hashing/consumption, authorization, and audit events. Controller/E2E tests prove that required-MFA users receive no JWT before verification, recovery codes are single-use, and OIDC/policy paths do not bypass tenant enforcement.
