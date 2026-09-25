// SOLUSI PERMANEN UPLOAD FOTO
// Karena folder Google Drive berada di email berbeda/berbayar, deployment Web App
// wajib dibuat oleh email pemilik folder Drive berbayar.
// Setup yang benar:
// 1) Share Spreadsheet database ke email Drive berbayar sebagai Editor.
// 2) Login Apps Script memakai email Drive berbayar.
// 3) Jalankan function authorizeDriveOnce() dari email Drive berbayar.
// 4) Deploy Web App dengan pilihan Execute as: Me, yaitu email Drive berbayar.
// 5) Gunakan URL deployment yang dibuat oleh email Drive berbayar.
const UPLOAD_FOTO_DRIVE_AKTIF = true;
const FOLDER_ID_FOTO = "144ha3CU3eo2SLpWLqdUt0LaIkK2m3dBA"; // Ganti dengan ID folder Drive berbayar untuk foto pemeliharaan
const FOTO_SHARE_ANYONE_WITH_LINK = false; // true jika link foto boleh dibuka siapa saja yang punya link

const SHEET_JADWAL = "Jadwal";
const SHEET_PEMELIHARAAN = "Pemeliharaan";
const SHEET_DATA_BMN = "Data_BMN";
const SHEET_PEGAWAI = "Pegawai";
const SHEET_PINJAM_KENDARAAN = "Pinjam_Kendaraan";
const SHEET_PINJAM_SARPRAS = "Pinjam_Sarpras";

// --- OPTIMASI LOAD DATA ---
// Batas default data yang dikirim ke frontend agar Web App tetap ringan.
const LIMIT_TAMPIL_USER = 50;
const LIMIT_TAMPIL_ADMIN = 100;
const CACHE_MASTER_DATA_SECONDS = 300; // 5 menit
const CACHE_KEY_MASTER_DATA = 'MASTER_DATA_BMN_V3';


function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('SIMANTAP BMN')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


// ================================================================
// API BRIDGE UNTUK CLOUDFLARE WORKERS
// ================================================================
// Script Properties yang WAJIB dibuat:
// 1. PIN_ADMINISTRATOR  = PIN login Administrator
// 2. API_SHARED_SECRET = secret yang sama dengan GAS_API_SECRET pada Worker
//
// Endpoint ini tidak mengganti alur Spreadsheet/Drive yang sudah berjalan.
// Ia hanya menyediakan jalur JSON aman untuk frontend Cloudflare Worker.
const SIMANTAP_API_PUBLIC_ACTIONS = [
  'verifikasiPin',
  'getMasterDataOptimized',
  'getJadwalRingkas',
  'getPemeliharaanRingkas',
  'getPinjamKendaraanRingkas',
  'getPinjamSarprasRingkas',
  'simpanBooking',
  'simpanPinjamKendaraan',
  'simpanPinjamSarpras',
  'simpanPemeliharaan'
];

const SIMANTAP_API_ADMIN_ACTIONS = [
  'getJadwalAdminRingkas',
  'getPemeliharaanAdminRingkas',
  'getPinjamKendaraanAdminRingkas',
  'getPinjamSarprasAdminRingkas',
  'ubahStatusBooking',
  'ubahStatusKendaraan',
  'updateKeteranganKendaraan',
  'ubahStatusSarpras',
  'ubahStatusPemeliharaan',
  'simpanBMN'
];

function doPost(e) {
  try {
    const raw = e && e.postData ? String(e.postData.contents || '') : '';
    if (!raw) throw new Error('Payload API kosong.');

    const payload = JSON.parse(raw);
    const apiSecret = PropertiesService.getScriptProperties().getProperty('API_SHARED_SECRET');
    if (!apiSecret) {
      throw new Error('API_SHARED_SECRET belum dikonfigurasi pada Script Properties.');
    }

    if (String(payload.apiKey || '') !== String(apiSecret)) {
      return simantapJsonResponse_({ ok: false, error: 'API key tidak valid.' });
    }

    const action = String(payload.action || '').trim();
    const args = Array.isArray(payload.args) ? payload.args : [];
    const adminAuthorized = payload.adminAuthorized === true;

    const isPublic = SIMANTAP_API_PUBLIC_ACTIONS.indexOf(action) !== -1;
    const isAdmin = SIMANTAP_API_ADMIN_ACTIONS.indexOf(action) !== -1;

    if (!isPublic && !isAdmin) {
      return simantapJsonResponse_({ ok: false, error: 'Action API tidak diizinkan: ' + action });
    }

    if (isAdmin && !adminAuthorized) {
      return simantapJsonResponse_({ ok: false, error: 'Sesi Administrator diperlukan.' });
    }

    // Input pemeliharaan rutin Administrator otomatis ACC. Karena itu sumber
    // Administrator tidak boleh bisa dipalsukan dari request pengguna biasa.
    if (action === 'simpanPemeliharaan' && args[0]) {
      const sumber = normalisasiTeks_(args[0].sumber || 'User');
      if (sumber === 'administrator' && !adminAuthorized) {
        return simantapJsonResponse_({ ok: false, error: 'Sesi Administrator diperlukan untuk pemeliharaan rutin.' });
      }
    }

    const handlers = {
      verifikasiPin: verifikasiPin,
      getMasterDataOptimized: getMasterDataOptimized,
      getJadwalRingkas: getJadwalRingkas,
      getJadwalAdminRingkas: getJadwalAdminRingkas,
      getPemeliharaanRingkas: getPemeliharaanRingkas,
      getPemeliharaanAdminRingkas: getPemeliharaanAdminRingkas,
      getPinjamKendaraanRingkas: getPinjamKendaraanRingkas,
      getPinjamKendaraanAdminRingkas: getPinjamKendaraanAdminRingkas,
      getPinjamSarprasRingkas: getPinjamSarprasRingkas,
      getPinjamSarprasAdminRingkas: getPinjamSarprasAdminRingkas,
      simpanBooking: simpanBooking,
      ubahStatusBooking: ubahStatusBooking,
      simpanPinjamKendaraan: simpanPinjamKendaraan,
      ubahStatusKendaraan: ubahStatusKendaraan,
      updateKeteranganKendaraan: updateKeteranganKendaraan,
      simpanPinjamSarpras: simpanPinjamSarpras,
      ubahStatusSarpras: ubahStatusSarpras,
      simpanPemeliharaan: simpanPemeliharaan,
      ubahStatusPemeliharaan: ubahStatusPemeliharaan,
      simpanBMN: simpanBMN
    };

    const result = handlers[action].apply(null, args);
    return simantapJsonResponse_({ ok: true, result: result });
  } catch (err) {
    return simantapJsonResponse_({
      ok: false,
      error: bersihkanPesanError_(err) || 'Terjadi kesalahan pada backend SIMANTAP BMN.'
    });
  }
}

function simantapJsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function cekKonfigurasiWorkerBackend() {
  const props = PropertiesService.getScriptProperties();
  return {
    pinAdministratorConfigured: !!props.getProperty('PIN_ADMINISTRATOR'),
    apiSharedSecretConfigured: !!props.getProperty('API_SHARED_SECRET'),
    folderFotoConfigured: !!FOLDER_ID_FOTO,
    uploadFotoAktif: UPLOAD_FOTO_DRIVE_AKTIF
  };
}

function verifikasiPin(pin) {
  const pinAdministrator = PropertiesService.getScriptProperties().getProperty('PIN_ADMINISTRATOR');
  if (!pinAdministrator) {
    throw new Error('PIN Administrator belum dikonfigurasi pada Script Properties.');
  }
  return String(pin || '').trim() === String(pinAdministrator).trim();
}

// --- MASTER DATA ---
function getMasterData() {
  ensureDataBMNSchema_();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetPegawai = ss.getSheetByName(SHEET_PEGAWAI);
  const sheetBmn = ss.getSheetByName(SHEET_DATA_BMN);

  const pegawai = sheetPegawai
    ? sheetPegawai.getRange("A2:A").getValues().map(r => r[0]).filter(String)
    : [];

  const bmn = [];
  if (sheetBmn) {
    const dataBmn = sheetBmn.getDataRange().getDisplayValues();
    for (let i = 1; i < dataBmn.length; i++) {
      if (!dataBmn[i].join('').trim()) continue;

      const kodeBarang = String(dataBmn[i][0] || '').trim();
      const nup = String(dataBmn[i][1] || '').trim();
      const idGabungan = buatIdBMN_(kodeBarang, nup);

      bmn.push({
        id: idGabungan,
        idBarang: idGabungan,
        kodeBarang: kodeBarang,
        nup: nup,
        nama: dataBmn[i][2] || '',
        namaBmn: dataBmn[i][2] || '',
        merk: dataBmn[i][3] || '',
        tahunPerolehan: dataBmn[i][4] || '',
        tahun: dataBmn[i][4] || '',
        kondisi: dataBmn[i][5] || '',
        lokasi: dataBmn[i][6] || '',
        pj: dataBmn[i][7] || ''
      });
    }
  }

  return { pegawai: pegawai, bmn: bmn };
}

function getMasterDataOptimized(forceRefresh) {
  if (!forceRefresh) {
    try {
      const cached = CacheService.getScriptCache().get(CACHE_KEY_MASTER_DATA);
      if (cached) return JSON.parse(cached);
    } catch (e) {
      // Cache tidak wajib. Kalau gagal, sistem tetap ambil data langsung dari sheet.
    }
  }

  const data = getMasterData();

  try {
    CacheService.getScriptCache().put(CACHE_KEY_MASTER_DATA, JSON.stringify(data), CACHE_MASTER_DATA_SECONDS);
  } catch (e) {
    // CacheService punya batas ukuran. Kalau master BMN sudah sangat besar, abaikan cache.
  }

  return data;
}

function clearMasterDataCache_() {
  try {
    CacheService.getScriptCache().remove(CACHE_KEY_MASTER_DATA);
  } catch (e) {
    // Abaikan. Cache hanya akselerator, bukan sumber data utama.
  }
}

// --- DATA RINGKAS UNTUK FRONTEND ---
function getJadwalRingkas(limit) {
  // Halaman USER hanya menampilkan jadwal ruangan HARI INI.
  // Data jadwal pada sheet tidak dihapus/dipotong, dan halaman Administrator
  // tetap memakai getJadwalAdminRingkas() sehingga dapat melihat seluruh data.
  limit = batasiLimit_(limit, LIMIT_TAMPIL_USER);

  const data = getJadwal();
  const zona = Session.getScriptTimeZone() || 'Asia/Makassar';
  const hariIni = Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd');

  const jadwalHariIni = data.filter(function(row) {
    const tanggal = parseTanggal_(row && row.tanggal);
    if (!tanggal) return false;
    return Utilities.formatDate(tanggal, zona, 'yyyy-MM-dd') === hariIni;
  });

  jadwalHariIni.sort(function(a, b) {
    return nilaiUrutJadwal_(a) - nilaiUrutJadwal_(b);
  });

  return jadwalHariIni.slice(0, limit);
}

function getJadwalAdminRingkas(limit) {
  limit = batasiLimit_(limit, LIMIT_TAMPIL_ADMIN);
  return getJadwal().reverse().slice(0, limit);
}

function getPemeliharaanRingkas(limit) {
  limit = batasiLimit_(limit, LIMIT_TAMPIL_USER);
  return getPemeliharaan().reverse().slice(0, limit);
}

function getPemeliharaanAdminRingkas(limit) {
  limit = batasiLimit_(limit, LIMIT_TAMPIL_ADMIN);
  return getPemeliharaan().reverse().slice(0, limit);
}

function getPinjamKendaraanRingkas(limit) {
  limit = batasiLimit_(limit, LIMIT_TAMPIL_USER);
  return getPinjamKendaraan().reverse().slice(0, limit);
}

function getPinjamKendaraanAdminRingkas(limit) {
  limit = batasiLimit_(limit, LIMIT_TAMPIL_ADMIN);
  return getPinjamKendaraan().reverse().slice(0, limit);
}

