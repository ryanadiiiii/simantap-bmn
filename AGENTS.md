# SIMANTAP BMN — Project Context & Agent Instructions

## 1. Tentang Project

Nama aplikasi: **SIMANTAP BMN**

SIMANTAP BMN adalah aplikasi pengelolaan layanan Barang Milik Negara (BMN) pada Kantor Wilayah Kementerian Hukum Nusa Tenggara Barat.

Project ini menggunakan:

- Google Apps Script sebagai backend dan Web App (`gas/Code.gs`, `gas/Index.html`).
- Google Sheets sebagai database utama.
- Cloudflare Worker (`src/index.js`) sebagai gateway produksi, API proxy (`/api/gas`), auth cookie admin, webhook WhatsApp (`/api/fonnte/webhook`), dan penyaji aset statis frontend produksi.
- Frontend produksi yang disajikan oleh Cloudflare Worker berasal dari folder `public/` (`public/index.html`, `public/css/style.css`, `public/js/app.js`, `public/js/gas-shim.js`).
- `gas/Index.html` tetap dipertahankan sinkron dengan `public/` sebagai template Web App Apps Script.
- Google Apps Script pada `gas/Code.gs` sebagai business logic.
- Fonnte sebagai gateway WhatsApp.
- `clasp` untuk sinkronisasi dan deployment Google Apps Script, serta `wrangler` untuk deployment Cloudflare Worker.

Timezone aplikasi adalah **Asia/Makassar / WITA**.

---

## 2. Struktur Penting Project

File utama:

```text
gas/
├── Code.gs
├── Index.html
└── appsscript.json
src/
└── index.js
public/
├── index.html
├── css/
│   └── style.css
└── js/
    ├── app.js
    └── gas-shim.js
```

Root project juga memiliki:

```text
.clasp.json
wrangler.jsonc
package.json
```

serta beberapa `.bat` dan `scripts/*.ps1` untuk deployment Google Apps Script dan Cloudflare Worker.

Frontend produksi yang diakses pengguna melalui domain Cloudflare Worker disajikan langsung dari `public/`. Oleh karena itu, setiap perubahan frontend untuk produksi wajib menjaga `gas/Index.html` dan `public/` tetap sinkron serta men-deploy Cloudflare Worker.

Jangan mengganti `scriptId`, deployment production, atau konfigurasi deployment tanpa alasan yang jelas.

---

## 3. Modul Utama SIMANTAP BMN

Aplikasi memiliki layanan:

### Pinjam Pakai BMN

Terdiri dari:

- Pinjam Ruangan
- Pinjam Kendaraan
- Pinjam Sarana/Prasarana

### Pemeliharaan BMN

Untuk pencatatan dan monitoring pemeliharaan BMN.

### Administrator

Digunakan untuk proses persetujuan, penolakan, monitoring, pengelolaan data, dan operasional sistem.

### Inventaris BMN

Menampilkan daftar inventaris BMN berdasarkan ruangan.

---

## 4. Google Sheets

Spreadsheet menjadi database utama aplikasi.

Sheet penting antara lain:

```text
Jadwal
Pinjam_Kendaraan
Pinjam_Sarpras
Master_Kendaraan
WA_Approval_Queue
Notification_Log
Audit_Log
Pegawai
Master Pegawai
Pemeliharaan
Data_BMN
```

Jangan mengubah struktur kolom Sheet tanpa memeriksa seluruh referensi di `Code.gs` dan `Index.html`.

Jangan mengubah data production secara massal tanpa instruksi eksplisit.

---

## 5. Pinjam Ruangan

Ruangan utama:

```text
Ruang Aula
Ruang Zona Integritas
Ruang Transit
```

Prinsip utama:

**Ruangan yang sudah memiliki booking `Pending` maupun `ACC` pada rentang waktu yang overlap memblokir reservasi baru dan tidak boleh dipilih kembali; hanya booking yang ditolak (`Ditolak`) yang berhenti memblokir ruangan.**

