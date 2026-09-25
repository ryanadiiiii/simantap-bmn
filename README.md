# SIMANTAP BMN — Cloudflare Workers + Apps Script

Arsitektur tahap 1 yang mempertahankan logika aplikasi saat ini:

Browser -> Cloudflare Worker (`*.workers.dev`) -> Apps Script Web App -> Spreadsheet / Drive

Frontend tetap memakai source SIMANTAP BMN terbaru. `public/js/gas-shim.js` membuat API kompatibel dengan pola `google.script.run`, sehingga migrasi tidak perlu me-rewrite seluruh frontend sekaligus.

## 1. Persiapan lokal (Windows / PowerShell)

```powershell
cd E:\FLUTTER\simantap-bmn
npm install
npm run cf:login
npm run gas:login
```

Untuk development frontend/Worker:

```powershell
Copy-Item .dev.vars.example .dev.vars
# Edit .dev.vars setelah URL Apps Script dan secret sudah siap
npm run dev
```

Aplikasi lokal akan diberikan URL oleh Wrangler (umumnya `http://localhost:8787`). Perubahan file frontend/Worker akan terlihat tanpa proses copy-paste ke Apps Script.

## 2. Konfigurasi Apps Script

### 2.1 Hubungkan folder `gas` ke project Apps Script yang sekarang

Copy:

```text
.clasp.json.example -> .clasp.json
```

Isi `scriptId` dari Apps Script Project Settings.

Lalu cek:

```powershell
npm run gas:status
```

> Penting: `clasp push` mengganti seluruh source project Apps Script. Karena paket ini sudah membawa `gas/Code.gs`, `gas/Index.html`, dan `gas/appsscript.json`, backup project lama sebelum push pertama.

### 2.2 Buat Script Properties

Di Apps Script: **Project Settings -> Script Properties** tambahkan:

```text
PIN_ADMINISTRATOR = PIN administrator yang ingin dipakai
API_SHARED_SECRET = random secret 32 byte
```

Generate secret dari Node:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Simpan nilai `API_SHARED_SECRET`; nilai yang sama akan dimasukkan ke Cloudflare sebagai `GAS_API_SECRET`.

### 2.3 Push dan deploy backend

```powershell
npm run gas:push
```

Deploy Web App dari Apps Script dengan konfigurasi akun yang memang mempunyai akses Spreadsheet/Drive SIMANTAP BMN. Catat URL yang berakhiran `/exec` dan **Deployment ID**.

Untuk update backend berikutnya gunakan deployment ID yang sama:

```powershell
$env:GAS_DEPLOYMENT_ID="ISI_DEPLOYMENT_ID"
.\scripts\deploy-gas.ps1
```

Dengan deployment ID yang sama, URL `/exec` tetap sama.

## 3. Konfigurasi Cloudflare Worker

Login:

```powershell
npm run cf:login
```

Deploy awal:

```powershell
npm run deploy
```

Lalu masukkan tiga runtime secret:

```powershell
npx wrangler secret put GAS_WEBAPP_URL
npx wrangler secret put GAS_API_SECRET
npx wrangler secret put ADMIN_SESSION_SECRET
```

Isi:

- `GAS_WEBAPP_URL`: URL Apps Script Web App yang berakhiran `/exec`.
- `GAS_API_SECRET`: **sama persis** dengan `API_SHARED_SECRET` di Script Properties Apps Script.
- `ADMIN_SESSION_SECRET`: secret random baru, berbeda dari GAS API secret.

Generate `ADMIN_SESSION_SECRET`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Deploy lagi:

```powershell
npm run deploy
```

Tes:

```text
https://NAMA-WORKER.SUBDOMAIN.workers.dev/api/health
```

Harus mengembalikan JSON `ok: true` dan `backendConfigured: true`.

## 4. GitHub -> otomatis deploy setiap push

Setelah aplikasi lokal berhasil:

```powershell
git init
git add .
git commit -m "Initial SIMANTAP BMN Cloudflare"
git branch -M main
git remote add origin URL_REPOSITORY_GITHUB
git push -u origin main
```

Di Cloudflare Dashboard:

1. **Workers & Pages -> simantap-bmn -> Settings -> Builds**.
2. Connect repository GitHub.
3. Production branch: `main`.
4. Build command: kosong (project ini tidak memerlukan compile step).
5. Deploy command: `npx wrangler deploy`.
6. Pastikan runtime Variables & Secrets tetap berisi `GAS_WEBAPP_URL`, `GAS_API_SECRET`, `ADMIN_SESSION_SECRET`.

Setelah itu workflow produksi cukup:

```powershell
.\scripts\push-production.ps1 -Message "Perbaiki footer"
```

Script melakukan `git add`, `commit`, dan `push`; Cloudflare lalu deploy otomatis.

## 5. Workflow harian yang disarankan

Frontend/Worker:

```text
Edit -> Save -> wrangler dev langsung refresh -> test -> git push -> auto deploy workers.dev
```

Backend Apps Script:

```text
Edit gas/Code.gs -> clasp push/watch -> test -> redeploy deployment ID yang sama
```

Saat mengembangkan backend secara intensif:

```powershell
npm run gas:watch
```

Jangan memakai auto-push Git ke production pada setiap Save. Lebih aman gunakan hot reload lokal untuk setiap Save, lalu satu commit/push ketika perubahan sudah lolos test.

## 6. Keamanan yang sudah ditambahkan

- PIN Administrator tidak lagi perlu hardcoded di `Code.gs`; dibaca dari Script Properties.
- Secret Apps Script tidak pernah dikirim ke browser.
- Worker hanya mengizinkan daftar fungsi SIMANTAP yang telah di-whitelist.
- Fungsi Administrator membutuhkan cookie sesi `HttpOnly`, ditandatangani HMAC oleh Worker.
- Input pemeliharaan dengan sumber `Administrator` juga membutuhkan sesi Administrator.
- `/api/*` menggunakan `Cache-Control: no-store`.

## 7. Catatan produksi

`workers.dev` cocok untuk development/awal. Untuk aplikasi internal kantor, setelah stabil sebaiknya gunakan custom domain resmi dan Cloudflare Access agar frontend serta data master tidak terbuka untuk pengguna yang tidak berwenang.
