# Auth CE/EE Design

**Date:** 2026-04-30
**Branch:** move-frontend
**Status:** Approved

---

## Overview

Implement authentication for both CE (Community Edition) and EE (Enterprise Edition). CE uses email/password with a server-signed JWT. EE adds Supabase (email/password) and Keycloak (SSO) as additional identity providers. In all cases the backend performs the final validation and issues a single consistent httpOnly cookie — the Next.js middleware only ever reads that one cookie format.

---

## Auth Flows

### CE

1. User submits email + password on `/login`
2. Client POSTs to `POST /auth/login`
3. Server validates credentials against `users` table (bcrypt)
4. Server issues `Set-Cookie: auth_token=<signed JWT>; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`
5. Next.js middleware reads `auth_token` cookie — if present, allow; if missing, redirect to `/login`

### EE — Supabase

1. User clicks "Continue with Supabase" on `/login`
2. Client calls `supabase.auth.signInWithPassword()` — Supabase returns its own JWT
3. Client POSTs `{ provider: "supabase", token: <supabase_jwt> }` to `POST /auth/token-exchange`
4. Server validates Supabase JWT using Supabase JWKS endpoint
5. Server upserts user in `users` table (creates on first login with `provider=supabase`, `provider_user_id`)
6. Server issues `auth_token` cookie (same format as CE)

### EE — Keycloak SSO

1. User clicks "Sign in with SSO" on `/login`
2. Client initiates PKCE flow — redirects to Keycloak
3. Keycloak redirects back to `/login?code=...`
4. Client exchanges code for Keycloak access token
5. Client POSTs `{ provider: "keycloak", token: <keycloak_token> }` to `POST /auth/token-exchange`
6. Server validates Keycloak token using Keycloak JWKS endpoint
7. Server upserts user in `users` table (`provider=keycloak`, `provider_user_id`)
8. Server issues `auth_token` cookie

---

## Cookie Spec

| Property | Value |
|---|---|
| Name | `auth_token` |
| HttpOnly | true |
| Secure | true (production), false (development) |
| SameSite | Lax |
| Max-Age | 604800 (7 days) |
| Path | `/` |

---

## JWT Payload

```json
{
  "sub": "<user_uuid>",
  "email": "user@example.com",
  "exp": 1234567890
}
```

Secret: `SECRET_KEY` env var (already exists in docker-compose for both editions).

---

## Backend Changes

### `server/src/modules/authentication/`

**`schemas.py`** — Pydantic models:
- `LoginRequest`: `email`, `password`
- `RegisterRequest`: `email`, `username`, `password`
- `UserResponse`: `id`, `email`, `username`, `is_active`
- `TokenExchangeRequest` (EE): `provider` (`supabase` | `keycloak`), `token`

**`service.py`** — CE auth logic:
- `hash_password(plain)` → bcrypt hash
- `verify_password(plain, hashed)` → bool
- `create_access_token(user_id, email)` → signed JWT string
- `verify_access_token(token)` → payload dict or raise
- `authenticate_user(db, email, password)` → User or None
- `register_user(db, email, username, password)` → User

**`router.py`** — CE endpoints (replaces current stub):
- `POST /auth/login` → set cookie, return `UserResponse`
- `POST /auth/register` → set cookie, return `UserResponse`
- `POST /auth/logout` → clear cookie
- `GET /auth/me` → return current user (uses `get_current_user` dep)

**`deps/auth_bearer.py`** — FastAPI dependency:
- Reads `auth_token` from request cookies
- Verifies JWT signature
- Returns user payload dict; raises `401` if missing or invalid

### `server/ee/modules/authentication/` (EE only)

**`token_exchange.py`**:
- `validate_supabase_token(token)` → fetches Supabase JWKS, verifies, returns claims
- `validate_keycloak_token(token)` → fetches Keycloak JWKS, verifies, returns claims
- `upsert_provider_user(db, provider, provider_user_id, email)` → User

**`router.py`** (EE addition):
- `POST /auth/token-exchange` → validates provider token, upserts user, sets cookie

### `users` table — new columns (migration required)