Validasi harus dilakukan:

1. pada frontend;
2. pada backend;
3. kembali pada saat approval bila diperlukan.

Jangan hanya mengandalkan validasi frontend.

---

## 6. Pinjam Kendaraan

Master kendaraan mencakup antara lain:

```text
Toyota Avanza — B 2325 UUI
Toyota Avanza — B 2810 UYT
Toyota Avanza — B 2808 UYT
Toyota Avanza — B 2806 UYT
Hyundai H-1 — B 1394 SQP
Isuzu ELF — DR 7409 J
Panther — DR 8128 AK
```

Client memilih **jenis kendaraan**, bukan nomor polisi/unit fisik.

Administrator/operator menentukan unit aktual ketika approval.

### Aturan Availability

Perilaku availability kendaraan harus menyerupai booking ruangan.

Jika suatu unit sudah `ACC` pada rentang waktu yang overlap:

**unit tersebut tidak tersedia dan tidak boleh dipilih lagi.**

Jika masih ada minimal satu unit dari jenis kendaraan tersebut yang tersedia:

```text
Toyota Avanza — 1 dari 4 tersedia
```

jenis tersebut masih boleh dipilih oleh client.

Jika seluruh unit pada jenis tersebut bentrok:

```text
Toyota Avanza — PENUH / sudah terbooking
```

opsi harus disabled dan tidak dapat dipilih.

Jika client sebelumnya sudah memilih suatu jenis kendaraan lalu mengubah jadwal sehingga seluruh unit menjadi penuh, pilihan sebelumnya harus otomatis di-reset.

### Hard Guard

Backend wajib melakukan validasi ulang sebelum assignment/ACC.

Gunakan `LockService` pada proses kritis agar dua approval yang terjadi hampir bersamaan tidak menghasilkan double booking.

Frontend bukan sumber kebenaran terakhir.

---

## 7. Perhitungan Bentrok Kendaraan

Dua booking kendaraan bentrok apabila:

```text
mulaiBaru < selesaiLama
AND
selesaiBaru > mulaiLama
```

Status seperti berikut tidak boleh memblokir kendaraan:

```text
Pending
Ditolak
Dikembalikan
```

Booking yang sudah `ACC` atau masih aktif harus diperhitungkan.

### Format Waktu

PERHATIAN:

Frontend dapat menghasilkan:

```text
2026-11-26T08:00
```

sedangkan Google Sheets melalui `getDisplayValues()` dapat menghasilkan:

```text
2026-11-26 08:00
```

`parseDateTimeLocal_()` harus dapat membaca **kedua format tersebut**.

Jangan mengembalikan implementasi parser yang hanya menerima karakter `T`.

Bug ini sebelumnya menyebabkan double booking kendaraan.

---

## 8. Audit Bentrok Kendaraan

Terdapat function:

```javascript
auditBentrokKendaraanAktifSekarang()
```

yang digunakan untuk mendeteksi konflik assignment kendaraan.

Jika memperbaiki function audit, prioritaskan konflik:

- yang sedang berlangsung;
- yang akan datang;

dan pisahkan dari konflik historis yang jadwalnya sudah selesai.

---

## 9. WhatsApp / Fonnte

Integrasi WhatsApp menggunakan Fonnte.

Jangan pernah:

- menampilkan Device Token;
- menampilkan webhook secret;
- menampilkan API shared secret;
- memasukkan token/secret langsung ke source;
- mengganti nomor operator tanpa instruksi eksplisit.

Secret/configuration harus tetap menggunakan Script Properties atau environment secret yang sudah tersedia.

---

## 10. WhatsApp Client

Client menerima notifikasi personal.

### ACC

Format prinsip:

```text
✅ PENGAJUAN DISETUJUI

Halo [NAMA], pengajuan ... Anda telah disetujui.

[informasi penting]

ID: [ID]
```

