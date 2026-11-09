# RememberMe

RememberMe is a small, static PWA with Vercel serverless API routes and Supabase Auth/Postgres. The browser never receives a Supabase service-role key or stores an auth token in `localStorage`. API routes set `HttpOnly`, `SameSite=Lax` cookies; occasion rows are protected by database RLS.

## Set up the backend

1. Create a Supabase project. In **SQL Editor**, run the files in `supabase/migrations` in numeric order:
   - [`202611090001_rememberme_auth.sql`](./supabase/migrations/202611090001_rememberme_auth.sql) creates the account/profile, occasion, and rate-limit schema.
   - [`202611090002_auth_rate_limit_rpc.sql`](./supabase/migrations/202611090002_auth_rate_limit_rpc.sql) ensures the rate-limit RPC has the exact signature used by the API, grants execution only to `service_role`, and asks PostgREST to reload its schema cache.
2. In Vercel, set these **server-side environment variables** for every environment you use:
   - `SUPABASE_URL` — the project URL from Supabase API settings.
   - `SUPABASE_ANON_KEY` — the project's public/anon key. It is read only by server functions in this app.
   - `SUPABASE_SERVICE_ROLE_KEY` — the service-role key. Keep it only in Vercel's encrypted environment settings; never put it in frontend files.
   - `RATE_LIMIT_SECRET` — a random secret of at least 32 bytes, used to hash rate-limit identifiers. For example, generate one locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and paste the output directly into Vercel.
3. In Supabase **Authentication → URL Configuration**, set the Site URL to your deployed app origin and add `https://YOUR-APP-DOMAIN/api/auth/callback` to the allowed redirect URLs. Keep email confirmation enabled if you want email ownership verified.
4. For Google, enable the Google provider in Supabase **Authentication → Providers**. Add Supabase's displayed OAuth callback URL to the Google OAuth client's authorized redirect URIs, and enter the Google client ID/secret in Supabase only. Do not put the Google secret in this repository. Add your deployed app callback URL to Supabase's allowed redirect URLs.
5. If Vercel's project root is not already the `RememberMe` folder, set that folder as the project root so `/api` functions deploy alongside `index.html`. Add the environment variables to Vercel and redeploy.
6. For local development, copy `.env.example` to `.env.local`, fill it with values from your own Supabase project, install dependencies with `npm install`, then run `npx vercel dev`. Never commit `.env.local`.

The app intentionally does not include credentials. Until the migration is applied and the Vercel/Supabase settings above are configured, authentication and cloud occasions will report that the backend is unavailable.

## Accounts and privacy

- Email/password accounts use Supabase's email confirmation and reset-link flow.
- Username/password accounts use a random internal, non-routable email created by the server. Username lookup is private; the browser receives neither that address nor service credentials.
- A high-entropy recovery code is shown once at signup for recovery without email. Save it somewhere private. The server stores only a salted scrypt hash; it is not recoverable if lost.
- Username availability and authentication attempts are rate-limited with a database-backed counter. Vercel Functions validate request shape, enforce same-origin writes, and use Supabase Auth to validate credentials.
- If an API log reports that `public.consume_auth_rate_limit(p_bucket, p_limit, p_window_seconds)` is missing, verify both migrations have completed successfully. The repair migration recreates the function and reloads PostgREST's schema cache; if the cache is still stale, run `NOTIFY pgrst, 'reload schema';` in the Supabase SQL Editor.
- Google sign-in is completed by Supabase OAuth and the server callback.
- Occasion queries use the signed-in user's session and are additionally constrained by Postgres RLS. Hiding the dashboard is only a UI convenience, not the access-control boundary.
- The service worker caches static app assets only; it bypasses API routes and never caches private occasion responses.

Existing occasions saved by the old version remain in that browser until the signed-in user chooses **Import them into this account**. Imports are idempotent for each old record and the old browser copy is removed only after the server confirms the import.

## Check the code

Run `npm run check` for JavaScript syntax checks. A successful local syntax check does **not** verify the live Supabase project, OAuth provider configuration, RLS behavior, or deployed session cookies. Test those after completing setup, using two accounts to confirm occasion isolation.