function getPinjamSarprasRingkas(limit) {
  limit = batasiLimit_(limit, LIMIT_TAMPIL_USER);
  return getPinjamSarpras().reverse().slice(0, limit);
}

function getPinjamSarprasAdminRingkas(limit) {
  limit = batasiLimit_(limit, LIMIT_TAMPIL_ADMIN);
  return getPinjamSarpras().reverse().slice(0, limit);
}

function batasiLimit_(limit, fallback) {
  const n = Number(limit || fallback || 50);
  if (!isFinite(n) || n < 1) return fallback || 50;
  return Math.min(Math.floor(n), 500);
}

function nilaiUrutJadwal_(row) {
  const tanggal = parseTanggal_(row && row.tanggal);
  const mulai = parseJamKeMenit_(row && row.mulai);
  if (!tanggal) return Number.MAX_SAFE_INTEGER;
  const dt = buatDateTime_(tanggal, mulai === null ? 0 : mulai);
  return dt.getTime();
}

// --- PINJAM RUANGAN ---
function getJadwal() {
  const sheet = getOrCreateJadwalSheet_();
  pastikanIdJadwal_();
  pastikanKolomJadwalTambahan_();

  const data = sheet.getDataRange().getDisplayValues();
  const jadwalAktif = [];

  for (let i = 1; i < data.length; i++) {
    if (!data[i].join('').trim()) continue;
    jadwalAktif.push({
      idBooking: data[i][0],
      kode: data[i][0],
      tanggal: data[i][1],
      ruangan: data[i][2],
      mulai: data[i][3],
      selesai: data[i][4],
      nama: data[i][5],
      status: data[i][6],
      bmnPinjam: data[i][7] || '-',
      namaKegiatan: data[i][8] || '-',
      jumlahPeserta: data[i][9] || '-',
      pesertaJabatan: data[i][10] || '-'
    });
  }

  return jadwalAktif;
}

function simpanBooking(form) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getOrCreateJadwalSheet_();
    pastikanIdJadwal_();
    pastikanKolomJadwalTambahan_();

    const hasilValidasi = validasiBookingRuangan_(sheet, form);
    const idBooking = generateIdUnik_("JDW", getExistingIds_(sheet, 1));

    sheet.appendRow([
      idBooking,
      hasilValidasi.tanggalInput,
      hasilValidasi.ruangan,
      hasilValidasi.jamMulai,
      hasilValidasi.jamSelesai,
      hasilValidasi.nama,
      "Pending",
      hasilValidasi.bmnDipinjam,
      hasilValidasi.namaKegiatan,
      hasilValidasi.jumlahPeserta,
      hasilValidasi.pesertaJabatan
    ]);

    return "SUKSES: Pengajuan pinjam ruangan terkirim dengan ID " + idBooking + ". Menunggu ACC.";
  } finally {
    lock.releaseLock();
  }
}

function validasiBookingRuangan_(sheet, form) {
  form = form || {};

  const tanggalInput = String(form.tanggal || '').trim();
  const ruangan = String(form.ruangan || '').trim();
  const jamMulai = String(form.jamMulai || '').trim();
  const jamSelesai = String(form.jamSelesai || '').trim();
  const nama = String(form.nama || '').trim();
  const bmnDipinjam = String(form.bmnDipinjam || '-').trim() || '-';
  const namaKegiatan = String(form.namaKegiatan || '').trim();
  const jumlahPeserta = String(form.jumlahPeserta || '').trim();
  const pesertaJabatan = String(form.pesertaJabatan || '').trim();

  if (!tanggalInput || !ruangan || !jamMulai || !jamSelesai || !nama || !namaKegiatan || !jumlahPeserta || !pesertaJabatan) {
    throw new Error('Data pinjam ruangan belum lengkap. Pastikan tanggal, ruangan, jam, peminjam, nama kegiatan, jumlah peserta, dan peserta/jabatan sudah diisi.');
  }

  const tanggalBooking = parseTanggal_(tanggalInput);
  const menitMulai = parseJamKeMenit_(jamMulai);
  const menitSelesai = parseJamKeMenit_(jamSelesai);

  if (!tanggalBooking) throw new Error('Format tanggal tidak valid. Gunakan format tanggal dari input aplikasi.');
  if (menitMulai === null || menitSelesai === null) throw new Error('Format jam tidak valid. Gunakan format HH:MM.');
  if (menitSelesai <= menitMulai) throw new Error('Jam selesai harus lebih besar dari jam mulai.');

  const waktuMulaiBooking = buatDateTime_(tanggalBooking, menitMulai);
  const waktuSelesaiBooking = buatDateTime_(tanggalBooking, menitSelesai);
  const sekarang = new Date();

  if (waktuMulaiBooking < sekarang) {
    throw new Error('Pengajuan ditolak: tanggal dan jam mulai tidak boleh berada di masa lalu.');
  }

  const range = sheet.getDataRange();
  const data = range.getValues();
  const display = range.getDisplayValues();
  const ruanganBaru = normalisasiTeks_(ruangan);

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rowDisplay = display[i] || [];

    const statusLama = normalisasiTeks_(row[6] || rowDisplay[6]);
    if (statusLama.includes('tolak')) continue;

    const ruanganLama = normalisasiTeks_(row[2] || rowDisplay[2]);
    if (ruanganLama !== ruanganBaru) continue;

    const tanggalLama = parseTanggal_(row[1]) || parseTanggal_(rowDisplay[1]);
    const menitMulaiLama = parseJamKeMenit_(row[3]) ?? parseJamKeMenit_(rowDisplay[3]);
    const menitSelesaiLama = parseJamKeMenit_(row[4]) ?? parseJamKeMenit_(rowDisplay[4]);

    if (!tanggalLama || menitMulaiLama === null || menitSelesaiLama === null) continue;

    const waktuMulaiLama = buatDateTime_(tanggalLama, menitMulaiLama);
    const waktuSelesaiLama = buatDateTime_(tanggalLama, menitSelesaiLama);
    if (waktuSelesaiLama <= waktuMulaiLama) continue;

    const bentrok = waktuMulaiBooking < waktuSelesaiLama && waktuSelesaiBooking > waktuMulaiLama;

    if (bentrok) {
      throw new Error(
        'Pengajuan ditolak: ruangan "' + ruangan + '" sudah memiliki jadwal pada ' +
        (rowDisplay[1] || formatTanggalInput_(tanggalLama)) + ' pukul ' +
        (rowDisplay[3] || formatMenitKeJam_(menitMulaiLama)) + ' - ' +
        (rowDisplay[4] || formatMenitKeJam_(menitSelesaiLama)) +
        ' oleh ' + (rowDisplay[5] || row[5] || '-') +
        ' dengan status ' + (rowDisplay[6] || row[6] || '-') +
        ' (ID Booking: ' + (rowDisplay[0] || row[0] || '-') + ').'
      );
    }
  }

  return { tanggalInput, ruangan, jamMulai, jamSelesai, nama, bmnDipinjam, namaKegiatan, jumlahPeserta, pesertaJabatan };
}