### TOLAK

Format prinsip:

```text
❌ PENGAJUAN DITOLAK

Halo [NAMA], pengajuan ... Anda belum dapat disetujui.

📝 Alasan: [ALASAN]

ID: [ID]
```

Pesan harus singkat dan langsung menunjukkan status.

---

## 11. WhatsApp Grup

Ada dua grup operasional:

```text
WA_GROUP_KENDARAAN
WA_GROUP_RUANGAN
```

### Grup Kendaraan

Grup digunakan oleh petugas/sopir.

Hanya transaksi **ACC** yang masuk grup.

Jangan mengirim transaksi `TOLAK` ke grup.

Pesan grup berupa **snapshot daftar tugas kendaraan aktif**, bukan salinan pesan client.

Contoh konsep:

```text
🚗 DAFTAR TUGAS KENDARAAN

1. 26/11/2026 | 08:00-12:00 WITA
   Nama Peminjam
   🚗 Toyota Avanza — B xxxx xxx
   📍 Tujuan
   📝 Kegiatan
```

Daftar hanya berisi pekerjaan yang belum selesai/masih relevan.

### Grup Ruangan

Grup digunakan untuk petugas yang mempersiapkan ruangan.

Hanya transaksi **ACC** yang dikirim.

Pesan berupa snapshot persiapan ruangan aktif.

Informasi utama:

- ruangan;
- tanggal/jam;
- kegiatan;
- peminjam;
- jumlah peserta;
- BMN/peralatan yang perlu dipersiapkan.

### Sarpras

Pinjam Sarpras hanya mengirim notifikasi kepada client.

Tidak ada grup WhatsApp Sarpras.

---

## 12. Queue Approval WhatsApp

SIMANTAP memiliki sheet:

```text
WA_Approval_Queue
```

yang digunakan sebagai FIFO queue approval WhatsApp.

Status queue antara lain:

```text
ACTIVE
WAITING
DONE
SKIPPED
```

Tahap antara lain:

```text
APPROVAL
PILIH_UNIT
```

Jangan merombak mekanisme queue, webhook, atau FIFO ketika melakukan perubahan fitur lain kecuali memang diminta.

Perubahan pada notifikasi tidak boleh merusak approval queue.

---

## 13. Approval Kendaraan via WhatsApp

Alur:

```text
Pengajuan
→ operator ACC
→ sistem menampilkan unit yang tersedia
→ operator memilih unit
→ backend cek ulang availability
→ assignment
→ status ACC
```

Unit yang bentrok tidak boleh tampil dalam daftar pilihan.

Jika pilihan menjadi stale karena transaksi lain sudah lebih dahulu ACC, backend wajib menolak assignment.

Error sebaiknya menjelaskan unit dan ID transaksi yang menyebabkan bentrok.

---

## 14. Logging

Gunakan dan pertahankan:

```text
Notification_Log
Audit_Log
```

untuk tracing proses.

Ketika debugging:

1. cek data transaksi;
2. cek Audit_Log;
3. cek Notification_Log;
4. baru simpulkan akar masalah.

Jangan menebak penyebab error jika log/source dapat diperiksa.

---

## 15. Prinsip Saat Mengubah Source

Sebelum mengedit:

1. Baca source yang aktual.
2. Cari function/call-site yang benar-benar digunakan.
3. Jangan membuat function baru jika function existing dapat diperbaiki.
4. Pertahankan compatibility dengan fitur yang sudah berjalan.
5. Lakukan perubahan sekecil mungkin.
6. Periksa dampak terhadap frontend, backend, WA, queue, dan Sheet.

Setelah mengedit:

1. validasi syntax `gas/Code.gs`;
2. validasi JavaScript pada `gas/Index.html`, `public/js/app.js`, dan `src/index.js` (bila diubah);
3. pastikan frontend `gas/Index.html` dan `public/` tetap sinkron;
4. lakukan behavioral test jika logikanya kritis;
5. jelaskan file/function yang diubah;
6. jangan deploy jika syntax check gagal.

