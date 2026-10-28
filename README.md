# Wifey & Hubby — Cloud + Web Push integration foundation

This project is based on **Version 25 iPhone Calendar Fix**, with existing screens, layouts, artwork, habit lists, chore lists, and other visual elements preserved. This package adds an installable PWA manifest, a real service worker for Web Push, a cloud sign-in UI, Supabase data-sync integration, a database migration, and a scheduled server-side push sender.

**LIVE BACKEND CONFIGURED, DEVICE TEST PENDING.** The dedicated Supabase project is active. Its secure tables, reminder Edge Function and one-minute pg_cron trigger have been deployed and tested with an HTTP 200 response. The public cloud configuration is filled in. To activate sign-in and push on the phone, publish **all site files** together (especially updated `index.html`, `cloud.js`, `cloud-config.js`, `sw.js` and manifest), then sign in and grant push permission on each Home Screen-installed iPhone. Actual iOS Lock Screen delivery has not been physically verified. Do not rely on it for critical appointments until the device test passes.

## Recommended organization

Use the **same Supabase dashboard login** as your existing Closet app, but create a **dedicated, separate project** named `Wifey & Hubby`. Its keys, tables, storage, auth users, and server secrets remain separate from Closet. Creating an independent Supabase project may have a cost; explicitly confirm the organization and any quoted cost before creating it. Supabase projects have distinct end-user Auth databases; using the same dashboard account does not automatically establish unified end-user SSO across projects.

## Setup (do not commit secrets to GitHub)

1. **Completed:** Separate Wifey & Hubby Supabase project and secure RLS tables created. Do NOT run the old migration again in the existing project; it is a provisioning reference only.
2. In the new project, configure **Authentication > URL Configuration** for your actual HTTPS GitHub Pages website; configure email confirmation and allowed redirect URLs before testing sign-up.
3. **Completed:** `cloud-config.js` contains the dedicated project URL, publishable key, and public VAPID key. No server-side secrets are in the package.
4. **Completed:** Web Push VAPID key pair generated; private key and scheduling token stored in Supabase Vault. Do not regenerate unless changing the push setup.
5. **Completed:** Real `send-reminders` Edge Function deployed, authenticating requests against the private scheduling token stored in Supabase Vault. The local source file is a *pre-deployment reference*; the active deployed version retrieves its credentials through the restricted `wh_server_push_secrets()` RPC.
6. **Completed:** pg_cron and pg_net enabled, the job `wh-reminders-every-minute` installed. A direct authenticated test returned HTTP 200 (`checked: 0, sent: 0, failed: 0`) before any phone subscribed.
7. Commit `index.html`, `cloud.js`, `cloud-config.js`, `manifest.webmanifest`, `sw.js`, and the `assets/` directory to the GitHub Pages site. Keep the `supabase/` folder in the GitHub repo for repeatable backend deployment (without secret values). Do not deploy from a local `file://` path.
8. On each iPhone: open the GitHub Pages URL, choose **Share → Add to Home Screen**, launch the installed Wifey & Hubby app, sign into the **same Wifey & Hubby account** on both phones, and turn **Notifications** on in Settings. Allow iOS notification permission on each device. If browser is in regular Safari tab, Web Push will not work on iPhone.
9. Create a calendar test event 5–10 minutes in the future and set a reminder for 1 minute before. Lock both phones and verify that each phone receives it. Confirm in Supabase Edge logs and table `wh_push_deliveries` that each subscription received a delivery claim. Confirm notification tapping opens the app. Repeat tests for repeating events, canceled events, iPhone restart, and network recovery.

## Example server-side cron setup (already installed — do not duplicate)

First enable extensions `pg_cron` and `pg_net` in your Supabase dashboard. In SQL editor, insert secrets privately (replace placeholders):

```sql
select vault.create_secret('https://NEW-PROJECT.supabase.co', 'wh_project_url');
select vault.create_secret('A-LONG-RANDOM-SERVER-SECRET', 'wh_cron_secret');

select cron.schedule(
  'wh-calendar-push-every-minute', '* * * * *',
  $$ select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='wh_project_url') || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='wh_cron_secret')
    ),
    body := '{}'::jsonb
  ); $$
);
```

## Existing app data

The app remains local-first until sign-in and the updated HTML is deployed. The first connected device uploads its already-saved sections if the cloud is empty. If cloud data already exists, the second device gets a **confirmation prompt** before importing it, so cloud data isn't accidentally overwritten. Account sign-in after importing reloads the app to refresh internal data. All app updates continue to be written to localStorage and are queued for Supabase. Offline updates are retained *during the current app session* for retry; the code still needs a full production-grade multi-device conflict resolver and durable offline change queue before promising zero data loss under simultaneous edits.

## Limitations and important cautions

* This is **real Web Push**, not an in-page timer, but deployment and device permission are mandatory. The service worker only handles push and doesn't cache/alter the existing visuals.
* iPhone lock screen and app-closed delivery are supported on iOS 16.4+ for an installed Home Screen PWA. Device fully powered off, offline, Focus restrictions, permission denial, push service outages, and TTL expiration prevent guaranteed instant delivery. Critical appointments should also have another reminder method until testing is complete.
* Sound Effects control and existing 3 a.m. resets are left unchanged in this foundation. Further sync and reset tests are required for reliable behavior on both devices.
* The server uses a simple at-most-once claim with retries for transient send errors. More sophisticated server observability and conflict handling should be added before relying on the application for critical appointments.
* Push is scheduled using each subscribed phone's stored time zone. This works naturally if both phones share a time zone. Supporting calendar events with a fixed event time zone across travel will require storing the event time zone per event.

## Files

`index.html` preserved visual app; `cloud.js` authentication, sync and push subscription; `cloud-config.js` public config only; `manifest.webmanifest` PWA identity; `sw.js` notification handler; `assets/icon-*` derived from your supplied tulip sticker; `supabase/migrations/…` dedicated database schema and row-level security; `supabase/functions/send-reminders` scheduled Web Push sender.