function ubahStatusBooking(idBooking, statusBaru) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getOrCreateJadwalSheet_();
    pastikanIdJadwal_();
    pastikanKolomJadwalTambahan_();
    ubahStatusById_(sheet, idBooking, 7, statusBaru);
    return 'Status pinjam ruangan ' + idBooking + ' berhasil diubah menjadi ' + statusBaru + '.';
  } finally {
    lock.releaseLock();
  }
}

// --- PINJAM KENDARAAN ---
function getPinjamKendaraan() {
  const sheet = getOrCreatePinjamKendaraanSheet_();
  const data = sheet.getDataRange().getDisplayValues();
  const hasil = [];

  for (let i = 1; i < data.length; i++) {
    if (!data[i].join('').trim()) continue;
    hasil.push({
      idPinjam: data[i][0],
      tanggalPengajuan: data[i][1],
      nama: data[i][2],
      kegiatan: data[i][3],
      tujuan: data[i][4],
      lama: data[i][5],
      batasKembali: data[i][6],
      status: data[i][7],
      keteranganAdmin: data[i][8] || ''
    });
  }

  return hasil;
}

function simpanPinjamKendaraan(form) {
  return simpanPinjamUmum_(SHEET_PINJAM_KENDARAAN, getOrCreatePinjamKendaraanSheet_(), 'KND', form, 'kendaraan');
}

function ubahStatusKendaraan(idPinjam, statusBaru) {
  const sheet = getOrCreatePinjamKendaraanSheet_();
  ubahStatusById_(sheet, idPinjam, 8, statusBaru);
  return 'Status pinjam kendaraan ' + idPinjam + ' berhasil diubah menjadi ' + statusBaru + '.';
}

function updateKeteranganKendaraan(idPinjam, keteranganAdmin) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getOrCreatePinjamKendaraanSheet_();
    const id = String(idPinjam || '').trim();
    const ket = String(keteranganAdmin || '').trim();

    if (!id) {
      throw new Error('ID pinjam kendaraan tidak valid.');
    }

    if (ket.length > 500) {
      throw new Error('Keterangan admin terlalu panjang. Maksimal 500 karakter.');
    }

    const rowIndex = findRowById_(sheet, id, 1);
    if (rowIndex < 2) {
      throw new Error('Data pinjam kendaraan dengan ID ' + id + ' tidak ditemukan.');
    }

    sheet.getRange(rowIndex, 9).setValue(ket);
    return 'Keterangan admin untuk pinjam kendaraan ' + id + ' berhasil disimpan.';
  } finally {
    lock.releaseLock();
  }
}

// --- PINJAM SARPRAS ---
function getPinjamSarpras() {
  const sheet = getOrCreatePinjamSarprasSheet_();
  const data = sheet.getDataRange().getDisplayValues();
  const hasil = [];

  for (let i = 1; i < data.length; i++) {
    if (!data[i].join('').trim()) continue;
    hasil.push({
      idPinjam: data[i][0],
      tanggalPengajuan: data[i][1],
      nama: data[i][2],
      kegiatan: data[i][3],
      tempat: data[i][4],
      jenisBarang: data[i][5],
      lama: data[i][6],
      batasKembali: data[i][7],
      status: data[i][8]
    });
  }

  return hasil;
}

function simpanPinjamSarpras(form) {
  form = form || {};
  form.tujuan = form.tempat || form.tujuan || '';
  return simpanPinjamUmum_(SHEET_PINJAM_SARPRAS, getOrCreatePinjamSarprasSheet_(), 'SPR', form, 'sarpras');
}

function ubahStatusSarpras(idPinjam, statusBaru) {
  const sheet = getOrCreatePinjamSarprasSheet_();
  ubahStatusById_(sheet, idPinjam, 9, statusBaru);
  return 'Status pinjam sarpras ' + idPinjam + ' berhasil diubah menjadi ' + statusBaru + '.';
}

function simpanPinjamUmum_(sheetName, sheet, prefix, form, tipe) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    form = form || {};
    const nama = String(form.nama || '').trim();
    const kegiatan = String(form.kegiatan || '').trim();
    const tujuan = String(form.tujuan || '').trim();
    const jenisBarang = String(form.jenisBarang || '').trim();
    const lama = String(form.lama || '').trim();
    const batasKembali = String(form.batasKembali || '').trim();

    if (!nama || !kegiatan || !tujuan || !lama || !batasKembali) {
      throw new Error('Data pengajuan belum lengkap. Pastikan nama pemohon, kegiatan, tujuan/tempat, lama penggunaan, dan batas kembali sudah diisi.');
    }

    const batas = parseDateTimeLocal_(batasKembali);
    if (!batas || batas < new Date()) {
      throw new Error('Batas kembali tidak boleh berada di masa lalu.');
    }

    const idPinjam = generateIdUnik_(prefix, getExistingIds_(sheet, 1));
    const tanggalPengajuan = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Makassar', 'yyyy-MM-dd HH:mm');

    if (tipe === 'kendaraan') {
      sheet.appendRow([idPinjam, tanggalPengajuan, nama, kegiatan, tujuan, lama, batasKembali, 'Pending', '']);
      return 'SUKSES: Pengajuan pinjam kendaraan terkirim dengan ID ' + idPinjam + '. Menunggu ACC.';
    }

    sheet.appendRow([idPinjam, tanggalPengajuan, nama, kegiatan, tujuan, jenisBarang, lama, batasKembali, 'Pending']);
    return 'SUKSES: Pengajuan pinjam sarpras terkirim dengan ID ' + idPinjam + '. Menunggu ACC.';
  } finally {
    lock.releaseLock();
  }
}