---

## 16. Deployment

Google Apps Script dikelola menggunakan `clasp`, sedangkan frontend produksi dan proxy API/webhook dikelola melalui Cloudflare Worker (`wrangler`).

Alur umum GAS:

```text
clasp status
clasp push
clasp create-version
clasp redeploy
```

Alur deploy Cloudflare Worker:

```text
node --check src/index.js
npx wrangler deploy
```

Gunakan deployment production yang sudah terdapat di script deployment project.

Jangan membuat deployment production baru jika deployment lama dapat di-redeploy.

Aturan deploy per area perubahan:

- **Perubahan `gas/Code.gs` saja (backend GAS)**: cukup deploy GAS (`clasp`); **tidak perlu deploy Cloudflare Worker**.
- **Perubahan frontend produksi (`public/` dan sinkronisasi `gas/Index.html`)**: wajib menyinkronkan `public/` (`public/index.html`, `public/css/style.css`, `public/js/app.js`) dan **wajib deploy Cloudflare Worker** (`npx wrangler deploy` / script deploy Worker) karena pengguna produksi dilayani dari `public/`. Jika `gas/Index.html` ikut berubah, deploy GAS juga agar Web App `/exec` tetap sinkron.
- **Perubahan `src/index.js` saja**: deploy Cloudflare Worker (`npx wrangler deploy` / `deploy-worker-only.bat`).

---

## 17. Aturan Keamanan

Jangan:

- hardcode secret;
- menampilkan token;
- menghapus data production tanpa instruksi;
- mengganti konfigurasi environment secara sembarangan;
- menjalankan migration/destructive operation tanpa memeriksa dampaknya;
- mengubah mekanisme autentikasi tanpa permintaan.

Jika menemukan secret di source, jangan mengulang nilainya dalam response.

---

## 18. Cara Bekerja yang Diharapkan

Saat menerima task:

- jangan langsung menulis ulang banyak source;
- inspect source yang relevan terlebih dahulu;
- jelaskan akar masalah berdasarkan bukti;
- prioritaskan solusi sederhana dan robust;
- pertahankan fitur existing;
- jangan berasumsi jika dapat diverifikasi dari source/log/data;
- jika memperbaiki bug, cari root cause, bukan hanya symptom.

Untuk bug terkait data production, selalu bedakan:

```text
existing bad data
```

dengan:

```text
bug yang memungkinkan bad data baru
```

Perbaikan source harus mencegah kasus baru tanpa diam-diam mengubah histori production.

---

## 19. Current Stability Priorities

Fitur yang sudah berjalan dan jangan rusak:

```text
Pinjam Ruangan
Pinjam Kendaraan
Pinjam Sarpras
Pemeliharaan
FIFO WA Approval Queue
ACC/TOLAK via WhatsApp
Pemilihan unit kendaraan via WhatsApp
Notifikasi client
Operational group list kendaraan
Operational group list ruangan
Reconnect/sync queue
Audit Log
Notification Log
Vehicle overlap protection
```

Ketika melakukan revisi baru, lakukan regression check terhadap area tersebut.

---

## 20. Instruksi untuk Agent

Ketika pertama kali membuka project:

1. Baca file ini seluruhnya.
2. Inspect struktur repository.
3. Baca `gas/Code.gs`, `gas/Index.html`, `src/index.js`, dan folder `public/` (`public/index.html`, `public/js/app.js`, `public/js/gas-shim.js`).
4. Jangan melakukan perubahan apa pun terlebih dahulu.
5. Berikan ringkasan arsitektur yang ditemukan.
6. Sebutkan apakah implementasi aktual sesuai dengan aturan pada file ini.
7. Jika menemukan perbedaan, laporkan dahulu sebelum mengubah source.

Selalu gunakan source aktual sebagai source of truth.