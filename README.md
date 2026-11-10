# RememberMe

RememberMe is an existing static PWA with Vercel serverless API routes and Supabase Auth/Postgres. People sign up, sign in, and recover accounts using a username, password, and one-time recovery code. Email addresses and external login providers are not part of the user-facing flow. Supabase Auth uses a random, non-routable synthetic address created on the server because its password API requires an email identifier.

## Supabase setup

1. In the existing Supabase project, open **SQL Editor** and run the existing migration files in numeric order:
   - [`202611090001_rememberme_auth.sql`](./supabase/migrations/202611090001_rememberme_auth.sql) creates the profiles, occasions, RLS policies, and rate-limit RPC.
   - [`202611090002_auth_rate_limit_rpc.sql`](./supabase/migrations/202611090002_auth_rate_limit_rpc.sql) repairs/grants the rate-limit RPC and reloads PostgREST's schema cache.
2. Keep Supabase Auth's email/password provider enabled internally. No SMTP, email confirmation, Google provider, OAuth client, or email redirect configuration is needed for this username flow. The server creates users as already confirmed.
3. In Vercel, set these server-side environment variables for Development, Preview, and Production as appropriate:
   - `SUPABASE_URL`: the existing project's URL.
   - `SUPABASE_ANON_KEY`: the project's anon/public key; only server functions use it.
   - `SUPABASE_SERVICE_ROLE_KEY`: the service-role key. Store only in Vercel's encrypted environment settings; never expose it to browser code.
   - `RATE_LIMIT_SECRET`: a randomly generated secret with at least 32 bytes, used to HMAC rate-limit keys.
4. Set the Vercel project root to `RememberMe` if it is not already set, then redeploy.
5. For local development, copy `.env.example` to `.env.local`, fill it from the existing Supabase project, run `npm install`, and start with `npx vercel dev`. Never commit `.env.local`.

No new database table is required for this change. The existing profile username unique constraint and occasion schema are reused; the migrations above must already be applied to the Supabase project. Do not rerun modified SQL manually as a substitute for checking migration status.

## Authentication and privacy

- The browser sends username/password only to same-origin Vercel routes. The server resolves the username to the Supabase Auth account and calls Supabase Auth for password verification.
- Passwords are stored and verified by Supabase Auth's password hashing. Recovery codes are high-entropy, displayed once, and stored only as salted scrypt hashes.
- Session tokens are held in `HttpOnly`, `SameSite=Lax` cookies. Service-role credentials remain server-side.
- Login and recovery errors do not confirm whether an account exists. Signup rate limits attempts, while the database unique constraint safely rejects duplicate usernames, including concurrent registrations.
- Writes require the same origin. Auth attempts use the database-backed rate limiter.

## Cross-device data

The app's current personal data model is `public.occasions` (birthdays, anniversaries, events, notes, and repeat settings). The browser fetches it after session restoration or login and saves create, edit, delete, and import operations through `/api/occasions`. Each row is assigned the authenticated Supabase user ID; the user's session and Postgres RLS restrict reads and writes to that user. The app does not use browser storage as the permanent cloud copy.

Older occasions in `localStorage` are retained until the signed-in user chooses **Import them into this account**. Import is idempotent, and browser data is removed only after the server confirms the import. Other devices load the account's Supabase occasions after login or page refresh.

## Verification

Run `npm run check` for JavaScript syntax checks. This does not verify live Supabase configuration or deployed cookies. After deployment, test registration, duplicate registration, correct/incorrect login, logout, recovery-code reset, refresh persistence, two-device occasion sync, RLS isolation with two users, and rate limiting.