// --- PEMELIHARAAN ---
function getPemeliharaan() {
  const sheet = getOrCreatePemeliharaanSheet_();
  pastikanIdPemeliharaan_();
  pastikanKolomPemeliharaanTambahan_();

  const data = sheet.getDataRange().getDisplayValues();
  const riwayat = [];

  for (let i = 1; i < data.length; i++) {
    if (!data[i].join('').trim()) continue;

    const kodeBarang = data[i][1] || '';
    const nup = data[i][2] || '';
    const idGabungan = buatIdBMN_(kodeBarang, nup);

    riwayat.push({
      idPemeliharaan: data[i][0],
      kode: data[i][0],
      id: idGabungan,
      idBarang: idGabungan,
      kodeBarang: kodeBarang,
      nup: nup,
      nama: data[i][3],
      namaBmn: data[i][3],
      tgl: data[i][4],
      ket: data[i][5],
      foto: data[i][6],
      status: data[i][7],
      sumber: data[i][8] || 'User'
    });
  }

  return riwayat;
}

function simpanPemeliharaan(form) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getOrCreatePemeliharaanSheet_();
    pastikanIdPemeliharaan_();
    pastikanKolomPemeliharaanTambahan_();

    form = form || {};
    const kodeBarang = String(form.kodeBarang || '').trim();
    const nup = String(form.nup || '').trim();
    const namaBmn = String(form.namaBmn || '').trim();
    const tanggal = String(form.tanggal || '').trim();
    const deskripsi = String(form.deskripsi || '').trim();
    const sumber = String(form.sumber || 'User').trim() || 'User';
    const statusAwal = sumber === 'Administrator' ? 'ACC' : 'Pending';

    if (!kodeBarang || !namaBmn || !tanggal || !deskripsi) {
      throw new Error('Data pemeliharaan belum lengkap. Pastikan BMN, tanggal, dan deskripsi sudah diisi. Untuk data baru, Kode Barang dan NUP wajib dilengkapi di master BMN.');
    }

    const idPemeliharaan = generateIdUnik_('PMH', getExistingIds_(sheet, 1));
    const hasilFoto = simpanFotoPemeliharaanJikaAktif_(form, idPemeliharaan);
    const fotoUrl = hasilFoto.url;

    sheet.appendRow([idPemeliharaan, kodeBarang, nup, namaBmn, tanggal, deskripsi, fotoUrl, statusAwal, sumber]);

    let pesan = 'SUKSES: Data pemeliharaan tersimpan dengan ID ' + idPemeliharaan + ' untuk BMN ' + buatIdBMN_(kodeBarang, nup) + '.';
    if (hasilFoto.catatan) pesan += ' ' + hasilFoto.catatan;
    return pesan;
  } finally {
    lock.releaseLock();
  }
}

function simpanFotoPemeliharaanJikaAktif_(form, idPemeliharaan) {
  if (!form || !form.fotoBase64) {
    return { url: '-', catatan: '' };
  }

  if (!UPLOAD_FOTO_DRIVE_AKTIF) {
    return {
      url: '-',
      catatan: 'Catatan: foto belum disimpan karena upload foto Drive masih nonaktif.'
    };
  }

  try {
    if (!FOLDER_ID_FOTO || FOLDER_ID_FOTO === 'ISI_ID_FOLDER_DRIVE_DI_SINI') {
      return {
        url: '-',
        catatan: 'Catatan: foto belum disimpan karena FOLDER_ID_FOTO belum diisi dengan benar.'
      };
    }

    const folder = DriveApp.getFolderById(FOLDER_ID_FOTO);
    const contentType = form.fotoBase64.substring(5, form.fotoBase64.indexOf(';')) || 'image/jpeg';
    const bytes = Utilities.base64Decode(form.fotoBase64.substring(form.fotoBase64.indexOf('base64,') + 7));
    const namaFileAman = buatNamaFileFotoPemeliharaan_(form, idPemeliharaan, contentType);
    const blob = Utilities.newBlob(bytes, contentType, namaFileAman);
    const file = folder.createFile(blob);

    if (FOTO_SHARE_ANYONE_WITH_LINK) {
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (e) {
        // Kalau kebijakan Drive organisasi tidak mengizinkan public link,
        // file tetap tersimpan. Link hanya bisa dibuka oleh akun yang punya akses.
      }
    }

    return { url: file.getUrl(), catatan: '' };
  } catch (e) {
    return {
      url: '-',
      catatan: 'Catatan: data tersimpan, tetapi foto gagal diunggah. Penyebab: ' + bersihkanPesanError_(e)
    };
  }
}

function buatNamaFileFotoPemeliharaan_(form, idPemeliharaan, contentType) {
  form = form || {};

  const zona = Session.getScriptTimeZone() || 'Asia/Makassar';
  const stamp = Utilities.formatDate(new Date(), zona, 'yyyyMMdd-HHmmss');

  const kodeBarang = bersihkanNamaFileBagian_(form.kodeBarang || 'TANPA-KODE');
  const nup = bersihkanNamaFileBagian_(form.nup || 'TANPA-NUP');
  const namaBmn = bersihkanNamaFileBagian_(form.namaBmn || 'BMN');
  const id = bersihkanNamaFileBagian_(idPemeliharaan || 'PMH');
  const ekstensi = tentukanEkstensiFoto_(contentType, form.namaFile);

  // Template nama file:
  // PMH-20260630-001_20260630-143015_KB-3.10.01.02.001_NUP-1_Laptop_Lenovo.jpg
  let namaFile = id + '_' + stamp + '_KB-' + kodeBarang + '_NUP-' + nup + '_' + namaBmn;

  // Batasi panjang nama file agar tetap rapi dan aman di Drive.
  if (namaFile.length > 140) {
    namaFile = namaFile.substring(0, 140).replace(/[._-]+$/g, '');
  }

  return namaFile + ekstensi;
}

