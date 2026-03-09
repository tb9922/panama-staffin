# Authentication & Authorization

## Overview

Panama Staffing uses dual-mode authentication: browser-based (HttpOnly cookies) and API-based (Bearer tokens). Both modes use the same JWT tokens; the difference is how the token is transported.

## Browser Flow (Frontend)

```
POST /api/login { username, password }
    ↓
200 OK + Set-Cookie: panama_token (HttpOnly) + panama_csrf (JS-readable)
    ↓
Subsequent requests: cookie sent automatically, frontend sends X-CSRF-Token header
    ↓
POST /api/login/logout → clears both cookies
```

### Cookies

| Cookie | HttpOnly | SameSite | Path | MaxAge | Purpose |
|--------|----------|----------|------|--------|---------|
| `panama_token` | Yes | Lax | `/api` | 4 hours | JWT auth token — immune to XSS (JS cannot read it) |
| `panama_csrf` | No | Strict | `/api` | 4 hours | CSRF double-submit token — JS reads this to send as header |

### CSRF Protection

Mutating requests (POST/PUT/DELETE) from cookie-authenticated users must include:
- `X-CSRF-Token` header with the value of the `panama_csrf` cookie

The server compares the cookie value to the header value. An attacker from another origin can cause the cookie to be sent (via a form POST) but cannot read its value (same-origin policy), so they cannot forge the header.

**Exempt:**
- GET/HEAD/OPTIONS requests (safe methods, must not mutate state)
- Requests using `Authorization: Bearer` header (API clients handle their own CSRF)

## API Flow (Integration / Machine-to-Machine)

```
POST /api/login { username, password }
    ↓
200 OK { token, username, role }
    ↓
Subsequent requests: Authorization: Bearer {token}
    ↓
No CSRF header required
```

The login response includes the JWT in the response body for API clients. Use the `Authorization: Bearer {token}` header on all subsequent requests.

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

- `role`: `"admin"` (read/write) or `"viewer"` (read-only)
- `is_platform_admin`: `true` for users who can manage homes and users across the platform
- `jti`: Unique token ID used for deny-list revocation
- Token expires after 4 hours

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/login` | None | Authenticate — returns token + sets cookies |
| POST | `/api/login/logout` | Required | Clear auth cookies |
| POST | `/api/login/revoke` | Admin | Revoke all tokens for a user |

## Account Lockout

- **Threshold:** 5 consecutive failed login attempts
- **Duration:** 30 minutes (automatic unlock)
- **Storage:** `failed_login_attempts` and `locked_until` columns on `users` table (migration 087)
- **No user enumeration:** Wrong password, deactivated user, and non-existent user all return the same `401 Invalid credentials` message

## Rate Limiting

- **Login endpoint:** 10 attempts per 15-minute window per IP
- **Disabled in test environment** (set to 1000 to avoid test interference)
- Returns `429 Too Many Requests` with message: "Too many login attempts — try again in 15 minutes"

## Token Deny List

- Revoked tokens are stored in an in-memory deny list
- Checked on every authenticated request via `isTokenDenied(decoded)`
- **Pruning:** Expired entries removed hourly via `setInterval`
- **Admin revocation:** `POST /api/login/revoke { username }` adds all tokens for that user to the deny list
- **Role changes:** Changing a user's role automatically revokes their existing tokens

## Authorization Middleware

| Middleware | Purpose | Error |
|-----------|---------|-------|
| `requireAuth` | Validates JWT, checks deny list, enforces CSRF | 401/403 |
| `requireAdmin` | Checks `role === 'admin'` | 403 |
| `requirePlatformAdmin` | Checks `role === 'admin'` AND `is_platform_admin === true` | 403 |
| `requireHomeAccess` | Validates `?home=` param, checks user has access to that home | 400/403/404 |

All middleware is defined in `middleware/auth.js`. `requireHomeAccess` must be used after `requireAuth` (it needs `req.user`).

## Security Properties

- **XSS-immune tokens:** HttpOnly cookie cannot be read by JavaScript
- **CSRF protection:** Double-submit cookie pattern with SameSite enforcement
- **No credential leakage:** Passwords hashed with bcrypt (cost 12), never logged
- **JWT_SECRET:** Minimum 32 characters, enforced at startup (`config.js`)
- **DB SSL:** Enabled by default, opt-out via `DB_SSL=false`
