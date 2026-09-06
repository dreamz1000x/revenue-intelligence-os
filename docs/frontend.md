# RIOS web dashboard

The bounded frontend lives in `web/` and uses Next.js 16, React 19, TypeScript,
and the Auth0 Next.js SDK. It is a server-rendered operational interface over
the Railway API, not a second business backend.

## Local configuration

Copy `web/.env.example` to ignored `web/.env.local`. Create a separate Auth0
Regular Web Application named `RIOS Web`; do not reuse the smoke-test Native
application.

Required variables:

| Variable | Sensitivity | Purpose |
| --- | --- | --- |
| `AUTH0_DOMAIN` | Identifier | Auth0 tenant domain without a scheme. |
| `AUTH0_CLIENT_ID` | Identifier | `RIOS Web` client ID. |
| `AUTH0_CLIENT_SECRET` | Secret | Regular Web Application client secret. |
| `AUTH0_SECRET` | Secret | 64-hex-character session encryption secret. |
| `AUTH0_AUDIENCE` | Identifier | `https://revenue-intelligence-api`. |
| `APP_BASE_URL` | Public configuration | Frontend origin; locally `http://localhost:3001`. |
| `RIOS_API_BASE_URL` | Server-only configuration | RIOS API origin; locally `http://localhost:3000`. |

Run `pnpm web:dev` from the repository root. The API remains on port 3000 and
the frontend uses port 3001. Never prefix these variables with `NEXT_PUBLIC_`.

## Auth0 application settings

Local settings:

- Allowed Callback URLs: `http://localhost:3001/auth/callback`
- Allowed Logout URLs: `http://localhost:3001`
- Allowed Web Origins: `http://localhost:3001`
- Application Login URI: `http://localhost:3001/auth/login`

Production settings replace the origin with
`https://<VERCEL_PRODUCTION_DOMAIN>`. Authorize the application to request the
existing RIOS API audience `https://revenue-intelligence-api`. The existing
Post-Login Action must continue adding the namespaced roles claim to access
tokens; the frontend does not require or assume that claim in the ID token.

## Security and roles

The browser receives an encrypted HTTP-only session cookie, not a RIOS access
token. Next.js obtains the token server-side and calls only explicit API paths.
`GET /me` returns the API-verified subject and supported roles. Viewer access is
read-only, operator/admin users see supported mutation forms, and Audit is
visible only to admins. Backend RBAC still enforces every request.

Server Actions generate a fresh UUID `Idempotency-Key` for each financial or
reconciliation command. They do not retry mutations. API failures map to a
small safe model and never log tokens or arbitrary backend responses.

## Deployment

Create a Vercel project rooted at `web/` and select Next.js. Use the committed
lockfile and standard `pnpm install` / `pnpm build` behavior. Configure all seven
variables above for Production and Preview as appropriate, then add the final
Vercel origin to the Auth0 callback, logout, web-origin, and login-URI allowlists.
No Vercel deployment or Auth0 application has been created by repository work.
