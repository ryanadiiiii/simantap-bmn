# SECURITY NOTES

- Jangan commit `.dev.vars`, `.clasp.json`, `.clasprc.json`, PIN, API secret, atau credential Google.
- `GAS_API_SECRET` hanya ada di Cloudflare Worker runtime dan Script Properties Apps Script.
- `ADMIN_SESSION_SECRET` hanya ada di Cloudflare Worker runtime.
- Worker melakukan whitelist action dan session check untuk action Administrator.
- Untuk penggunaan kantor, aktifkan Cloudflare Access pada custom domain/Worker setelah migrasi stabil.
