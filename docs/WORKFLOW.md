# WORKFLOW PENGEMBANGAN SIMANTAP BMN

## Saat mengubah tampilan
1. `npm run dev`
2. Edit `public/index.html` / `public/js/gas-shim.js` / `src/index.js`.
3. Test pada localhost.
4. Jalankan `./scripts/push-production.ps1 -Message "pesan perubahan"`.
5. Cloudflare otomatis deploy setelah push ke `main`.

## Saat mengubah logika Spreadsheet/Drive
1. Edit `gas/Code.gs`.
2. Gunakan `npm run gas:watch` selama development bila diperlukan.
3. Setelah siap, jalankan `./scripts/deploy-gas.ps1` supaya source dipush dan deployment Web App yang sama diperbarui.
4. Karena deployment ID tetap, `GAS_WEBAPP_URL` pada Worker tidak perlu diubah.

## Kenapa tidak git push setiap Save?
Karena setiap push ke branch production memicu deploy. Save sebaiknya hanya hot reload lokal; push dilakukan saat satu perubahan sudah layak produksi.
