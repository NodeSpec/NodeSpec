# Deployment Guide for NodeSpec.io

## Production URL

**https://nodespec.io** (hosted on Netlify)

## Current Status

**Pre-Launch Mode** - Showing countdown landing page with email registration

## Routing Structure

The application uses React Router with the following routes:

### Public Routes
- **`/`** - Landing page (countdown or auth, based on `VITE_LAUNCH_MODE`)
- **`/admin`** - Admin login page (always shows authentication form)

### Protected Routes
- **`/app`** - Main application (requires authentication)

## Environment Configuration

### Environment Variables

Set these in Netlify's environment settings:

```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://komnpkjlvgfworfbdrya.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>

# Launch Mode (controls which landing page is shown)
VITE_LAUNCH_MODE=pre-launch    # Shows countdown page
# VITE_LAUNCH_MODE=launched    # Shows auth landing page
```

### Supabase Function Secrets

Set in Supabase dashboard → Edge Functions → Secrets (or `supabase secrets set`):

```bash
# P0-1 (crypto envelope v2): dedicated secret for encrypting stored customer secrets —
# AI provider keys (user_api_keys) and git tokens (git_integrations). Generate once
# (e.g. `openssl rand -base64 48`), set it, and NEVER rotate it casually: existing v2
# envelopes are only decryptable with the secret that wrote them.
ENCRYPTION_SECRET=<long-random-string>
```

Rollout order for the v2 envelope:
1. Set `ENCRYPTION_SECRET` (above) — until it is set, functions keep writing the legacy
   format and log a warning.
2. Deploy the updated functions. New writes become `v2:`; existing values re-encrypt
   lazily on next successful use.
3. Optionally run the one-shot batch to finish the migration immediately: invoke the
   `admin-reencrypt-secrets` function with an admin user's JWT — it upgrades every
   remaining v1/plaintext row in both tables and reports per-table counts. Rows that
   fail to decrypt are left untouched and listed; those owners must re-save that key
   or token.

### Netlify Configuration

The `netlify.toml` file configures:
- Build command: `npm run build`
- Publish directory: `dist`
- SPA redirects for React Router
- Default environment variables

## Pre-Launch Access

While in pre-launch mode:
- **Public visitors** see countdown timer at `/`
- **Site admins** can login at `/admin`
- After login, admins are redirected to `/app`

## Launch Day Checklist

When ready to launch:

1. **Update Environment Variable in Netlify:**
   - Navigate to Site Settings → Environment Variables
   - Change `VITE_LAUNCH_MODE` from `pre-launch` to `launched`

2. **Trigger a Redeploy:**
   - Go to Deploys tab
   - Click "Trigger deploy" → "Deploy site"

3. **Verify the Change:**
   - Visit https://nodespec.io
   - Confirm the authentication landing page is now showing
   - Test both signup and login flows

4. **Notify Registered Users:**
   - Export emails from `launch_registrations` table
   - Send launch announcement emails
   - Mark users as notified in database

## Database Access

### Launch Registrations

To view registered users:
```sql
SELECT email, registered_at
FROM launch_registrations
ORDER BY registered_at DESC;
```

To export for email notifications:
```sql
SELECT email
FROM launch_registrations
WHERE notified = false
ORDER BY registered_at ASC;
```

After sending notifications:
```sql
UPDATE launch_registrations
SET notified = true
WHERE notified = false;
```

## OAuth Configuration

Update redirect URLs in OAuth provider settings:

### Google OAuth
- Authorized redirect URI: `https://nodespec.io/app`

### Apple OAuth
- Return URL: `https://nodespec.io/app`

## Troubleshooting

### Users Can't Access Application
- Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set
- Check Supabase RLS policies are configured correctly
- Verify OAuth redirect URLs are correct

### Wrong Landing Page Showing
- Check `VITE_LAUNCH_MODE` environment variable
- Verify the variable was set before the build
- Trigger a new deploy if changed after last build

### Routing Issues (404 Errors)
- Verify `_redirects` file exists in `dist` folder
- Check Netlify deployment logs for redirect configuration
- Ensure `netlify.toml` is in project root

## Build and Deploy

### Local Build
```bash
npm install
npm run build
```

### Deploy to Netlify
Either:
- **Push to Git:** Automatic deployment on push to main branch
- **Manual Deploy:** Use Netlify CLI or drag dist folder to Netlify dashboard

## Support

For additional information, see:
- [README.md](./README.md) - Project overview and quick start
- [SPECIFICATION.md](./SPECIFICATION.md) - Complete technical specification