function bersihkanNamaFileBagian_(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'NA';
}

function tentukanEkstensiFoto_(contentType, namaFileAsli) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  if (type.includes('heic')) return '.heic';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';

  const match = String(namaFileAsli || '').toLowerCase().match(/\.(jpg|jpeg|png|webp|gif|heic)$/);
  if (match) return match[0] === '.jpeg' ? '.jpg' : match[0];

  return '.jpg';
}

function bersihkanPesanError_(e) {
  return String((e && e.message) ? e.message : e).replace(/\s+/g, ' ').trim();
}

function authorizeDriveOnce() {
  if (!FOLDER_ID_FOTO || FOLDER_ID_FOTO === 'ISI_ID_FOLDER_DRIVE_DI_SINI') {
    throw new Error('FOLDER_ID_FOTO belum diisi dengan ID folder Google Drive yang benar.');
  }

  const folder = DriveApp.getFolderById(FOLDER_ID_FOTO);
  Logger.log('Folder foto pemeliharaan berhasil diakses: ' + folder.getName());
  Logger.log('Effective user: ' + Session.getEffectiveUser().getEmail());
  return 'OK: Folder foto pemeliharaan berhasil diakses: ' + folder.getName();
}

function cekKonfigurasiDrive() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const folder = DriveApp.getFolderById(FOLDER_ID_FOTO);
  const info = {
    spreadsheet: ss ? ss.getName() : '-',
    folderFoto: folder.getName(),
    folderUrl: folder.getUrl(),
    effectiveUser: Session.getEffectiveUser().getEmail() || '(email tidak terbaca)',
    uploadFotoAktif: UPLOAD_FOTO_DRIVE_AKTIF,
    folderId: FOLDER_ID_FOTO
  };
  Logger.log(JSON.stringify(info, null, 2));
  return info;
}

function ubahStatusPemeliharaan(idPemeliharaan, statusBaru) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = getOrCreatePemeliharaanSheet_();
    pastikanIdPemeliharaan_();
    pastikanKolomPemeliharaanTambahan_();
    ubahStatusById_(sheet, idPemeliharaan, 8, statusBaru);
    return 'Status pemeliharaan ' + idPemeliharaan + ' berhasil diubah menjadi ' + statusBaru + '.';
  } finally {
    lock.releaseLock();
  }
}

// --- DATA BMN ---
function simpanBMN(form) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    ensureDataBMNSchema_();
    form = form || {};

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DATA_BMN);
    if (!sheet) throw new Error('Sheet "Data_BMN" tidak ditemukan.');

    const kodeBarang = String(form.kodeBarang || form.idBarang || '').trim();
    const nup = String(form.nup || '').trim();
    const namaBmn = String(form.namaBmn || '').trim();

    if (!kodeBarang) throw new Error('Kode Barang wajib diisi.');
    if (!nup) throw new Error('NUP wajib diisi.');
    if (!namaBmn) throw new Error('Nama BMN wajib diisi.');

    const merk = String(form.merk || '').trim();
    const tahunPerolehan = String(form.tahunPerolehan || form.tahun || '').trim();
    const kondisi = String(form.kondisi || '').trim() || 'Baik';
    const lokasi = String(form.lokasi || '').trim();
    const pj = String(form.pj || '').trim();

    if (cekDuplikatBMN_(sheet, kodeBarang, nup)) {
      throw new Error('Data BMN dengan Kode Barang ' + kodeBarang + ' dan NUP ' + nup + ' sudah ada.');
    }

    sheet.appendRow([kodeBarang, nup, namaBmn, merk, tahunPerolehan, kondisi, lokasi, pj]);
    clearMasterDataCache_();
    return 'Data BMN tersimpan: ' + buatIdBMN_(kodeBarang, nup) + ' - ' + namaBmn + '.';
  } finally {
    lock.releaseLock();
  }
}

// --- KOMPATIBILITAS LAMA ---
function ubahStatus(sheetName, baris, kolom, statusBaru) {
  validasiStatus_(statusBaru);
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName).getRange(baris, kolom).setValue(statusBaru);
  return 'Status berhasil diubah!';
}

// --- SHEET HELPERS ---
function getOrCreateJadwalSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_JADWAL);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_JADWAL);
    sheet.appendRow(['ID Booking', 'Tanggal', 'Ruangan', 'Jam Mulai', 'Jam Selesai', 'Nama Peminjam', 'Status', 'BMN Dipinjam', 'Nama Kegiatan', 'Jumlah Peserta', 'Peserta/Jabatan']);
  }
  return sheet;
}

function getOrCreatePemeliharaanSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_PEMELIHARAAN);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PEMELIHARAAN);
    sheet.appendRow(['ID Pemeliharaan', 'Kode Barang', 'NUP', 'Nama BMN', 'Tanggal', 'Keterangan', 'Foto', 'Status', 'Sumber']);
  }
  return sheet;
}

function getOrCreatePinjamKendaraanSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_PINJAM_KENDARAAN);
  const header = ['ID Pinjam', 'Tanggal Pengajuan', 'Nama Peminjam', 'Kegiatan', 'Tujuan', 'Lama Penggunaan', 'Batas Kembali', 'Status', 'Keterangan Admin'];

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PINJAM_KENDARAAN);
    sheet.appendRow(header);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
    return sheet;
  }

  const existingHeader = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), header.length)).getDisplayValues()[0];
  const hasKeteranganAdmin = existingHeader.some(function (h) {
    return normalisasiTeks_(h) === normalisasiTeks_('Keterangan Admin');
  });

  if (!hasKeteranganAdmin) {
    sheet.getRange(1, 9).setValue('Keterangan Admin');
  }

  return sheet;
}

function getOrCreatePinjamSarprasSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_PINJAM_SARPRAS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PINJAM_SARPRAS);
    sheet.appendRow(['ID Pinjam', 'Tanggal Pengajuan', 'Nama Peminjam', 'Kegiatan', 'Tempat Kegiatan', 'Jenis Barang', 'Lama Penggunaan', 'Batas Kembali', 'Status']);
  }
  return sheet;
}

function ensureDataBMNSchema_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_DATA_BMN);
  const targetHeader = ['Kode Barang', 'NUP', 'Nama BMN', 'Merk', 'Tahun Perolehan', 'Kondisi', 'Lokasi', 'Penanggung Jawab/Pemilik'];

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_DATA_BMN);
    sheet.appendRow(targetHeader);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(targetHeader);
    return sheet;
  }

  const values = sheet.getDataRange().getDisplayValues();
  const header = values[0] || [];
  const alreadyTarget = targetHeader.every(function (h, i) {
    return normalisasiTeks_(header[i]) === normalisasiTeks_(h);
  });

  if (alreadyTarget) return sheet;

  const indexMap = {};
  header.forEach(function (h, idx) {
    indexMap[normalisasiTeks_(h)] = idx;
  });

  function getCell(row, names, fallbackIndex) {
    for (let i = 0; i < names.length; i++) {
      const idx = indexMap[normalisasiTeks_(names[i])];
      if (idx !== undefined) return row[idx] || '';
    }
    return fallbackIndex !== undefined ? (row[fallbackIndex] || '') : '';
  }

  const output = [targetHeader];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (!row.join('').trim()) continue;

    const kodeBarang = getCell(row, ['Kode Barang', 'ID Barang', 'ID', 'Kode'], 0);
    const nup = getCell(row, ['NUP', 'Nomor Urut Pendaftaran'], undefined);
    const nama = getCell(row, ['Nama BMN', 'Nama Barang', 'Nama'], 1);
    const merk = getCell(row, ['Merk', 'Merk/Tipe', 'Merk / Tipe'], 2);
    const tahun = getCell(row, ['Tahun Perolehan', 'Tahun'], undefined);
    const kondisi = getCell(row, ['Kondisi'], 5);
    const lokasi = getCell(row, ['Lokasi'], 6);
    const pj = getCell(row, ['Penanggung Jawab/Pemilik', 'Penanggung Jawab', 'PJ', 'Pemilik'], 7);

    output.push([kodeBarang, nup, nama, merk, tahun, kondisi, lokasi, pj]);
  }

  sheet.clearContents();
  sheet.getRange(1, 1, output.length, targetHeader.length).setValues(output);
  return sheet;
}

function pastikanIdJadwal_() {
  const sheet = getOrCreateJadwalSheet_();
  pastikanKolomIdPertama_(sheet, 'ID Booking', 'JDW');
}

function pastikanIdPemeliharaan_() {
  const sheet = getOrCreatePemeliharaanSheet_();
  pastikanKolomIdPertama_(sheet, 'ID Pemeliharaan', 'PMH');
}

function pastikanKolomJadwalTambahan_() {
  const sheet = getOrCreateJadwalSheet_();
  pastikanHeaderMinimal_(sheet, ['ID Booking', 'Tanggal', 'Ruangan', 'Jam Mulai', 'Jam Selesai', 'Nama Peminjam', 'Status', 'BMN Dipinjam', 'Nama Kegiatan', 'Jumlah Peserta', 'Peserta/Jabatan']);
}

function pastikanKolomPemeliharaanTambahan_() {
  const sheet = getOrCreatePemeliharaanSheet_();
  const targetHeader = ['ID Pemeliharaan', 'Kode Barang', 'NUP', 'Nama BMN', 'Tanggal', 'Keterangan', 'Foto', 'Status', 'Sumber'];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(targetHeader);
    return;
  }

  const values = sheet.getDataRange().getDisplayValues();
  const header = values[0] || [];
  const alreadyTarget = targetHeader.every(function (h, i) {
    return normalisasiTeks_(header[i]) === normalisasiTeks_(h);
  });

  if (!alreadyTarget) {
    const indexMap = {};
    header.forEach(function (h, idx) {
      indexMap[normalisasiTeks_(h)] = idx;
    });

    function getCell(row, names, fallbackIndex) {
      for (let i = 0; i < names.length; i++) {
        const idx = indexMap[normalisasiTeks_(names[i])];
        if (idx !== undefined) return row[idx] || '';
      }
      return fallbackIndex !== undefined ? (row[fallbackIndex] || '') : '';
    }

    const output = [targetHeader];
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      if (!row.join('').trim()) continue;

      const idPemeliharaan = getCell(row, ['ID Pemeliharaan'], 0);
      const kodeBarang = getCell(row, ['Kode Barang', 'ID Barang', 'ID'], 1);
      const nup = getCell(row, ['NUP', 'Nomor Urut Pendaftaran'], undefined);
      const nama = getCell(row, ['Nama BMN', 'Nama Barang', 'Nama'], 2);
      const tanggal = getCell(row, ['Tanggal'], 3);
      const ket = getCell(row, ['Keterangan', 'Deskripsi'], 4);
      const foto = getCell(row, ['Foto'], 5);
      const status = getCell(row, ['Status'], 6) || 'Pending';
      const sumber = getCell(row, ['Sumber'], 7) || 'User';

      output.push([idPemeliharaan, kodeBarang, nup, nama, tanggal, ket, foto, status, sumber]);
    }

    sheet.clearContents();
    sheet.getRange(1, 1, output.length, targetHeader.length).setValues(output);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const sumberRange = sheet.getRange(2, 9, lastRow - 1, 1);
    const sumberValues = sumberRange.getValues();
    let changed = false;
    sumberValues.forEach(function (r) {
      if (!r[0]) { r[0] = 'User'; changed = true; }
    });
    if (changed) sumberRange.setValues(sumberValues);
  }
}

