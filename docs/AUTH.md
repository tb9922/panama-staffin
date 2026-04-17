# Authentication And Authorization

This note reflects the current auth and session hardening baseline. For the
broader platform summary, see
[HARDENING_SUMMARY_2026-03-29.md](HARDENING_SUMMARY_2026-03-29.md).

## Overview

Panama Staffing supports two transport modes for the same JWT-based auth model:

- browser auth using HttpOnly cookies plus a CSRF header
- API auth using `Authorization: Bearer <token>`

## Browser Flow

```text
POST /api/login { username, password }
  -> 200 OK
  -> Set-Cookie: panama_token (HttpOnly)
  -> Set-Cookie: panama_csrf (readable by frontend)

Subsequent mutating requests:
  cookie sent automatically
  frontend also sends X-CSRF-Token header

POST /api/login/logout
  -> clears auth cookies
```

### Cookies

| Cookie | HttpOnly | SameSite | Path | MaxAge | Purpose |
|--------|----------|----------|------|--------|---------|
| `panama_token` | Yes | Lax | `/api` | 4 hours by default | JWT auth token |
| `panama_csrf` | No | Strict | `/api` | 4 hours by default | double-submit CSRF token |

JWT expiry is controlled by `JWT_EXPIRES_IN` and defaults to `4h`.

### CSRF Protection

Mutating requests from cookie-authenticated users must include:

- `X-CSRF-Token` with the same value as the `panama_csrf` cookie

Current hardening details:

- safe methods (`GET`, `HEAD`, `OPTIONS`) are exempt
- bearer-token requests are exempt
- comparison is byte-safe for multi-byte UTF-8 values, so crafted header-length
  edge cases return `403` instead of `500`

## API Flow

```text
POST /api/login { username, password }
  -> 200 OK { token, username, role }

Subsequent requests:
  Authorization: Bearer <token>
```

No CSRF header is required for bearer-token requests.

## JWT Payload

```json
{
  "username": "admin",
  "role": "admin",
  "is_platform_admin": true,
  "jti": "unique-token-id",
  "iat": 1709913600,
  "exp": 1709928000
}
```

- `role` is the legacy global role field
- real app permissions are resolved per home using `req.homeRole`
- `is_platform_admin` allows platform-wide administration
- `jti` is used for deny-list revocation

## Session And Revocation Model

- revoked tokens are persisted in `token_denylist`
- password changes and resets invalidate older tokens via `session_version`
- role changes revoke existing tokens
- logout is fail-closed when token revocation cannot be persisted
- auth dependency failures now return `503` instead of forcing a false logout

## Account Lockout

- threshold: 5 consecutive failed logins
- lock duration: 30 minutes
- storage: `failed_login_count` and `locked_until` on `users`
- invalid username, wrong password, and inactive-user paths return the same
  generic `401 Invalid credentials` response

## Rate Limiting

- login endpoint: 30 attempts per 15-minute window per IP+username
- test environment uses a much higher ceiling to avoid suite interference
- failure response: `429 Too Many Requests`

## Authorization Middleware

| Middleware | Purpose |
|-----------|---------|
| `requireAuth` | validates JWT, deny-list, `session_version`, and CSRF |
| `requireAdmin` | checks admin privilege |
| `requirePlatformAdmin` | checks platform-admin privilege |
| `requireHomeAccess` | resolves `req.home`, `req.homeRole`, and `req.staffId` |
| `requireModule(moduleId, level)` | checks per-home module read/write level |
| `requireHomeManager` | restricts home-level user management actions |

Additional current behavior:

- the authenticated DB user is cached on the request and reused downstream
- inactive-user checks are enforced in the auth path, not just at login time
- own-data roles are blocked from manager-only routes where required

## Per-Home RBAC

Each user has a per-home role in `user_home_roles`. Roles are defined in
`shared/roles.js` and currently cover 8 roles across 10 modules.

Platform admins bypass per-home module checks. Everyone else is evaluated
through `requireHomeAccess` and `requireModule`.

## Security Properties

- HttpOnly auth cookie limits token exposure to XSS
- double-submit CSRF protection is enforced on cookie auth
- passwords are bcrypt-hashed and never logged
- `JWT_SECRET` is required at startup
- DB SSL is enabled by default unless explicitly disabled
