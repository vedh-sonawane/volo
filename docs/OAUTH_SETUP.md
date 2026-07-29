# Connecting Google & GitHub (OAuth setup)

Volo's OAuth framework is built and tested. To make a provider actually
connectable, register an OAuth app with that provider and paste its credentials
into your `.env`. Until you do, Volo honestly shows "OAuth not configured" — it
never pretends a service is connected.

**Redirect / callback URL** (used by all three):
```
{YOUR_ORIGIN}/api/auth/oauth/{provider}/callback
```
- Local dev: `http://localhost:3000/api/auth/oauth/google/callback` (and `/github/…`)
- Production: `https://yourdomain.com/api/auth/oauth/google/callback`

After editing `.env`, **restart** (`npm run dev`) — env vars load at process start.

---

## 1) Google

1. Go to **console.cloud.google.com** → create/select a project.
2. **APIs & Services → OAuth consent screen**: choose *External*, fill app name +
   your email. Under *Test users*, add your own Google address (an unverified app
   can only be used by listed test users — fine for development).
3. **APIs & Services → Library**: enable the APIs you want Volo to use — start with
   **Gmail API** (for sending). (Enable **Google Calendar API**, **Drive API**, etc.
   later as those actions ship.)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   *Web application*. Add the **Authorized redirect URI**:
   `http://localhost:3000/api/auth/oauth/google/callback`
5. Copy the **Client ID** and **Client secret** into `.env`:
   ```
   GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=xxxx
   ```
6. Restart. In **Settings → Integrations**, click **Connect** on Gmail, approve the
   consent screen. Volo requests only `gmail.send` (least privilege). Once connected,
   `send_email` is executed through your real Gmail account (still approval-gated).

## 2) GitHub

1. Go to **github.com → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. **Authorization callback URL**:
   `http://localhost:3000/api/auth/oauth/github/callback`
3. Generate a **client secret**. Put both into `.env`:
   ```
   GITHUB_CLIENT_ID=xxxx
   GITHUB_CLIENT_SECRET=xxxx
   ```
4. Restart → Settings → Integrations → Connect GitHub. (GitHub OAuth-app tokens
   don't expire and have no refresh token — that's expected.)

---

## Notes
- **Least privilege:** Volo requests only the scope group you click to connect.
- **Security:** client id/secret are deployment-level (env, server-only). Per-user
  access/refresh tokens are AES-256 encrypted at rest, never sent to the browser or
  the AI model.
- **Production:** use HTTPS + your real domain in the redirect URIs, and consider a
  KMS instead of the local `.data/volo.key`.
- **Sign in with X** also works via the same framework
  (`/api/auth/oauth/{provider}/start?mode=login`).