function pastikanHeaderMinimal_(sheet, headers) {
  const currentLastCol = Math.max(sheet.getLastColumn(), 1);
  const header = sheet.getRange(1, 1, 1, currentLastCol).getDisplayValues()[0];
  headers.forEach(function (h, idx) {
    if (normalisasiTeks_(header[idx]) !== normalisasiTeks_(h)) {
      sheet.getRange(1, idx + 1).setValue(h);
    }
  });
}

function pastikanKolomIdPertama_(sheet, headerId, prefix) {
  if (sheet.getLastRow() === 0) sheet.appendRow([headerId]);

  const headerSekarang = String(sheet.getRange(1, 1).getDisplayValue() || '').trim();
  if (normalisasiTeks_(headerSekarang) !== normalisasiTeks_(headerId)) {
    sheet.insertColumnBefore(1);
    sheet.getRange(1, 1).setValue(headerId);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const existingIds = new Set(values.map(r => String(r[0] || '').trim()).filter(Boolean));
  let adaPerubahan = false;

  for (let i = 0; i < values.length; i++) {
    if (!String(values[i][0] || '').trim()) {
      const idBaru = generateIdUnik_(prefix, existingIds);
      values[i][0] = idBaru;
      existingIds.add(idBaru);
      adaPerubahan = true;
    }
  }

  if (adaPerubahan) {
    sheet.getRange(2, 1, values.length, 1).setValues(values);
  }
}

function getExistingIds_(sheet, col) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return new Set();
  const values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  return new Set(values.map(r => String(r[0] || '').trim()).filter(Boolean));
}

function generateIdUnik_(prefix, existingIds) {
  existingIds = existingIds || new Set();
  const tz = Session.getScriptTimeZone() || 'Asia/Makassar';
  const tanggal = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
  const pola = new RegExp('^' + prefix + '-' + tanggal + '-(\\d{3,})$');
  let max = 0;

  Array.from(existingIds).forEach(function (id) {
    const match = String(id || '').match(pola);
    if (match) max = Math.max(max, Number(match[1]));
  });

  let nomor = max + 1;
  let id = prefix + '-' + tanggal + '-' + String(nomor).padStart(3, '0');

  while (existingIds.has(id)) {
    nomor++;
    id = prefix + '-' + tanggal + '-' + String(nomor).padStart(3, '0');
  }

  return id;
}

function buatIdBMN_(kodeBarang, nup) {
  const kode = String(kodeBarang || '').trim();
  const nomor = String(nup || '').trim();
  if (kode && nomor) return kode + '-' + nomor;
  return kode || nomor || '';
}

function cekDuplikatBMN_(sheet, kodeBarang, nup) {
  const kode = normalisasiTeks_(kodeBarang);
  const nomor = normalisasiTeks_(nup);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  const data = sheet.getRange(2, 1, lastRow - 1, 2).getDisplayValues();
  return data.some(function (row) {
    return normalisasiTeks_(row[0]) === kode && normalisasiTeks_(row[1]) === nomor;
  });
}


function findRowById_(sheet, idValue, kolomId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  const ids = sheet.getRange(2, kolomId, lastRow - 1, 1).getDisplayValues();
  const target = String(idValue || '').trim();

  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() === target) {
      return i + 2;
    }
  }

  return -1;
}

function ubahStatusById_(sheet, idValue, kolomStatus, statusBaru) {
  const id = String(idValue || '').trim();
  if (!id) throw new Error('ID data tidak valid. Muat ulang halaman lalu coba lagi.');

  validasiStatus_(statusBaru);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Data tidak ditemukan.');

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() === id) {
      sheet.getRange(i + 2, kolomStatus).setValue(statusBaru);
      return true;
    }
  }

  throw new Error('Data dengan ID ' + id + ' tidak ditemukan.');
}

function validasiStatus_(statusBaru) {
  const status = String(statusBaru || '').trim();
  const statusValid = ['Pending', 'ACC', 'Ditolak', 'Dipakai', 'Dikembalikan'];
  if (statusValid.indexOf(status) === -1) {
    throw new Error('Status tidak valid.');
  }
}

// --- HELPER TANGGAL, JAM, DAN TEKS ---
function parseTanggal_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const teks = String(value || '').trim();
  if (!teks) return null;

  let match = teks.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

  match = teks.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));

  const parsed = new Date(teks);
  if (!isNaN(parsed.getTime())) return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());

  return null;
}

function parseJamKeMenit_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value.getHours() * 60 + value.getMinutes();
  if (typeof value === 'number' && isFinite(value)) {
    if (value >= 0 && value < 1) return Math.round(value * 24 * 60);
    if (value >= 0 && value < 24) return Math.round(value * 60);
  }

  const teks = String(value || '').trim().toLowerCase();
  if (!teks) return null;

  const match = teks.match(/(\d{1,2})(?:[:.](\d{1,2}))?(?:[:.](\d{1,2}))?\s*(am|pm)?/i);
  if (!match) return null;

  let jam = Number(match[1]);
  const menit = Number(match[2] || 0);
  const ampm = match[4];

  if (ampm === 'pm' && jam < 12) jam += 12;
  if (ampm === 'am' && jam === 12) jam = 0;
  if (jam < 0 || jam > 23 || menit < 0 || menit > 59) return null;
  return jam * 60 + menit;
}

function buatDateTime_(tanggal, menit) {
  return new Date(tanggal.getFullYear(), tanggal.getMonth(), tanggal.getDate(), Math.floor(menit / 60), menit % 60, 0, 0);
}

function parseDateTimeLocal_(value) {
  const teks = String(value || '').trim();
  if (!teks) return null;
  const match = teks.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), 0, 0);
}

function formatTanggalInput_(tanggal) {
  const y = tanggal.getFullYear();
  const m = String(tanggal.getMonth() + 1).padStart(2, '0');
  const d = String(tanggal.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function formatMenitKeJam_(menit) {
  return String(Math.floor(menit / 60)).padStart(2, '0') + ':' + String(menit % 60).padStart(2, '0');
}

function normalisasiTeks_(value) {
  return String(value || '').toLowerCase().trim().replace(/\s+/g, ' ');
}