| Column | Type | Notes |
|---|---|---|
| `hashed_password` | `VARCHAR` nullable | null for SSO-only users |
| `is_active` | `BOOLEAN` default true | |
| `is_verified` | `BOOLEAN` default false | |
| `provider` | `VARCHAR(20)` nullable | `ce`, `supabase`, `keycloak` |
| `provider_user_id` | `VARCHAR` nullable | external provider's user ID |

---

## Frontend Changes

### Auth abstraction

**`client/src/auth/types.ts`** — shared interface:
```typescript
interface AuthActions {
  login(email: string, password: string): Promise<void>
  signup(email: string, username: string, password: string): Promise<SignupResult>
  logout(): Promise<void>
}
```

**`client/src/auth/authProvider.ts`** — edition factory:
```typescript
// Returns CE or EE actions based on NEXT_PUBLIC_EDITION build var
export function getAuthActions(): AuthActions
```

**`client/src/auth/ce/authActions.ts`** — CE implementation:
- `login`: `POST /auth/login` with credentials, cookie is set by server
- `signup`: `POST /auth/register`
- `logout`: `POST /auth/logout`

**`client/ee/src/auth/authActions.ts`** — EE implementation:
- `login`: Supabase `signInWithPassword` → `POST /auth/token-exchange`
- `loginWithKeycloak`: PKCE redirect to Keycloak
- `handleKeycloakCallback(code)`: exchange code → `POST /auth/token-exchange`
- `signup`: Supabase `signUp` → `POST /auth/token-exchange`
- `logout`: Supabase `signOut` + `POST /auth/logout`

**`client/ee/src/auth/keycloak.ts`** — PKCE helper:
- `buildAuthorizationUrl()` → Keycloak redirect URL with PKCE challenge
- `exchangeCodeForToken(code)` → Keycloak access token string

### `useAuthStore` refactor

Remove all `@supabase/supabase-js` types (`Session`, `User`). State:
```typescript
interface AuthState {
  user: { id: string; email: string; username?: string } | null
  isAuthenticated: boolean
  authLoading: boolean
  actionLoading: boolean
  loginError: string | null
}
```
`init()` calls `GET /auth/me` on mount to rehydrate from cookie.

### Login page

CE (`NEXT_PUBLIC_EDITION=community`): existing email/password form, unchanged UX.

EE (`NEXT_PUBLIC_EDITION=enterprise`): same form plus:
- "Continue with Supabase" button (calls EE `login`)
- "Sign in with SSO" button (calls `loginWithKeycloak` → redirect)
- Keycloak callback handled on page mount if `?code=` query param present

### Middleware (`client/middleware.ts`)

Replaces current CORS-only version:
```
Protected: all routes
Public: /login, /logout, /_next/*, /public/*, /api/auth/*
Logic: if auth_token cookie missing → redirect /login
       if auth_token cookie present → NextResponse.next()
```

No JWT verification in middleware (edge runtime constraint) — just cookie presence check. Full verification happens in FastAPI on every API call via `get_current_user` dependency.

---

## Environment Variables

### CE additions (docker-compose.ce.yml / .env)
```
SECRET_KEY=<required, already exists>
JWT_ALGORITHM=HS256
JWT_EXPIRY_SECONDS=604800
```

### EE additions (docker-compose.ee.yml / .env)
```
SECRET_KEY=<required, already exists>
JWT_ALGORITHM=HS256
JWT_EXPIRY_SECONDS=604800
SUPABASE_URL=<supabase project url>
SUPABASE_SERVICE_ROLE_KEY=<for server-side validation>
KEYCLOAK_URL=<keycloak base url>
KEYCLOAK_REALM=<realm name>
KEYCLOAK_CLIENT_ID=<client id>
NEXT_PUBLIC_SUPABASE_URL=<already in compose>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<already in compose>
NEXT_PUBLIC_KEYCLOAK_URL=<keycloak base url>
NEXT_PUBLIC_KEYCLOAK_REALM=<realm name>
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=<client id>
```

---

## Migration

A new CE migration (`alembic revision --autogenerate -m "add_auth_columns_to_users" --head ce@head`) adds the new columns to the `users` table.

---

## What Is Not In Scope

- Password reset / forgot password flow (stubbed on login page, implemented later)
- Email verification (column exists, not enforced in this phase)
- OAuth social login beyond Supabase/Keycloak
- Token refresh (7-day expiry is sufficient for now; add refresh tokens later)
