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
const SHEET_MASTER_PEGAWAI = "Master_Pegawai";
const SHEET_MASTER_PEGAWAI_ALIAS = "Master Pegawai";
const SHEET_MASTER_KENDARAAN = "Master_Kendaraan";

const MASTER_KENDARAAN_DEFAULT = [
  ['KND-001', 'Toyota Avanza', 'B 2325 UUI', 'AKTIF', ''],
  ['KND-002', 'Toyota Avanza', 'B 2810 UYT', 'AKTIF', ''],
  ['KND-003', 'Toyota Avanza', 'B 2808 UYT', 'AKTIF', ''],
  ['KND-004', 'Toyota Avanza', 'B 2806 UYT', 'AKTIF', ''],
  ['KND-005', 'Hyundai H-1', 'B 1394 SQP', 'AKTIF', ''],
  ['KND-006', 'Isuzu ELF', 'DR 7409 J', 'AKTIF', ''],
  ['KND-007', 'Panther', 'DR 8128 AK', 'AKTIF', '']
];

// --- NOTIFIKASI WHATSAPP OPERATOR (FONNTE) ---
// Kredensial WAJIB disimpan di Script Properties, jangan ditulis di source code:
// FONNTE_TOKEN = token device Fonnte
// WA_OPERATOR  = nomor WhatsApp operator, disarankan format 628xxxxxxxxxx
const FONNTE_API_URL = 'https://api.fonnte.com/send';
const SHEET_NOTIFICATION_LOG = 'Notification_Log';
const NOTIFICATION_LOG_HEADERS = [
  'Timestamp',
  'Channel',
  'Event',
  'Target ID',
  'Penerima',
  'Status',
  'HTTP Code',
  'Provider Request ID',
  'Detail'
];

// --- ANTREAN APPROVAL WHATSAPP (FIFO / PERSISTEN) ---
// Sumber utama urutan approval operator. Disimpan di Sheet agar tidak hilang
// saat Apps Script cold start, cache ter-reset, atau deployment diperbarui.
const SHEET_WA_APPROVAL_QUEUE = 'WA_Approval_Queue';
const WA_APPROVAL_QUEUE_HEADERS = [
  'Timestamp Masuk',
  'ID Transaksi',
  'Jenis',
  'Peminjam',
  'Status Queue',
  'Tahap',
  'Data JSON',
  'Terakhir Update',
  'Detail'
];

// --- OPTIMASI LOAD DATA ---
// Batas default data yang dikirim ke frontend agar Web App tetap ringan.
const LIMIT_TAMPIL_USER = 50;
const LIMIT_TAMPIL_ADMIN = 100;
const CACHE_MASTER_DATA_SECONDS = 300; // 5 menit
const CACHE_KEY_MASTER_DATA = 'MASTER_DATA_BMN_V4';
const CACHE_KEY_MASTER_PEGAWAI = 'MASTER_PEGAWAI_NIP_V1';
const CACHE_MASTER_PEGAWAI_SECONDS = 300;
const CACHE_KEY_KENDARAAN_SNAPSHOT = 'KENDARAAN_AVAILABILITY_SNAPSHOT_V1';
const CACHE_KENDARAAN_SNAPSHOT_SECONDS = 45;

// --- BACKEND HARDENING ---
const SHEET_AUDIT_LOG = 'Audit_Log';
const AUDIT_LOG_HEADERS = [
  'Timestamp',
  'Request ID',
  'Actor',
  'Action',
  'Target ID',
  'Status Lama',
  'Status Baru',
  'Detail'
];
const MAX_FOTO_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_TEXT = {
  nama: 150,
  kegiatan: 250,
  tujuan: 250,
  lama: 100,
  pesertaJabatan: 500,
  keterangan: 1000,
  namaBmn: 250,
  merk: 150,
  lokasi: 200,
  pj: 150
};


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
  'getPegawaiByNip',
  'getKendaraanAvailabilitySnapshot',
  'getKetersediaanKendaraan',
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

const SIMANTAP_API_WEBHOOK_ACTIONS = [
  'prosesPerintahWaOperator'
];

function doPost(e) {
  let requestId = buatRequestId_();

  try {
    const raw = e && e.postData ? String(e.postData.contents || '') : '';
    if (!raw) throw new Error('Payload API kosong.');

    const payload = JSON.parse(raw);
    requestId = String(payload.requestId || '').trim() || requestId;

    const apiSecret = PropertiesService.getScriptProperties().getProperty('API_SHARED_SECRET');
    if (!apiSecret) {
      throw new Error('API_SHARED_SECRET belum dikonfigurasi pada Script Properties.');
    }

    if (String(payload.apiKey || '') !== String(apiSecret)) {
      return simantapJsonResponse_({
        ok: false,
        code: 'INVALID_API_KEY',
        error: 'API key tidak valid.',
        requestId: requestId
      });
    }

    const action = String(payload.action || '').trim();
    const args = Array.isArray(payload.args) ? payload.args : [];
    const adminAuthorized = payload.adminAuthorized === true;
    const webhookAuthorized = payload.webhookAuthorized === true;

    const isPublic = SIMANTAP_API_PUBLIC_ACTIONS.indexOf(action) !== -1;
    const isAdmin = SIMANTAP_API_ADMIN_ACTIONS.indexOf(action) !== -1;
    const isWebhook = SIMANTAP_API_WEBHOOK_ACTIONS.indexOf(action) !== -1;

    if (!isPublic && !isAdmin && !isWebhook) {
      return simantapJsonResponse_({
        ok: false,
        code: 'ACTION_NOT_ALLOWED',
        error: 'Action API tidak diizinkan: ' + action,
        requestId: requestId
      });
    }

    if (isAdmin && !adminAuthorized) {
      return simantapJsonResponse_({
        ok: false,
        code: 'ADMIN_REQUIRED',
        error: 'Sesi Administrator diperlukan.',
        requestId: requestId
      });
    }

    if (isWebhook && !webhookAuthorized) {
      return simantapJsonResponse_({
        ok: false,
        code: 'WEBHOOK_REQUIRED',
        error: 'Request webhook tidak terotorisasi.',
        requestId: requestId
      });
    }

    // Pemeliharaan rutin hanya boleh berasal dari sesi Administrator yang
    // sudah diverifikasi oleh Cloudflare Worker. Nilai sumber tidak dipercaya
    // hanya karena dikirim dari browser.
    if (action === 'simpanPemeliharaan' && args[0]) {
      const sumber = normalisasiTeks_(args[0].sumber || 'User');
      if (sumber === 'administrator' && !adminAuthorized) {
        return simantapJsonResponse_({
          ok: false,
          code: 'ADMIN_REQUIRED',
          error: 'Sesi Administrator diperlukan untuk pemeliharaan rutin.',
          requestId: requestId
        });
      }
    }

    const handlers = {
      verifikasiPin: verifikasiPin,
      getMasterDataOptimized: getMasterDataOptimized,
      getPegawaiByNip: getPegawaiByNip,
      getKendaraanAvailabilitySnapshot: getKendaraanAvailabilitySnapshot,
      getKetersediaanKendaraan: getKetersediaanKendaraan,
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
      simpanBMN: simpanBMN,
      prosesPerintahWaOperator: prosesPerintahWaOperator
    };

    const handler = handlers[action];
    if (typeof handler !== 'function') {
      return simantapJsonResponse_({
        ok: false,
        code: 'HANDLER_NOT_FOUND',
        error: 'Handler API tidak tersedia: ' + action,
        requestId: requestId
      });
    }

    const result = handler.apply(null, args);

    if (action === 'verifikasiPin' && result === true) {
      catatAuditAktivitas_({
        requestId: requestId,
        actor: 'Administrator',
        action: 'LOGIN_ADMIN',
        targetId: '-',
        statusLama: '-',
        statusBaru: '-',
        detail: 'Login Administrator berhasil.'
      });
    } else if (isAdmin || (action === 'simpanPemeliharaan' && args[0] && normalisasiTeks_(args[0].sumber || '') === 'administrator')) {
      catatAuditAktivitas_({
        requestId: requestId,
        actor: 'Administrator',
        action: action,
        targetId: ambilTargetAudit_(action, args, result),
        statusLama: ambilStatusLamaAudit_(result),
        statusBaru: ambilStatusBaruAudit_(action, args),
        detail: ambilDetailAudit_(action, args, result)
      });
    }

    return simantapJsonResponse_({ ok: true, result: result, requestId: requestId });
  } catch (err) {
    return simantapJsonResponse_({
      ok: false,
      code: kodeErrorBackend_(err),
      error: bersihkanPesanError_(err) || 'Terjadi kesalahan pada backend SIMANTAP BMN.',
      requestId: requestId
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
    fonnteTokenConfigured: !!props.getProperty('FONNTE_TOKEN'),
    waOperatorConfigured: !!props.getProperty('WA_OPERATOR'),
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

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetPegawai = ss.getSheetByName(SHEET_PEGAWAI);
  const sheetBmn = ss.getSheetByName(SHEET_DATA_BMN);

  const pegawai = sheetPegawai
    ? bacaKolomTerbatas_(sheetPegawai, 1)
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


// --- MASTER PEGAWAI / VALIDASI NIP ---
function getMasterPegawaiSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const kandidat = [SHEET_MASTER_PEGAWAI, SHEET_MASTER_PEGAWAI_ALIAS, SHEET_PEGAWAI];

  for (let i = 0; i < kandidat.length; i++) {
    const sheet = ss.getSheetByName(kandidat[i]);
    if (!sheet || sheet.getLastRow() < 1) continue;
    const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0];
    const map = buatHeaderMap_(headers);
    if (map['nip'] !== undefined && (map['nama lengkap'] !== undefined || map['nama'] !== undefined || map['nama pegawai'] !== undefined)) {
      return sheet;
    }
  }

  throw new Error('Master Pegawai belum tersedia. Impor sheet "Master Pegawai" yang berisi NIP dan Nama Lengkap ke Spreadsheet database SIMANTAP BMN.');
}

function buatHeaderMap_(headers) {
  const map = {};
  (headers || []).forEach(function(h, idx) {
    const key = normalisasiTeks_(h);
    if (key && map[key] === undefined) map[key] = idx;
  });
  return map;
}

function indexHeader_(map, aliases) {
  for (let i = 0; i < aliases.length; i++) {
    const idx = map[normalisasiTeks_(aliases[i])];
    if (idx !== undefined) return idx;
  }
  return -1;
}

function pastikanKolomWhatsappMasterPegawai_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  let map = buatHeaderMap_(headers);

  let idxWa = indexHeader_(map, ['No WhatsApp', 'Nomor WhatsApp', 'WhatsApp', 'WA']);
  let idxUpdateWa = indexHeader_(map, ['Terakhir Update WA', 'Update WhatsApp', 'Terakhir Diperbarui WA']);

  if (idxWa < 0) {
    idxWa = sheet.getLastColumn();
    sheet.getRange(1, idxWa + 1).setValue('No WhatsApp');
  }

  if (idxUpdateWa < 0) {
    idxUpdateWa = sheet.getLastColumn();
    sheet.getRange(1, idxUpdateWa + 1).setValue('Terakhir Update WA');
  }

  headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  map = buatHeaderMap_(headers);
  return {
    headerMap: map,
    nip: indexHeader_(map, ['NIP']),
    nama: indexHeader_(map, ['Nama Lengkap', 'Nama Pegawai', 'Nama']),
    jabatan: indexHeader_(map, ['Jabatan']),
    status: indexHeader_(map, ['Status']),
    whatsapp: indexHeader_(map, ['No WhatsApp', 'Nomor WhatsApp', 'WhatsApp', 'WA']),
    updateWhatsapp: indexHeader_(map, ['Terakhir Update WA', 'Update WhatsApp', 'Terakhir Diperbarui WA'])
  };
}

function getMasterPegawaiMap_(forceRefresh) {
  if (!forceRefresh) {
    try {
      const cached = CacheService.getScriptCache().get(CACHE_KEY_MASTER_PEGAWAI);
      if (cached) return JSON.parse(cached);
    } catch (e) {}
  }

  const sheet = getMasterPegawaiSheet_();
  const kolom = pastikanKolomWhatsappMasterPegawai_(sheet);
  const lastRow = sheet.getLastRow();
  const mapPegawai = {};

  if (lastRow >= 2) {
    const rows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
    rows.forEach(function(row, i) {
      const nip = String(row[kolom.nip] || '').replace(/\D/g, '');
      if (!nip) return;
      mapPegawai[nip] = {
        nip: nip,
        nama: String(row[kolom.nama] || '').trim(),
        jabatan: kolom.jabatan >= 0 ? String(row[kolom.jabatan] || '').trim() : '',
        status: kolom.status >= 0 ? String(row[kolom.status] || '').trim() : 'AKTIF',
        whatsapp: kolom.whatsapp >= 0 ? normalisasiNomorWaIndonesia_(row[kolom.whatsapp] || '') : '',
        row: i + 2
      };
    });
  }

  try {
    CacheService.getScriptCache().put(CACHE_KEY_MASTER_PEGAWAI, JSON.stringify(mapPegawai), CACHE_MASTER_PEGAWAI_SECONDS);
  } catch (e) {}

  return mapPegawai;
}

function clearMasterPegawaiCache_() {
  try { CacheService.getScriptCache().remove(CACHE_KEY_MASTER_PEGAWAI); } catch (e) {}
}

function cariPegawaiByNip_(nip) {
  const bersih = String(nip || '').replace(/\D/g, '');
  if (!/^\d{18}$/.test(bersih)) return null;
  return getMasterPegawaiMap_(false)[bersih] || null;
}

function statusMasterAktif_(value) {
  const status = normalisasiTeks_(value || 'aktif');
  return !status || status === 'aktif' || status === 'active';
}

function getPegawaiByNip(nip) {
  const bersih = String(nip || '').replace(/\D/g, '');
  if (!/^\d{18}$/.test(bersih)) {
    return { found: false, message: 'NIP harus terdiri dari 18 digit.' };
  }

  const pegawai = cariPegawaiByNip_(bersih);
  if (!pegawai) {
    return { found: false, message: 'NIP tidak ditemukan pada Master Pegawai.' };
  }

  if (!statusMasterAktif_(pegawai.status)) {
    return { found: false, message: 'Data pegawai ditemukan tetapi status pegawai tidak aktif.' };
  }

  return {
    found: true,
    nip: pegawai.nip,
    nama: pegawai.nama,
    jabatan: pegawai.jabatan || '',
    whatsappTerdaftar: !!pegawai.whatsapp,
    whatsappMasked: pegawai.whatsapp ? samarkanNomorWa_(pegawai.whatsapp) : ''
  };
}

function validasiIdentitasPeminjam_(form) {
  form = form || {};
  const nip = String(form.nip || '').replace(/\D/g, '');
  if (!/^\d{18}$/.test(nip)) throw new Error('NIP wajib diisi dengan 18 digit.');

  const pegawai = cariPegawaiByNip_(nip);
  if (!pegawai) throw new Error('NIP tidak ditemukan pada Master Pegawai.');
  if (!statusMasterAktif_(pegawai.status)) throw new Error('Pegawai dengan NIP tersebut tidak berstatus aktif.');

  const waTersimpan = normalisasiNomorWaIndonesia_(pegawai.whatsapp || '');
  const waInput = normalisasiNomorWaIndonesia_(form.whatsapp || '');
  const ubahWhatsapp = form.ubahWhatsapp === true || normalisasiTeks_(form.ubahWhatsapp) === 'true';

  let whatsapp = waTersimpan;
  let perluSimpanWhatsapp = false;

  if (!waTersimpan) {
    if (!waInput) throw new Error('Nomor WhatsApp belum terdaftar. Silakan isi nomor WhatsApp yang aktif.');
    whatsapp = waInput;
    perluSimpanWhatsapp = true;
  } else if (ubahWhatsapp) {
    if (!waInput) throw new Error('Nomor WhatsApp baru tidak valid.');
    whatsapp = waInput;
    perluSimpanWhatsapp = waInput !== waTersimpan;
  }

  return {
    nip: nip,
    nama: pegawai.nama,
    jabatan: pegawai.jabatan || '',
    whatsapp: whatsapp,
    perluSimpanWhatsapp: perluSimpanWhatsapp
  };
}

function simpanWhatsappPegawai_(nip, whatsapp) {
  const nomor = normalisasiNomorWaIndonesia_(whatsapp || '');
  if (!nomor) throw new Error('Nomor WhatsApp tidak valid.');

  const sheet = getMasterPegawaiSheet_();
  const kolom = pastikanKolomWhatsappMasterPegawai_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Master Pegawai masih kosong.');

  const values = sheet.getRange(2, kolom.nip + 1, lastRow - 1, 1).getDisplayValues();
  const target = String(nip || '').replace(/\D/g, '');
  let rowIndex = -1;
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').replace(/\D/g, '') === target) {
      rowIndex = i + 2;
      break;
    }
  }
  if (rowIndex < 2) throw new Error('NIP tidak ditemukan saat menyimpan nomor WhatsApp.');

  sheet.getRange(rowIndex, kolom.whatsapp + 1).setNumberFormat('@').setValue(nomor);
  if (kolom.updateWhatsapp >= 0) sheet.getRange(rowIndex, kolom.updateWhatsapp + 1).setValue(new Date());
  clearMasterPegawaiCache_();
  return nomor;
}

function whatsappPeminjamTerbaru_(nip, fallback) {
  const pegawai = cariPegawaiByNip_(nip);
  return normalisasiNomorWaIndonesia_((pegawai && pegawai.whatsapp) || fallback || '');
}

// --- DATA RINGKAS UNTUK FRONTEND ---
function getJadwalRingkas(tanggalAtauLimit, limit) {
  // Backward compatible:
  // - getJadwalRingkas(50)                    -> jadwal hari ini (cara lama)
  // - getJadwalRingkas('2026-10-05', 50)      -> jadwal tanggal yang dipilih user
  // Halaman Administrator tetap memakai getJadwalAdminRingkas() dan tidak terpengaruh.
  let tanggalTarget = '';
  let limitInput = limit;

  if (typeof tanggalAtauLimit === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(tanggalAtauLimit.trim())) {
    tanggalTarget = tanggalAtauLimit.trim();
  } else {
    limitInput = tanggalAtauLimit;
  }

  limitInput = batasiLimit_(limitInput, LIMIT_TAMPIL_USER);

  const data = getJadwal();
  const zona = Session.getScriptTimeZone() || 'Asia/Makassar';

  if (!tanggalTarget) {
    tanggalTarget = Utilities.formatDate(new Date(), zona, 'yyyy-MM-dd');
  } else {
    const parsedTarget = parseTanggal_(tanggalTarget);
    if (!parsedTarget || formatTanggalInput_(parsedTarget) !== tanggalTarget) {
      throw new Error('Tanggal jadwal tidak valid. Gunakan format YYYY-MM-DD.');
    }
  }

  const jadwalTanggal = data.filter(function(row) {
    const tanggal = parseTanggal_(row && row.tanggal);
    if (!tanggal) return false;
    return Utilities.formatDate(tanggal, zona, 'yyyy-MM-dd') === tanggalTarget;
  });

  jadwalTanggal.sort(function(a, b) {
    return nilaiUrutJadwal_(a) - nilaiUrutJadwal_(b);
  });

  return jadwalTanggal.slice(0, limitInput);
}

function getJadwalAdminRingkas(limit) {
  limit = batasiLimit_(limit, LIMIT_TAMPIL_ADMIN);
  return getJadwal(limit).reverse();
}

function getPemeliharaanRingkas(limit) {
  limit = batasiLimit_(limit, LIMIT_TAMPIL_USER);
  return getPemeliharaan(limit).reverse();
}

function getPemeliharaanAdminRingkas(limit) {
  limit = batasiLimit_(limit, LIMIT_TAMPIL_ADMIN);
  return getPemeliharaan(limit).reverse();
}

function getPinjamKendaraanRingkas(limit) {
  limit = batasiLimit_(limit, LIMIT_TAMPIL_USER);
  return getPinjamKendaraan(limit).reverse().map(function(row) {
    return {
      idPinjam: row.idPinjam,
      tanggalPengajuan: row.tanggalPengajuan,
      nama: row.nama,
      kegiatan: row.kegiatan,
      tujuan: row.tujuan,
      lama: row.lama,
      batasKembali: row.batasKembali,
      status: row.status,
      keteranganAdmin: row.keteranganAdmin,
      jenisMobil: row.jenisMobil,
      mulaiPenggunaan: row.mulaiPenggunaan,
      mobilDitugaskan: row.mobilDitugaskan
    };
  });
}

function getPinjamKendaraanAdminRingkas(limit) {
  limit = batasiLimit_(limit, LIMIT_TAMPIL_ADMIN);
  const rows = getPinjamKendaraan(limit).reverse();
  const semua = getPinjamKendaraan();
  const unit = getMasterKendaraan_();

  return rows.map(function(row) {
    const opsi = unit.filter(function(item) {
      if (normalisasiTeks_(item.jenisMobil) !== normalisasiTeks_(row.jenisMobil)) return false;
      return !cekBentrokUnitKendaraanDariDaftar_(item.label, row.mulaiPenggunaan, row.batasKembali, row.idPinjam, semua);
    });
    row.opsiMobilDitugaskan = opsi.map(function(item) { return item.label; });
    return row;
  });
}

function getPinjamSarprasRingkas(limit) {
  limit = batasiLimit_(limit, LIMIT_TAMPIL_USER);
  return getPinjamSarpras(limit).reverse();
}

function getPinjamSarprasAdminRingkas(limit) {
  limit = batasiLimit_(limit, LIMIT_TAMPIL_ADMIN);
  return getPinjamSarpras(limit).reverse();
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
function getJadwal(limit) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_JADWAL);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  let startRow = 2;
  let numRows = lastRow - 1;

  if (limit) {
    numRows = Math.min(limit, lastRow - 1);
    startRow = Math.max(2, lastRow - numRows + 1);
  }

  const data = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getDisplayValues();
  const jadwalAktif = [];

  for (let i = 0; i < data.length; i++) {
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
      pesertaJabatan: data[i][10] || '-',
      keteranganAdmin: data[i][13] || ''
    });
  }

  return jadwalAktif;
}

function simpanBooking(form) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  let hasilValidasi = null;
  let identitas = null;
  let idBooking = '';
  let pesanSukses = '';

  try {
    const sheet = getOrCreateJadwalSheet_();
    pastikanIdJadwal_();
    pastikanKolomJadwalTambahan_();

    identitas = validasiIdentitasPeminjam_(form);
    const formValid = Object.assign({}, form || {}, { nama: identitas.nama });
    hasilValidasi = validasiBookingRuangan_(sheet, formValid);
    idBooking = generateIdUnik_("JDW", getExistingIds_(sheet, 1));

    if (identitas.perluSimpanWhatsapp) simpanWhatsappPegawai_(identitas.nip, identitas.whatsapp);

    sheet.appendRow([
      idBooking,
      hasilValidasi.tanggalInput,
      hasilValidasi.ruangan,
      hasilValidasi.jamMulai,
      hasilValidasi.jamSelesai,
      identitas.nama,
      "Pending",
      hasilValidasi.bmnDipinjam,
      hasilValidasi.namaKegiatan,
      hasilValidasi.jumlahPeserta,
      hasilValidasi.pesertaJabatan,
      identitas.nip,
      identitas.whatsapp,
      ''
    ]);

    hasilValidasi.nip = identitas.nip;
    pesanSukses = "SUKSES: Pengajuan pinjam ruangan terkirim dengan ID " + idBooking + ". Menunggu ACC.";
  } finally {
    lock.releaseLock();
  }

  try {
    const notifWa = kirimNotifWhatsAppAman_(
      'PENGAJUAN_PINJAM_RUANGAN',
      idBooking,
      buatPesanNotifPinjamRuangan_(idBooking, hasilValidasi)
    );
    if (notifWa && notifWa.ok) simpanKonteksWaOperator_({ id: idBooking, tipe: 'booking', mode: 'APPROVAL' });
  } catch (e) {
    console.error('Penyusunan/pengiriman notifikasi ruangan gagal: ' + bersihkanPesanError_(e));
  }

  return pesanSukses;
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
    throw new Error('Data pinjam ruangan belum lengkap. Pastikan tanggal, ruangan, jam, NIP peminjam, nama kegiatan, jumlah peserta, dan peserta/jabatan sudah diisi.');
  }

  const ruanganValid = ['Ruang Aula', 'Ruang Zona Integritas', 'Ruang Transit'];
  if (ruanganValid.indexOf(ruangan) === -1) throw new Error('Ruangan yang dipilih tidak valid.');

  const jumlah = Number(jumlahPeserta);
  if (!Number.isInteger(jumlah) || jumlah < 1) throw new Error('Jumlah peserta harus berupa bilangan bulat minimal 1.');
  if (jumlah > 100000) throw new Error('Jumlah peserta terlalu besar.');

  validasiPanjangTeks_(nama, 'Nama peminjam', MAX_TEXT.nama);
  validasiPanjangTeks_(namaKegiatan, 'Nama kegiatan', MAX_TEXT.kegiatan);
  validasiPanjangTeks_(pesertaJabatan, 'Peserta/Jabatan', MAX_TEXT.pesertaJabatan);

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

function ubahStatusBooking(idBooking, statusBaru, keteranganAdmin, sumberAksi) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  let dataNotif = null;
  let perubahan = null;
  try {
    const sheet = getOrCreateJadwalSheet_();
    pastikanIdJadwal_();
    pastikanKolomJadwalTambahan_();
    const rowIndex = findRowById_(sheet, idBooking, 1);
    if (rowIndex < 2) throw new Error('Data pinjam ruangan dengan ID ' + idBooking + ' tidak ditemukan.');

    const ket = String(keteranganAdmin || '').trim();
    if (ket.length > 500) throw new Error('Keterangan admin maksimal 500 karakter.');
    if (ket) sheet.getRange(rowIndex, 14).setValue(ket);

    const row = sheet.getRange(rowIndex, 1, 1, Math.max(sheet.getLastColumn(), 14)).getDisplayValues()[0];
    perubahan = ubahStatusById_(sheet, idBooking, 7, statusBaru, 'booking');
    dataNotif = {
      idBooking: row[0], tanggal: row[1], ruangan: row[2], mulai: row[3], selesai: row[4],
      nama: row[5], status: perubahan.statusBaru, namaKegiatan: row[8], nip: row[11],
      whatsapp: whatsappPeminjamTerbaru_(row[11], row[12]), keteranganAdmin: ket || row[13] || ''
    };
  } finally {
    lock.releaseLock();
  }

  if (dataNotif && (dataNotif.status === 'ACC' || dataNotif.status === 'Ditolak')) {
    kirimNotifStatusPeminjamAman_(
      'STATUS_PINJAM_RUANGAN',
      dataNotif.idBooking,
      dataNotif.whatsapp,
      buatPesanStatusClientPinjamRuangan_(dataNotif),
      dataNotif.status === 'ACC' ? buatPesanDaftarKerjaRuanganGrup_() : ''
    );
    sinkronkanWaQueueSetelahStatusWeb_(dataNotif.idBooking, dataNotif.status, sumberAksi);
  }
  return 'Status pinjam ruangan ' + idBooking + ' berhasil diubah dari ' + perubahan.statusLama + ' menjadi ' + perubahan.statusBaru + '.';
}

// --- PINJAM KENDARAAN ---
function getPinjamKendaraan(limit) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PINJAM_KENDARAAN);
  if (!sheet) return [];
  pastikanKolomPinjamKendaraanTambahan_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  let startRow = 2;
  let numRows = lastRow - 1;
  if (limit) {
    numRows = Math.min(limit, lastRow - 1);
    startRow = Math.max(2, lastRow - numRows + 1);
  }

  const data = sheet.getRange(startRow, 1, numRows, Math.max(sheet.getLastColumn(), 14)).getDisplayValues();
  const hasil = [];

  for (let i = 0; i < data.length; i++) {
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
      keteranganAdmin: data[i][8] || '',
      nip: data[i][9] || '',
      jenisMobil: data[i][11] || '',
      mulaiPenggunaan: data[i][12] || '',
      mobilDitugaskan: data[i][13] || ''
    });
  }

  return hasil;
}

function getOrCreateMasterKendaraanSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_MASTER_KENDARAAN);
  const headers = ['ID Kendaraan', 'Jenis Mobil', 'Nomor Polisi', 'Status', 'Keterangan'];

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_MASTER_KENDARAAN);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    pastikanHeaderMinimal_(sheet, headers);
  }

  const existing = sheet.getLastRow() >= 2
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getDisplayValues()
    : [];
  const nomorAda = new Set(existing.map(function(row) { return normalisasiTeks_(row[2]); }).filter(Boolean));
  const tambahan = MASTER_KENDARAAN_DEFAULT.filter(function(row) { return !nomorAda.has(normalisasiTeks_(row[2])); });
  if (tambahan.length) sheet.getRange(sheet.getLastRow() + 1, 1, tambahan.length, 5).setValues(tambahan);
  return sheet;
}

function getMasterKendaraan_() {
  const sheet = getOrCreateMasterKendaraanSheet_();
  if (sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getDisplayValues();
  return rows.filter(function(row) {
    return row[1] && row[2] && statusMasterAktif_(row[3]);
  }).map(function(row) {
    const jenisMobil = String(row[1] || '').trim();
    const nomorPolisi = String(row[2] || '').trim();
    return {
      id: String(row[0] || '').trim(),
      jenisMobil: jenisMobil,
      nomorPolisi: nomorPolisi,
      label: jenisMobil + ' — ' + nomorPolisi
    };
  });
}

// Snapshot ringan untuk frontend. Dipanggil sekali ketika modul kendaraan dibuka,
// lalu perhitungan ketersediaan dilakukan lokal di browser agar perubahan tanggal/jam
// tidak memicu round-trip Worker -> Apps Script -> Sheet setiap kali.
function getKendaraanAvailabilitySnapshot(forceRefresh) {
  const cache = CacheService.getScriptCache();

  if (!forceRefresh) {
    try {
      const cached = cache.get(CACHE_KEY_KENDARAAN_SNAPSHOT);
      if (cached) return JSON.parse(cached);
    } catch (e) {
      // Cache hanya akselerator. Jika gagal, baca sumber data langsung.
    }
  }

  const units = getMasterKendaraan_().map(function(item) {
    return {
      id: item.id,
      jenisMobil: item.jenisMobil,
      nomorPolisi: item.nomorPolisi,
      label: item.label
    };
  });

  // Hanya kirim reservasi yang benar-benar memblokir unit. Data identitas peminjam
  // tidak ikut dikirim karena tidak diperlukan untuk menghitung availability.
  const reservations = [];
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PINJAM_KENDARAAN);
  if (sheet && sheet.getLastRow() >= 2) {
    pastikanKolomPinjamKendaraanTambahan_(sheet);
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), 14)).getDisplayValues();
    rows.forEach(function(row) {
      const status = normalisasiTeks_(row[7] || '');
      const mobilDitugaskan = String(row[13] || '').trim();
      const mulai = String(row[12] || '').trim();
      const selesai = String(row[6] || '').trim();

      if (!status || status.includes('pending') || status.includes('tolak') || status.includes('dikembalikan')) return;
      if (!mobilDitugaskan || !mulai || !selesai) return;

      reservations.push({
        idPinjam: String(row[0] || '').trim(),
        mulaiPenggunaan: mulai,
        batasKembali: selesai,
        mobilDitugaskan: mobilDitugaskan
      });
    });
  }

  const result = {
    generatedAt: new Date().toISOString(),
    units: units,
    reservations: reservations
  };

  try {
    cache.put(CACHE_KEY_KENDARAAN_SNAPSHOT, JSON.stringify(result), CACHE_KENDARAAN_SNAPSHOT_SECONDS);
  } catch (e) {
    // Abaikan kegagalan cache; result tetap dikembalikan ke frontend.
  }

  return result;
}

function clearKendaraanAvailabilityCache_() {
  try {
    CacheService.getScriptCache().remove(CACHE_KEY_KENDARAAN_SNAPSHOT);
  } catch (e) {
    // Cache tidak memengaruhi validitas transaksi.
  }
}

function getKetersediaanKendaraan(mulaiPenggunaan, batasKembali) {
  const unit = getMasterKendaraan_();
  const mulai = String(mulaiPenggunaan || '').trim();
  const selesai = String(batasKembali || '').trim();
  let semuaPinjaman = [];

  if (mulai || selesai) {
    validasiRentangKendaraan_(mulai, selesai);
    semuaPinjaman = getPinjamKendaraan();
  }

  const map = {};
  unit.forEach(function(item) {
    if (!map[item.jenisMobil]) map[item.jenisMobil] = { jenisMobil: item.jenisMobil, total: 0, tersedia: 0 };
    map[item.jenisMobil].total++;
    const bentrok = mulai && selesai
      ? cekBentrokUnitKendaraanDariDaftar_(item.label, mulai, selesai, '', semuaPinjaman)
      : false;
    if (!bentrok) map[item.jenisMobil].tersedia++;
  });

  return Object.keys(map).sort().map(function(key) { return map[key]; });
}

function validasiRentangKendaraan_(mulaiPenggunaan, batasKembali) {
  const mulai = parseDateTimeLocal_(mulaiPenggunaan);
  const selesai = parseDateTimeLocal_(batasKembali);
  if (!mulai || !selesai) throw new Error('Tanggal/waktu penggunaan kendaraan tidak valid.');
  if (selesai <= mulai) throw new Error('Batas kembali kendaraan harus setelah waktu mulai penggunaan.');
  if (mulai < new Date()) throw new Error('Waktu mulai penggunaan kendaraan tidak boleh berada di masa lalu.');
  return { mulai: mulai, selesai: selesai };
}

function cariBentrokUnitKendaraanDariDaftar_(unitLabel, mulaiInput, selesaiInput, excludeId, daftar) {
  if (!unitLabel || !mulaiInput || !selesaiInput) return null;

  const mulai = parseDateTimeLocal_(mulaiInput);
  const selesai = parseDateTimeLocal_(selesaiInput);
  if (!mulai || !selesai || selesai <= mulai) return null;

  const targetUnit = normalisasiTeks_(unitLabel);

  const bentrok = (daftar || []).find(function(row) {
    if (excludeId && String(row.idPinjam || '') === String(excludeId)) return false;

    const status = normalisasiTeks_(row.status || '');
    if (!status || status.includes('pending') || status.includes('tolak') || status.includes('dikembalikan')) {
      return false;
    }

    if (normalisasiTeks_(row.mobilDitugaskan || '') !== targetUnit) return false;

    const mulaiLama = parseDateTimeLocal_(row.mulaiPenggunaan || '');
    const selesaiLama = parseDateTimeLocal_(row.batasKembali || '');
    if (!mulaiLama || !selesaiLama || selesaiLama <= mulaiLama) return false;

    return mulai < selesaiLama && selesai > mulaiLama;
  });

  return bentrok || null;
}

function cekBentrokUnitKendaraanDariDaftar_(unitLabel, mulaiInput, selesaiInput, excludeId, daftar) {
  return !!cariBentrokUnitKendaraanDariDaftar_(
    unitLabel,
    mulaiInput,
    selesaiInput,
    excludeId,
    daftar
  );
}

function auditBentrokKendaraanAktifSekarang() {
  const sekarangMs = new Date().getTime();
  const semua = getPinjamKendaraan();
  const kandidat = [];

  semua.forEach(function(row) {
    const status = normalisasiTeks_(row.status || '');
    if (!status || status.includes('pending') || status.includes('tolak') || status.includes('dikembalikan')) {
      return;
    }
    if (!String(row.mobilDitugaskan || '').trim()) return;

    const mulai = parseDateTimeLocal_(row.mulaiPenggunaan || '');
    const selesai = parseDateTimeLocal_(row.batasKembali || '');
    if (!mulai || !selesai || selesai <= mulai) return;

    kandidat.push({
      row: row,
      unitKey: normalisasiTeks_(row.mobilDitugaskan),
      mulai: mulai,
      selesai: selesai
    });
  });

  const berlangsung = [];
  const akanDatang = [];
  const historis = [];

  for (let i = 0; i < kandidat.length; i++) {
    for (let j = i + 1; j < kandidat.length; j++) {
      const a = kandidat[i];
      const b = kandidat[j];
      if (a.unitKey !== b.unitKey) continue;
      if (!(a.mulai < b.selesai && a.selesai > b.mulai)) continue;

      const overlapMulai = a.mulai.getTime() >= b.mulai.getTime() ? a.mulai : b.mulai;
      const overlapSelesai = a.selesai.getTime() <= b.selesai.getTime() ? a.selesai : b.selesai;
      const overlapMulaiMs = overlapMulai.getTime();
      const overlapSelesaiMs = overlapSelesai.getTime();

      let kategori = 'HISTORIS';
      if (overlapSelesaiMs > sekarangMs) {
        kategori = overlapMulaiMs <= sekarangMs ? 'SEDANG_BERLANGSUNG' : 'AKAN_DATANG';
      }

      const entri = {
        sortMulaiMs: overlapMulaiMs,
        sortSelesaiMs: overlapSelesaiMs,
        item: {
          kategori: kategori,
          unit: a.row.mobilDitugaskan,
          overlapMulai: formatDateTimeLocalIndonesia_(overlapMulai),
          overlapSelesai: formatDateTimeLocalIndonesia_(overlapSelesai),
          transaksi1: {
            id: a.row.idPinjam,
            nama: a.row.nama,
            status: a.row.status,
            mulai: a.row.mulaiPenggunaan,
            selesai: a.row.batasKembali
          },
          transaksi2: {
            id: b.row.idPinjam,
            nama: b.row.nama,
            status: b.row.status,
            mulai: b.row.mulaiPenggunaan,
            selesai: b.row.batasKembali
          }
        }
      };

      if (kategori === 'SEDANG_BERLANGSUNG') berlangsung.push(entri);
      else if (kategori === 'AKAN_DATANG') akanDatang.push(entri);
      else historis.push(entri);
    }
  }

  const urutAsc = function(x, y) {
    return (x.sortMulaiMs - y.sortMulaiMs) || (x.sortSelesaiMs - y.sortSelesaiMs);
  };
  berlangsung.sort(urutAsc);
  akanDatang.sort(urutAsc);
  historis.sort(function(x, y) {
    return (y.sortSelesaiMs - x.sortSelesaiMs) || (y.sortMulaiMs - x.sortMulaiMs);
  });

  const bentrok = berlangsung.concat(akanDatang).map(function(entry) { return entry.item; });
  const bentrokHistoris = historis.map(function(entry) { return entry.item; });

  const hasil = {
    ok: bentrok.length === 0,
    jumlahBentrok: bentrok.length,
    jumlahHistoris: bentrokHistoris.length,
    bentrok: bentrok,
    bentrokHistoris: bentrokHistoris
  };

  Logger.log(JSON.stringify(hasil, null, 2));
  return hasil;
}

function hitungDurasiKendaraan_(mulaiInput, selesaiInput) {
  const mulai = parseDateTimeLocal_(mulaiInput);
  const selesai = parseDateTimeLocal_(selesaiInput);
  if (!mulai || !selesai || selesai <= mulai) return '-';
  let menit = Math.round((selesai.getTime() - mulai.getTime()) / 60000);
  const hari = Math.floor(menit / 1440); menit -= hari * 1440;
  const jam = Math.floor(menit / 60); menit -= jam * 60;
  const bagian = [];
  if (hari) bagian.push(hari + ' hari');
  if (jam) bagian.push(jam + ' jam');
  if (menit || !bagian.length) bagian.push(menit + ' menit');
  return bagian.join(' ');
}

function simpanPinjamKendaraan(form) {
  return simpanPinjamUmum_(SHEET_PINJAM_KENDARAAN, getOrCreatePinjamKendaraanSheet_(), 'KND', form, 'kendaraan');
}

function ubahStatusKendaraan(idPinjam, statusBaru, mobilDitugaskan, keteranganAdmin, sumberAksi) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  let perubahan = null;
  let dataNotif = null;
  try {
    const sheet = getOrCreatePinjamKendaraanSheet_();
    pastikanKolomPinjamKendaraanTambahan_(sheet);
    const rowIndex = findRowById_(sheet, idPinjam, 1);
    if (rowIndex < 2) throw new Error('Data pinjam kendaraan dengan ID ' + idPinjam + ' tidak ditemukan.');

    const row = sheet.getRange(rowIndex, 1, 1, Math.max(sheet.getLastColumn(), 14)).getDisplayValues()[0];
    const ket = String(keteranganAdmin || '').trim();
    if (ket.length > 500) throw new Error('Keterangan admin maksimal 500 karakter.');

    if (String(statusBaru || '').trim() === 'ACC') {
      const dataBaruKendaraan = !!(String(row[11] || '').trim() && String(row[12] || '').trim() && String(row[6] || '').trim());
      if (dataBaruKendaraan) {
        const unitLabel = String(mobilDitugaskan || '').trim();
        if (!unitLabel) throw new Error('Pilih mobil yang ditugaskan sebelum ACC.');
        const master = getMasterKendaraan_();
        const unit = master.find(function(item) { return normalisasiTeks_(item.label) === normalisasiTeks_(unitLabel); });
        if (!unit) throw new Error('Mobil yang dipilih tidak ditemukan pada Master_Kendaraan.');
        if (normalisasiTeks_(unit.jenisMobil) !== normalisasiTeks_(row[11])) throw new Error('Mobil yang ditugaskan harus sesuai jenis mobil yang diminta.');

        const semua = getPinjamKendaraan();
        const bentrok = cariBentrokUnitKendaraanDariDaftar_(
          unit.label,
          row[12],
          row[6],
          idPinjam,
          semua
        );

        if (bentrok) {
          throw new Error(
            'Mobil ' + unit.label +
            ' bentrok dengan ' + (bentrok.idPinjam || 'transaksi lain') +
            ' (' + formatDateTimeLocalIndonesia_(bentrok.mulaiPenggunaan) +
            ' s.d. ' + formatDateTimeLocalIndonesia_(bentrok.batasKembali) +
            '). Pilih unit lain.'
          );
        }

        sheet.getRange(rowIndex, 14).setValue(unit.label);
      }
      // Data lama sebelum fitur jenis/unit kendaraan tetap dapat di-ACC tanpa migrasi paksa.
    }

    if (ket) sheet.getRange(rowIndex, 9).setValue(ket);
    perubahan = ubahStatusById_(sheet, idPinjam, 8, statusBaru, 'kendaraan');
    const fresh = sheet.getRange(rowIndex, 1, 1, 14).getDisplayValues()[0];
    dataNotif = {
      idPinjam: fresh[0], nama: fresh[2], kegiatan: fresh[3], tujuan: fresh[4], lama: fresh[5],
      batasKembali: fresh[6], status: perubahan.statusBaru, keteranganAdmin: fresh[8] || '', nip: fresh[9],
      whatsapp: whatsappPeminjamTerbaru_(fresh[9], fresh[10]), jenisMobil: fresh[11] || '',
      mulaiPenggunaan: fresh[12] || '', mobilDitugaskan: fresh[13] || ''
    };
  } finally {
    lock.releaseLock();
  }

  // Status/penetapan unit dapat mengubah availability. Cache snapshot harus dibuang
  // sebelum request berikutnya agar frontend mendapat kondisi terbaru.
  if (perubahan) clearKendaraanAvailabilityCache_();

  if (dataNotif && (dataNotif.status === 'ACC' || dataNotif.status === 'Ditolak')) {
    kirimNotifStatusPeminjamAman_(
      'STATUS_PINJAM_KENDARAAN',
      dataNotif.idPinjam,
      dataNotif.whatsapp,
      buatPesanStatusClientPinjamKendaraan_(dataNotif),
      dataNotif.status === 'ACC' ? buatPesanDaftarKerjaKendaraanGrup_() : ''
    );
    sinkronkanWaQueueSetelahStatusWeb_(dataNotif.idPinjam, dataNotif.status, sumberAksi);
  }
  return 'Status pinjam kendaraan ' + idPinjam + ' berhasil diubah dari ' + perubahan.statusLama + ' menjadi ' + perubahan.statusBaru + '.';
}

function updateKeteranganKendaraan(idPinjam, keteranganAdmin) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreatePinjamKendaraanSheet_();
    const id = String(idPinjam || '').trim();
    const ket = String(keteranganAdmin || '').trim();
    if (!id) throw new Error('ID pinjam kendaraan tidak valid.');
    if (ket.length > 500) throw new Error('Keterangan admin terlalu panjang. Maksimal 500 karakter.');
    const rowIndex = findRowById_(sheet, id, 1);
    if (rowIndex < 2) throw new Error('Data pinjam kendaraan dengan ID ' + id + ' tidak ditemukan.');
    sheet.getRange(rowIndex, 9).setValue(ket);
    return 'Keterangan admin untuk pinjam kendaraan ' + id + ' berhasil disimpan.';
  } finally {
    lock.releaseLock();
  }
}

// --- PINJAM SARPRAS ---
function getPinjamSarpras(limit) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PINJAM_SARPRAS);
  if (!sheet) return [];
  pastikanKolomPinjamSarprasTambahan_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  let startRow = 2;
  let numRows = lastRow - 1;
  if (limit) {
    numRows = Math.min(limit, lastRow - 1);
    startRow = Math.max(2, lastRow - numRows + 1);
  }

  const data = sheet.getRange(startRow, 1, numRows, Math.max(sheet.getLastColumn(), 12)).getDisplayValues();
  const hasil = [];
  for (let i = 0; i < data.length; i++) {
    if (!data[i].join('').trim()) continue;
    hasil.push({
      idPinjam: data[i][0], tanggalPengajuan: data[i][1], nama: data[i][2], kegiatan: data[i][3],
      tempat: data[i][4], jenisBarang: data[i][5], lama: data[i][6], batasKembali: data[i][7],
      status: data[i][8], keteranganAdmin: data[i][11] || ''
    });
  }
  return hasil;
}

function simpanPinjamSarpras(form) {
  form = form || {};
  form.tujuan = form.tempat || form.tujuan || '';
  return simpanPinjamUmum_(SHEET_PINJAM_SARPRAS, getOrCreatePinjamSarprasSheet_(), 'SPR', form, 'sarpras');
}

function ubahStatusSarpras(idPinjam, statusBaru, keteranganAdmin, sumberAksi) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  let perubahan = null;
  let dataNotif = null;
  try {
    const sheet = getOrCreatePinjamSarprasSheet_();
    pastikanKolomPinjamSarprasTambahan_(sheet);
    const rowIndex = findRowById_(sheet, idPinjam, 1);
    if (rowIndex < 2) throw new Error('Data pinjam sarpras dengan ID ' + idPinjam + ' tidak ditemukan.');
    const ket = String(keteranganAdmin || '').trim();
    if (ket.length > 500) throw new Error('Keterangan admin maksimal 500 karakter.');
    if (ket) sheet.getRange(rowIndex, 12).setValue(ket);

    perubahan = ubahStatusById_(sheet, idPinjam, 9, statusBaru, 'sarpras');
    const row = sheet.getRange(rowIndex, 1, 1, 12).getDisplayValues()[0];
    dataNotif = {
      idPinjam: row[0], nama: row[2], kegiatan: row[3], tujuan: row[4], jenisBarang: row[5], lama: row[6],
      batasKembali: row[7], status: perubahan.statusBaru, nip: row[9],
      whatsapp: whatsappPeminjamTerbaru_(row[9], row[10]), keteranganAdmin: row[11] || ''
    };
  } finally {
    lock.releaseLock();
  }

  if (dataNotif && (dataNotif.status === 'ACC' || dataNotif.status === 'Ditolak')) {
    kirimNotifStatusPeminjamAman_(
      'STATUS_PINJAM_SARPRAS',
      dataNotif.idPinjam,
      dataNotif.whatsapp,
      buatPesanStatusClientPinjamSarpras_(dataNotif),
      ''
    );
    sinkronkanWaQueueSetelahStatusWeb_(dataNotif.idPinjam, dataNotif.status, sumberAksi);
  }
  return 'Status pinjam sarpras ' + idPinjam + ' berhasil diubah dari ' + perubahan.statusLama + ' menjadi ' + perubahan.statusBaru + '.';
}

function simpanPinjamUmum_(sheetName, sheet, prefix, form, tipe) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  let dataNotifikasi = null;
  let pesanSukses = '';

  try {
    form = form || {};
    const identitas = validasiIdentitasPeminjam_(form);
    const nama = identitas.nama;
    const kegiatan = String(form.kegiatan || '').trim();
    const tujuan = String(form.tujuan || '').trim();
    const jenisBarang = String(form.jenisBarang || '').trim();
    let lama = String(form.lama || '').trim();
    const batasKembali = String(form.batasKembali || '').trim();
    const jenisMobil = String(form.jenisMobil || '').trim();
    const mulaiPenggunaan = String(form.mulaiPenggunaan || '').trim();

    if (!kegiatan || !tujuan || !batasKembali) {
      throw new Error('Data pengajuan belum lengkap. Pastikan NIP pemohon, kegiatan, tujuan/tempat, dan batas kembali sudah diisi.');
    }
    if (tipe === 'sarpras' && (!jenisBarang || !lama)) {
      throw new Error('Jenis barang dan lama penggunaan sarpras wajib diisi.');
    }

    if (tipe === 'kendaraan') {
      if (!jenisMobil || !mulaiPenggunaan) throw new Error('Jenis mobil dan waktu mulai penggunaan kendaraan wajib diisi.');
      validasiRentangKendaraan_(mulaiPenggunaan, batasKembali);
      lama = hitungDurasiKendaraan_(mulaiPenggunaan, batasKembali);
      const master = getMasterKendaraan_();
      const unitJenis = master.filter(function(item) { return normalisasiTeks_(item.jenisMobil) === normalisasiTeks_(jenisMobil); });
      if (!unitJenis.length) throw new Error('Jenis mobil yang dipilih tidak tersedia pada Master_Kendaraan.');
      const semua = getPinjamKendaraan();
      const tersedia = unitJenis.filter(function(item) { return !cekBentrokUnitKendaraanDariDaftar_(item.label, mulaiPenggunaan, batasKembali, '', semua); }).length;
      if (tersedia < 1) throw new Error('Tidak ada ' + jenisMobil + ' yang tersedia pada rentang waktu tersebut. Silakan pilih waktu atau jenis mobil lain.');
    } else {
      const batas = parseDateTimeLocal_(batasKembali);
      if (!batas || batas < new Date()) throw new Error('Batas kembali tidak boleh berada di masa lalu.');
    }

    validasiPanjangTeks_(nama, 'Nama peminjam', MAX_TEXT.nama);
    validasiPanjangTeks_(kegiatan, 'Kegiatan', MAX_TEXT.kegiatan);
    validasiPanjangTeks_(tujuan, 'Tujuan/Tempat', MAX_TEXT.tujuan);
    validasiPanjangTeks_(lama, 'Lama penggunaan', MAX_TEXT.lama);
    if (jenisBarang) validasiPanjangTeks_(jenisBarang, 'Jenis barang', 150);
    if (jenisMobil) validasiPanjangTeks_(jenisMobil, 'Jenis mobil', 100);

    if (cekDuplikatPengajuanUmum_(sheet, tipe, {
      nama: nama, kegiatan: kegiatan, tujuan: tujuan, jenisBarang: jenisBarang,
      lama: lama, batasKembali: batasKembali, jenisMobil: jenisMobil, mulaiPenggunaan: mulaiPenggunaan
    })) {
      throw new Error('Pengajuan yang sama sudah tercatat dan belum ditolak. Hindari pengiriman ulang pengajuan yang sama.');
    }

    if (identitas.perluSimpanWhatsapp) simpanWhatsappPegawai_(identitas.nip, identitas.whatsapp);

    const idPinjam = generateIdUnik_(prefix, getExistingIds_(sheet, 1));
    const tanggalPengajuan = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Makassar', 'yyyy-MM-dd HH:mm');

    if (tipe === 'kendaraan') {
      pastikanKolomPinjamKendaraanTambahan_(sheet);
      sheet.appendRow([idPinjam, tanggalPengajuan, nama, kegiatan, tujuan, lama, batasKembali, 'Pending', '', identitas.nip, identitas.whatsapp, jenisMobil, mulaiPenggunaan, '']);
      dataNotifikasi = { idPinjam, nip: identitas.nip, nama, kegiatan, tujuan, jenisMobil, mulaiPenggunaan, lama, batasKembali };
      pesanSukses = 'SUKSES: Pengajuan pinjam kendaraan terkirim dengan ID ' + idPinjam + '. Menunggu ACC.';
    } else {
      pastikanKolomPinjamSarprasTambahan_(sheet);
      sheet.appendRow([idPinjam, tanggalPengajuan, nama, kegiatan, tujuan, jenisBarang, lama, batasKembali, 'Pending', identitas.nip, identitas.whatsapp, '']);
      dataNotifikasi = { idPinjam, nip: identitas.nip, nama, kegiatan, tujuan, jenisBarang, lama, batasKembali };
      pesanSukses = 'SUKSES: Pengajuan pinjam sarpras terkirim dengan ID ' + idPinjam + '. Menunggu ACC.';
    }
  } finally {
    lock.releaseLock();
  }

  try {
    if (tipe === 'kendaraan') {
      const notifWa = kirimNotifWhatsAppAman_('PENGAJUAN_PINJAM_KENDARAAN', dataNotifikasi.idPinjam, buatPesanNotifPinjamKendaraan_(dataNotifikasi));
      if (notifWa && notifWa.ok) simpanKonteksWaOperator_({ id: dataNotifikasi.idPinjam, tipe: 'kendaraan', mode: 'APPROVAL' });
    } else {
      const notifWa = kirimNotifWhatsAppAman_('PENGAJUAN_PINJAM_SARPRAS', dataNotifikasi.idPinjam, buatPesanNotifPinjamSarpras_(dataNotifikasi));
      if (notifWa && notifWa.ok) simpanKonteksWaOperator_({ id: dataNotifikasi.idPinjam, tipe: 'sarpras', mode: 'APPROVAL' });
    }
  } catch (e) {
    console.error('Penyusunan/pengiriman notifikasi pinjam umum gagal: ' + bersihkanPesanError_(e));
  }

  return pesanSukses;
}

function cekDuplikatPengajuanUmum_(sheet, tipe, form) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();

  return data.some(function(row) {
    const status = normalisasiTeks_(row[tipe === 'kendaraan' ? 7 : 8]);
    if (status.includes('tolak')) return false;

    if (tipe === 'kendaraan') {
      return normalisasiTeks_(row[2]) === normalisasiTeks_(form.nama) &&
        normalisasiTeks_(row[3]) === normalisasiTeks_(form.kegiatan) &&
        normalisasiTeks_(row[4]) === normalisasiTeks_(form.tujuan) &&
        normalisasiTeks_(row[6]) === normalisasiTeks_(form.batasKembali) &&
        normalisasiTeks_(row[11]) === normalisasiTeks_(form.jenisMobil) &&
        normalisasiTeks_(row[12]) === normalisasiTeks_(form.mulaiPenggunaan);
    }

    return normalisasiTeks_(row[2]) === normalisasiTeks_(form.nama) &&
      normalisasiTeks_(row[3]) === normalisasiTeks_(form.kegiatan) &&
      normalisasiTeks_(row[4]) === normalisasiTeks_(form.tujuan) &&
      normalisasiTeks_(row[5]) === normalisasiTeks_(form.jenisBarang) &&
      normalisasiTeks_(row[6]) === normalisasiTeks_(form.lama) &&
      normalisasiTeks_(row[7]) === normalisasiTeks_(form.batasKembali);
  });
}

// --- PEMELIHARAAN ---
function getPemeliharaan(limit) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PEMELIHARAAN);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  let startRow = 2;
  let numRows = lastRow - 1;

  if (limit) {
    numRows = Math.min(limit, lastRow - 1);
    startRow = Math.max(2, lastRow - numRows + 1);
  }

  const data = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getDisplayValues();
  const riwayat = [];

  for (let i = 0; i < data.length; i++) {
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

  let dataNotifikasi = null;
  let pesanSukses = '';

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
    const sumberInput = String(form.sumber || 'User').trim();
    const sumberNormal = normalisasiTeks_(sumberInput);
    if (sumberNormal !== 'user' && sumberNormal !== 'administrator') {
      throw new Error('Sumber pemeliharaan tidak valid.');
    }
    const sumber = sumberNormal === 'administrator' ? 'Administrator' : 'User';
    const statusAwal = sumber === 'Administrator' ? 'ACC' : 'Pending';

    if (!kodeBarang || !nup || !namaBmn || !tanggal || !deskripsi) {
      throw new Error('Data pemeliharaan belum lengkap. Pastikan Kode Barang, NUP, nama BMN, tanggal, dan deskripsi sudah diisi.');
    }

    validasiPanjangTeks_(kodeBarang, 'Kode Barang', 100);
    validasiPanjangTeks_(nup, 'NUP', 50);
    validasiPanjangTeks_(namaBmn, 'Nama BMN', MAX_TEXT.namaBmn);
    validasiPanjangTeks_(deskripsi, 'Keterangan pemeliharaan', MAX_TEXT.keterangan);
    const tanggalPemeliharaan = parseTanggal_(tanggal);
    if (!tanggalPemeliharaan) throw new Error('Tanggal pemeliharaan tidak valid.');
    if (tanggalPemeliharaan.getTime() > awalHariIni_().getTime()) {
      throw new Error('Tanggal pemeliharaan tidak boleh berada di masa depan.');
    }
    validasiBMNExist_(kodeBarang, nup);

    const idPemeliharaan = generateIdUnik_('PMH', getExistingIds_(sheet, 1));
    const hasilFoto = simpanFotoPemeliharaanJikaAktif_(form, idPemeliharaan);
    const fotoUrl = hasilFoto.url;

    sheet.appendRow([idPemeliharaan, kodeBarang, nup, namaBmn, tanggal, deskripsi, fotoUrl, statusAwal, sumber]);

    pesanSukses = 'SUKSES: Data pemeliharaan tersimpan dengan ID ' + idPemeliharaan + ' untuk BMN ' + buatIdBMN_(kodeBarang, nup) + '.';
    if (hasilFoto.catatan) pesanSukses += ' ' + hasilFoto.catatan;

    // Pemeliharaan rutin yang diinput Administrator langsung berstatus ACC dan
    // tidak perlu mengirim notifikasi kembali kepada operator yang sama.
    if (sumber === 'User') {
      dataNotifikasi = { idPemeliharaan, kodeBarang, nup, namaBmn, tanggal, deskripsi };
    }
  } finally {
    lock.releaseLock();
  }

  if (dataNotifikasi) {
    try {
      kirimNotifWhatsAppAman_(
        'LAPORAN_PEMELIHARAAN_BARU',
        dataNotifikasi.idPemeliharaan,
        buatPesanNotifPemeliharaan_(dataNotifikasi)
      );
    } catch (e) {
      console.error('Penyusunan/pengiriman notifikasi pemeliharaan gagal: ' + bersihkanPesanError_(e));
    }
  }

  return pesanSukses;
}

function simpanFotoPemeliharaanJikaAktif_(form, idPemeliharaan) {
  if (!form || !form.fotoBase64) {
    return { url: '-', catatan: '' };
  }

  if (String(form.fotoBase64).length > Math.ceil(MAX_FOTO_BYTES * 1.37) + 5000) {
    throw new Error('Ukuran foto terlalu besar. Maksimal 5 MB.');
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
    if (!/^image\/(jpeg|jpg|png|webp|gif|heic)$/i.test(contentType)) {
      throw new Error('Format foto tidak didukung. Gunakan JPG, PNG, WEBP, GIF, atau HEIC.');
    }
    const base64Marker = form.fotoBase64.indexOf('base64,');
    if (base64Marker === -1) throw new Error('Data foto tidak valid.');
    const bytes = Utilities.base64Decode(form.fotoBase64.substring(base64Marker + 7));
    if (bytes.length > MAX_FOTO_BYTES) throw new Error('Ukuran foto terlalu besar. Maksimal 5 MB.');
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
    const perubahan = ubahStatusById_(sheet, idPemeliharaan, 8, statusBaru, 'pemeliharaan');
    return 'Status pemeliharaan ' + idPemeliharaan + ' berhasil diubah dari ' + perubahan.statusLama + ' menjadi ' + perubahan.statusBaru + '.';
  } finally {
    lock.releaseLock();
  }
}


// ================================================================
// APPROVAL OPERATOR MELALUI WHATSAPP
// ================================================================
// Format perintah yang diproses dari webhook Fonnte:
//   ACC <ID>
//   TOLAK <ID> | <alasan>
//   PILIH <ID_KENDARAAN> <ID_UNIT_MASTER>
//
// Keamanan berlapis:
// 1. Cloudflare Worker memverifikasi secret endpoint webhook.
// 2. GAS memverifikasi sender harus sama dengan WA_OPERATOR di Script Properties.
// 3. Backend tetap memakai LockService + validasi transisi status + cek bentrok.
// 4. Perintah yang statusnya sudah berubah tidak dieksekusi ulang.
// 5. Perintah singkat ACC/TOLAK mengikuti antrean FIFO persisten di Sheet.

function prosesPerintahWaOperator(payload) {
  payload = payload || {};

  const operator = normalisasiNomorWaIndonesia_(
    PropertiesService.getScriptProperties().getProperty('WA_OPERATOR') || ''
  );
  const sender = normalisasiNomorWaIndonesia_(payload.sender || '');
  const pesan = String(payload.message || '').replace(/\r/g, '').trim();
  const requestId = String(payload.requestId || '').trim() || buatRequestId_();

  if (!operator) {
    return { processed: false, ignored: true, reason: 'WA_OPERATOR_NOT_CONFIGURED' };
  }

  // Jangan membalas atau memproses chat dari nomor selain operator.
  if (!sender || sender !== operator) {
    return { processed: false, ignored: true, reason: 'SENDER_NOT_OPERATOR' };
  }

  if (!pesan) {
    return { processed: false, ignored: true, reason: 'EMPTY_MESSAGE' };
  }

  try {
    // ============================================================
    // FORMAT SINGKAT (utama)
    // ============================================================
    // ACC
    // TOLAK_alasan penolakan
    // 1 / 2 / 3 / 4 ... saat memilih unit kendaraan.
    //
    // ID transaksi disimpan sebagai konteks ketika notifikasi pengajuan
    // dikirim ke operator. Format lama tetap didukung sebagai fallback.

    if (/^ACC\s*$/i.test(pesan)) {
      const context = ambilKonteksWaOperator_('APPROVAL');
      if (!context.id) return balasKonteksWaTidakAda_(sender, 'ACC');
      return prosesAccWaOperator_(context.id, sender, requestId);
    }

    let match = pesan.match(/^TOLAK_(.+)$/i);
    if (match) {
      const context = ambilKonteksWaOperator_('ANY');
      if (!context.id) return balasKonteksWaTidakAda_(sender, 'TOLAK');
      const alasan = String(match[1] || '').replace(/_/g, ' ').trim();
      if (!alasan) {
        kirimBalasanWaOperatorAman_(
          'WA_COMMAND_HELP', context.id, sender,
          ['*SIMANTAP BMN*', '', 'Alasan penolakan wajib diisi.', '', 'Contoh:', '```TOLAK_Ruangan sedang digunakan```'].join('\n')
        );
        return { processed: false, command: 'TOLAK', targetId: context.id, reason: 'REJECTION_REASON_REQUIRED' };
      }
      return prosesTolakWaOperator_(context.id, alasan, sender, requestId);
    }

    if (/^\d+$/.test(pesan)) {
      const nomorPilihan = Number(pesan);
      const context = ambilKonteksWaOperator_('PILIH_UNIT');
      if (!context.id || context.mode !== 'PILIH_UNIT' || !Array.isArray(context.units) || !context.units.length) {
        return balasKonteksWaTidakAda_(sender, 'PILIH_UNIT');
      }
      if (!Number.isInteger(nomorPilihan) || nomorPilihan < 1 || nomorPilihan > context.units.length) {
        const lines = ['*SIMANTAP BMN*', '', '❌ Pilihan tidak valid.', 'Balas angka 1 sampai ' + context.units.length + '.', '', 'Unit tersedia:'];
        context.units.forEach(function(unit, index) {
          lines.push((index + 1) + '. ' + unit.label);
        });
        kirimBalasanWaOperatorAman_('WA_PILIH_INVALID_NUMBER', context.id, sender, lines.join('\n'));
        return { processed: false, command: 'PILIH', targetId: context.id, reason: 'INVALID_NUMBER' };
      }
      const unit = context.units[nomorPilihan - 1];
      return prosesPilihKendaraanWaOperator_(context.id, unit.id, sender, requestId);
    }

    // ============================================================
    // FORMAT LAMA (fallback / backward compatibility)
    // ============================================================
    match = pesan.match(/^ACC\s+(\S+)\s*$/i);
    if (match) {
      return prosesAccWaOperator_(String(match[1] || '').trim().toUpperCase(), sender, requestId);
    }

    match = pesan.match(/^TOLAK\s+(\S+)(?:\s*\|\s*(.*))?\s*$/i);
    if (match) {
      const id = String(match[1] || '').trim().toUpperCase();
      const alasan = String(match[2] || '').trim();
      if (!alasan) {
        const balasan = [
          '*SIMANTAP BMN*',
          '',
          'Alasan penolakan wajib diisi.',
          '',
          'Format singkat:',
          'TOLAK_alasan penolakan',
          '',
          'Format lengkap:',
          'TOLAK ' + id + ' | alasan penolakan'
        ].join('\n');
        kirimBalasanWaOperatorAman_('WA_COMMAND_HELP', id || '-', sender, balasan);
        return { processed: false, command: 'TOLAK', targetId: id, reason: 'REJECTION_REASON_REQUIRED' };
      }
      return prosesTolakWaOperator_(id, alasan, sender, requestId);
    }

    match = pesan.match(/^PILIH\s+(\S+)\s+(\S+)\s*$/i);
    if (match) {
      return prosesPilihKendaraanWaOperator_(
        String(match[1] || '').trim().toUpperCase(),
        String(match[2] || '').trim().toUpperCase(),
        sender,
        requestId
      );
    }

    // Pesan lain dari operator tidak dibalas agar nomor SIMANTAP tidak berubah
    // menjadi chatbot umum dan kuota tidak terbuang.
    return { processed: false, ignored: true, reason: 'COMMAND_NOT_RECOGNIZED' };
  } catch (e) {
    const detail = bersihkanPesanError_(e) || 'Perintah WhatsApp gagal diproses.';
    kirimBalasanWaOperatorAman_(
      'WA_COMMAND_ERROR',
      '-',
      sender,
      ['*SIMANTAP BMN*', '', '❌ Perintah gagal diproses.', detail, '', 'Silakan cek data lalu kirim ulang perintah bila diperlukan.'].join('\n')
    );
    return { processed: false, error: detail };
  }
}

const WA_OPERATOR_CONTEXT_KEY = 'WA_OPERATOR_CONTEXT_V2'; // legacy satu konteks
const WA_OPERATOR_CONTEXT_QUEUE_KEY = 'WA_OPERATOR_CONTEXT_QUEUE_V3'; // legacy cache
const WA_OPERATOR_CONTEXT_QUEUE_MAX = 25;

function normalisasiKonteksWaOperator_(data) {
  data = data || {};
  return {
    id: String(data.id || '').trim().toUpperCase(),
    mode: String(data.mode || 'APPROVAL').trim().toUpperCase(),
    tipe: String(data.tipe || '').trim().toLowerCase(),
    units: Array.isArray(data.units) ? data.units.map(function(unit) {
      return {
        id: String(unit && unit.id || '').trim().toUpperCase(),
        label: String(unit && unit.label || '').trim()
      };
    }).filter(function(unit) { return !!unit.id; }) : [],
    updatedAt: String(data.updatedAt || new Date().toISOString()),
    queueStatus: String(data.queueStatus || '').trim().toUpperCase(),
    rowIndex: Number(data.rowIndex || 0)
  };
}

function getOrCreateWaApprovalQueueSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_WA_APPROVAL_QUEUE);
  if (!sheet) sheet = ss.insertSheet(SHEET_WA_APPROVAL_QUEUE);

  const headerCount = WA_APPROVAL_QUEUE_HEADERS.length;
  if (sheet.getMaxColumns() < headerCount) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headerCount - sheet.getMaxColumns());
  }

  const existing = sheet.getRange(1, 1, 1, headerCount).getDisplayValues()[0];
  const headerMismatch = WA_APPROVAL_QUEUE_HEADERS.some(function(header, i) {
    return String(existing[i] || '').trim() !== header;
  });
  if (headerMismatch) {
    sheet.getRange(1, 1, 1, headerCount).setValues([WA_APPROVAL_QUEUE_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function parseDataKonteksWa_(raw) {
  const text = String(raw || '').trim();
  if (!text) return { units: [] };
  try {
    const parsed = JSON.parse(text);
    return {
      units: Array.isArray(parsed && parsed.units) ? parsed.units.map(function(unit) {
        return {
          id: String(unit && unit.id || '').trim().toUpperCase(),
          label: String(unit && unit.label || '').trim()
        };
      }).filter(function(unit) { return !!unit.id; }) : []
    };
  } catch (e) {
    return { units: [] };
  }
}

function contextDariRowWaQueue_(row, rowIndex) {
  const data = parseDataKonteksWa_(row[6]);
  return normalisasiKonteksWaOperator_({
    id: row[1],
    tipe: row[2],
    mode: row[5] || 'APPROVAL',
    units: data.units,
    updatedAt: row[7] || row[0] || new Date().toISOString(),
    queueStatus: row[4],
    rowIndex: rowIndex
  });
}

function bacaAntrianWaDariSheet_() {
  const sheet = getOrCreateWaApprovalQueueSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const rows = sheet.getRange(2, 1, lastRow - 1, WA_APPROVAL_QUEUE_HEADERS.length).getDisplayValues();
  return rows.map(function(row, i) {
    return contextDariRowWaQueue_(row, i + 2);
  }).filter(function(item) { return !!item.id; });
}

function updateRowWaQueue_(rowIndex, changes) {
  const sheet = getOrCreateWaApprovalQueueSheet_();
  const row = Number(rowIndex || 0);
  if (row < 2 || row > sheet.getLastRow()) return;
  changes = changes || {};

  if (changes.tipe != null) sheet.getRange(row, 3).setValue(String(changes.tipe || '').trim().toLowerCase());
  if (changes.peminjam != null) sheet.getRange(row, 4).setValue(String(changes.peminjam || '').trim());
  if (changes.queueStatus != null) sheet.getRange(row, 5).setValue(String(changes.queueStatus || '').trim().toUpperCase());
  if (changes.mode != null) sheet.getRange(row, 6).setValue(String(changes.mode || '').trim().toUpperCase());
  if (changes.units != null) sheet.getRange(row, 7).setValue(JSON.stringify({ units: changes.units || [] }));
  sheet.getRange(row, 8).setValue(new Date());
  if (changes.detail != null) sheet.getRange(row, 9).setValue(String(changes.detail || '').trim());
}

function cariSemuaRowWaQueueById_(id) {
  const target = String(id || '').trim().toUpperCase();
  if (!target) return [];
  return bacaAntrianWaDariSheet_().filter(function(item) {
    return item.id === target;
  });
}

function cariRowWaQueueById_(id) {
  const matches = cariSemuaRowWaQueueById_(id);
  if (!matches.length) return null;

  // Prioritaskan row yang masih hidup agar perubahan tahap APPROVAL -> PILIH_UNIT
  // tidak pernah diarahkan ke histori DONE/SKIPPED lama.
  const hidup = matches.filter(function(item) {
    return item.queueStatus === 'ACTIVE' || item.queueStatus === 'WAITING';
  });
  if (hidup.length) return hidup[0];

  const finalRow = matches.filter(function(item) {
    return item.queueStatus === 'DONE' || item.queueStatus === 'SKIPPED';
  });
  if (finalRow.length) return finalRow[0];

  return matches[0];
}

function idWaQueuePernahFinal_(id) {
  return cariSemuaRowWaQueueById_(id).some(function(item) {
    return item.queueStatus === 'DONE' || item.queueStatus === 'SKIPPED';
  });
}

function idWaQueuePernahTerdaftar_(id) {
  return cariSemuaRowWaQueueById_(id).length > 0;
}


// Menjaga WA_Approval_Queue tetap sinkron bila Administrator memproses
// ACC/Tolak langsung dari dashboard web. Perintah dari webhook WhatsApp
// dilewati di sini karena flow WA sendiri akan menandai queue sebagai DONE
// setelah balasan operator berhasil diproses.
function sinkronkanWaQueueSetelahStatusWeb_(id, statusBaru, sumberAksi) {
  const sumber = String(sumberAksi || 'WEB').trim().toUpperCase();
  if (sumber === 'WA') return null;

  const status = String(statusBaru || '').trim();
  if (status !== 'ACC' && status !== 'Ditolak') return null;

  const target = String(id || '').trim().toUpperCase();
  if (!target) return null;

  const matches = cariSemuaRowWaQueueById_(target);
  let changed = 0;

  matches.forEach(function(item) {
    if (item.queueStatus !== 'ACTIVE' && item.queueStatus !== 'WAITING') return;
    updateRowWaQueue_(item.rowIndex, {
      queueStatus: 'SKIPPED',
      detail: 'Diselesaikan melalui dashboard web dengan status ' + status + '; dikeluarkan otomatis dari antrean WhatsApp.'
    });
    changed++;
  });

  if (changed) {
    return aktifkanAntrianWaBerikutnya_();
  }
  return null;
}

// Sinkronisasi defensif sebelum setiap command WA. Ini membersihkan queue lama
// yang masih ACTIVE/WAITING padahal transaksi aslinya sudah ACC/Ditolak melalui
// dashboard saat Fonnte sedang disconnect.
function sinkronkanSemuaWaQueueDenganTransaksi_() {
  const items = bacaAntrianWaDariSheet_();
  let changed = 0;

  items.forEach(function(item) {
    if (item.queueStatus !== 'ACTIVE' && item.queueStatus !== 'WAITING') return;

    const trx = ambilTransaksiUntukWa_(item.id);
    if (trx.found && trx.status === 'Pending') return;

    updateRowWaQueue_(item.rowIndex, {
      queueStatus: 'SKIPPED',
      detail: trx.found
        ? 'Sinkronisasi otomatis: transaksi utama sudah berstatus ' + (trx.status || '-') + '.'
        : 'Sinkronisasi otomatis: transaksi utama tidak ditemukan.'
    });
    changed++;
  });

  return changed;
}

// Dapat dijalankan manual dari Apps Script untuk membersihkan queue stale dan
// melihat pengajuan WA yang sekarang aktif.
function sinkronkanWaApprovalQueueSekarang() {
  const changed = sinkronkanSemuaWaQueueDenganTransaksi_();
  const active = aktifkanAntrianWaBerikutnya_();
  return {
    dibersihkan: changed,
    aktif: active || { id: '', mode: '', tipe: '', units: [] },
    queue: cekKonteksWaOperator().queue
  };
}

function rapikanDuplikatWaQueue_() {
  const items = bacaAntrianWaDariSheet_();
  if (!items.length) return 0;

  const groups = {};
  items.forEach(function(item) {
    if (!groups[item.id]) groups[item.id] = [];
    groups[item.id].push(item);
  });

  let changed = 0;
  Object.keys(groups).forEach(function(id) {
    const group = groups[id].sort(function(a, b) {
      return Number(a.rowIndex || 0) - Number(b.rowIndex || 0);
    });
    if (group.length < 2) return;

    const terminal = group.find(function(item) {
      return item.queueStatus === 'DONE' || item.queueStatus === 'SKIPPED';
    });

    if (terminal) {
      // Kalau ID sudah pernah final, semua reincarnation ACTIVE/WAITING harus mati.
      group.forEach(function(item) {
        if (item.queueStatus !== 'ACTIVE' && item.queueStatus !== 'WAITING') return;
        updateRowWaQueue_(item.rowIndex, {
          queueStatus: 'SKIPPED',
          detail: 'Dikunci final: ID ini sudah pernah selesai/dilewati dan tidak boleh diaktifkan kembali.'
        });
        changed++;
      });
      return;
    }

    // Belum pernah final: pertahankan satu row hidup paling awal sebagai canonical.
    const living = group.filter(function(item) {
      return item.queueStatus === 'ACTIVE' || item.queueStatus === 'WAITING';
    });
    if (living.length <= 1) return;

    for (let i = 1; i < living.length; i++) {
      updateRowWaQueue_(living[i].rowIndex, {
        queueStatus: 'DUPLICATE',
        detail: 'Duplikat queue dinonaktifkan otomatis. Canonical row: ' + living[0].rowIndex + '.'
      });
      changed++;
    }
  });

  return changed;
}

function adaQueueWaAktif_() {
  return bacaAntrianWaDariSheet_().some(function(item) {
    return item.queueStatus === 'ACTIVE';
  });
}

function simpanKonteksWaOperator_(data) {
  const context = normalisasiKonteksWaOperator_(data);
  if (!context.id) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getOrCreateWaApprovalQueueSheet_();
    const trx = ambilTransaksiUntukWa_(context.id);
    const peminjam = trx && trx.found ? (trx.nama || '') : '';
    const matches = cariSemuaRowWaQueueById_(context.id);
    const existingLive = matches.find(function(item) {
      return item.queueStatus === 'ACTIVE' || item.queueStatus === 'WAITING';
    });

    if (existingLive) {
      // Transisi kendaraan APPROVAL -> PILIH_UNIT memperbarui row canonical yang
      // sama. Queue tetap ACTIVE/WAITING; tidak pernah dibuat row baru.
      updateRowWaQueue_(existingLive.rowIndex, {
        tipe: context.tipe || existingLive.tipe,
        peminjam: peminjam,
        mode: context.mode || existingLive.mode,
        units: context.units,
        detail: context.mode === 'PILIH_UNIT'
          ? 'Menunggu operator memilih unit kendaraan.'
          : 'Menunggu keputusan operator.'
      });
      return;
    }

    // FINAL LOCK: bila ID pernah DONE/SKIPPED, Notification_Log, legacy context,
    // maupun event lama tidak boleh membangkitkan ID tersebut lagi.
    if (matches.some(function(item) {
      return item.queueStatus === 'DONE' || item.queueStatus === 'SKIPPED';
    })) {
      return;
    }

    // Kalau hanya ada row DUPLICATE, tetap jangan membuat ID yang sama lagi.
    if (matches.length) return;

    const hasActive = bacaAntrianWaDariSheet_().some(function(item) {
      return item.queueStatus === 'ACTIVE';
    });
    const statusQueue = hasActive ? 'WAITING' : 'ACTIVE';

    sheet.appendRow([
      new Date(),
      context.id,
      context.tipe,
      peminjam,
      statusQueue,
      context.mode || 'APPROVAL',
      JSON.stringify({ units: context.units || [] }),
      new Date(),
      statusQueue === 'ACTIVE' ? 'Pengajuan aktif menunggu keputusan operator.' : 'Menunggu giliran FIFO.'
    ]);
  } finally {
    lock.releaseLock();
  }
}

function bacaAntrianKonteksWaOperator_() {
  pastikanAntrianWaOperatorSiap_();
  return bacaAntrianWaDariSheet_().filter(function(item) {
    return item.queueStatus === 'ACTIVE' || item.queueStatus === 'WAITING';
  });
}

function bacaLegacyKonteksWaOperator_() {
  const props = PropertiesService.getScriptProperties();
  let queue = [];
  const rawQueue = String(props.getProperty(WA_OPERATOR_CONTEXT_QUEUE_KEY) || '').trim();
  if (rawQueue) {
    try {
      const parsed = JSON.parse(rawQueue);
      if (Array.isArray(parsed)) {
        queue = parsed.map(normalisasiKonteksWaOperator_).filter(function(item) { return !!item.id; });
      }
    } catch (e) {
      queue = [];
    }
  }
  if (!queue.length) {
    const rawLegacy = String(props.getProperty(WA_OPERATOR_CONTEXT_KEY) || '').trim();
    if (rawLegacy) {
      try {
        const legacy = normalisasiKonteksWaOperator_(JSON.parse(rawLegacy));
        if (legacy.id) queue.push(legacy);
      } catch (e) {
        // Abaikan legacy context yang korup.
      }
    }
  }
  return queue.slice(-WA_OPERATOR_CONTEXT_QUEUE_MAX);
}

function migrasiLegacyKonteksWaKeSheet_() {
  const existing = bacaAntrianWaDariSheet_().filter(function(item) {
    return item.queueStatus === 'ACTIVE' || item.queueStatus === 'WAITING';
  });
  if (existing.length) return existing.length;

  const props = PropertiesService.getScriptProperties();
  const legacy = bacaLegacyKonteksWaOperator_();
  if (!legacy.length) {
    props.deleteProperty(WA_OPERATOR_CONTEXT_QUEUE_KEY);
    props.deleteProperty(WA_OPERATOR_CONTEXT_KEY);
    return 0;
  }

  let inserted = 0;
  legacy.forEach(function(item) {
    const trx = ambilTransaksiUntukWa_(item.id);
    if (!trx.found || trx.status !== 'Pending') return;
    simpanKonteksWaOperator_({ id: item.id, tipe: trx.tipe || item.tipe, mode: item.mode, units: item.units });
    inserted++;
  });

  // Migrasi hanya sekali. Setelah data dipindahkan ke Sheet persisten, cache
  // legacy di Script Properties dihapus agar antrean lama tidak hidup kembali.
  props.deleteProperty(WA_OPERATOR_CONTEXT_QUEUE_KEY);
  props.deleteProperty(WA_OPERATOR_CONTEXT_KEY);
  return inserted;
}

function eventNotifCocokUntukRecoveryWa_(eventName) {
  const event = String(eventName || '').trim().toUpperCase();
  return [
    'PENGAJUAN_PINJAM_RUANGAN',
    'PENGAJUAN_PINJAM_KENDARAAN',
    'PENGAJUAN_PINJAM_SARPRAS',
    'WA_KENDARAAN_OPTIONS',
    'WA_PILIH_INVALID_NUMBER',
    'WA_PILIH_INVALID_UNIT',
    'WA_PILIH_WRONG_TYPE',
    'WA_PILIH_UNIT_UNAVAILABLE'
  ].indexOf(event) !== -1;
}

function pulihkanAntrianWaDariNotificationLog_() {
  try {
    const allQueue = bacaAntrianWaDariSheet_();
    const existing = allQueue.filter(function(item) {
      return item.queueStatus === 'ACTIVE' || item.queueStatus === 'WAITING';
    });
    if (existing.length) return existing.length;

    // Recovery hanya untuk ID yang BELUM PERNAH masuk WA_Approval_Queue.
    // Ini mencegah transaksi DONE/SKIPPED lama hidup lagi dari Notification_Log.
    const seenIds = {};
    allQueue.forEach(function(item) {
      if (item.id) seenIds[item.id] = true;
    });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NOTIFICATION_LOG);
    if (!sheet || sheet.getLastRow() < 2) return 0;

    const lastRow = sheet.getLastRow();
    const startRow = Math.max(2, lastRow - 499);
    const rowCount = lastRow - startRow + 1;
    const rows = sheet.getRange(startRow, 1, rowCount, Math.max(9, sheet.getLastColumn())).getDisplayValues();
    const currentOperatorMasked = samarkanNomorWa_(
      normalisasiNomorWaIndonesia_(PropertiesService.getScriptProperties().getProperty('WA_OPERATOR') || '')
    );

    const orderedIds = [];
    const byId = {};

    rows.forEach(function(row) {
      const eventName = String(row[2] || '').trim().toUpperCase();
      const targetId = String(row[3] || '').trim().toUpperCase();
      const targetMasked = String(row[4] || '').trim();
      const notifStatus = String(row[5] || '').trim().toUpperCase();

      if (!targetId || seenIds[targetId]) return;
      if (notifStatus !== 'QUEUED' || !eventNotifCocokUntukRecoveryWa_(eventName)) return;
      if (currentOperatorMasked && targetMasked && targetMasked !== currentOperatorMasked) return;

      if (!byId[targetId]) {
        byId[targetId] = { id: targetId, mode: 'APPROVAL' };
        orderedIds.push(targetId);
      }
      if (eventName === 'WA_KENDARAAN_OPTIONS' || eventName.indexOf('WA_PILIH_') === 0) {
        byId[targetId].mode = 'PILIH_UNIT';
      }
    });

    let inserted = 0;
    orderedIds.forEach(function(id) {
      // Sumber kebenaran tetap transaksi utama. Selain belum pernah ada di queue,
      // transaksi WAJIB masih Pending agar boleh direcovery.
      const trx = ambilTransaksiUntukWa_(id);
      if (!trx.found || trx.status !== 'Pending') return;
      if (idWaQueuePernahTerdaftar_(id)) return;

      let units = [];
      if (byId[id].mode === 'PILIH_UNIT' && trx.tipe === 'kendaraan') {
        units = daftarUnitTersediaWa_(trx);
        if (!units.length) byId[id].mode = 'APPROVAL';
      }

      simpanKonteksWaOperator_({
        id: id,
        tipe: trx.tipe,
        mode: byId[id].mode,
        units: units
      });
      if (idWaQueuePernahTerdaftar_(id)) inserted++;
    });

    return inserted;
  } catch (e) {
    console.error('Recovery antrean WhatsApp dari Notification_Log gagal: ' + bersihkanPesanError_(e));
    return 0;
  }
}

function pastikanAntrianWaOperatorSiap_() {
  // Rapikan queue lama sebelum menentukan ACTIVE. Ini juga mematikan
  // reincarnation dari bug versi sebelumnya.
  rapikanDuplikatWaQueue_();

  // Bila approval dilakukan langsung lewat dashboard ketika Fonnte disconnect,
  // queue lama dibersihkan terlebih dahulu sebelum command WA baru dipetakan.
  sinkronkanSemuaWaQueueDenganTransaksi_();

  let active = bacaAntrianWaDariSheet_().filter(function(item) {
    return item.queueStatus === 'ACTIVE' || item.queueStatus === 'WAITING';
  });
  if (active.length) return;

  migrasiLegacyKonteksWaKeSheet_();
  active = bacaAntrianWaDariSheet_().filter(function(item) {
    return item.queueStatus === 'ACTIVE' || item.queueStatus === 'WAITING';
  });
  if (active.length) return;

  pulihkanAntrianWaDariNotificationLog_();
}

function konteksWaMasihValid_(context) {
  if (!context || !context.id) return null;
  const trx = ambilTransaksiUntukWa_(context.id);
  if (!trx.found || trx.status !== 'Pending') return null;

  const normalized = normalisasiKonteksWaOperator_(context);
  normalized.tipe = trx.tipe || normalized.tipe;

  if (normalized.mode === 'PILIH_UNIT') {
    if (trx.tipe !== 'kendaraan') return null;
    // Pertahankan mapping angka sesuai daftar yang sudah dikirim ke operator.
    // Jika data JSON hilang, baru buat ulang daftar pilihan.
    if (!normalized.units.length) {
      const units = daftarUnitTersediaWa_(trx);
      if (!units.length) return null;
      normalized.units = units.map(function(unit) {
        return { id: unit.id, label: unit.label };
      });
      if (normalized.rowIndex) {
        updateRowWaQueue_(normalized.rowIndex, { units: normalized.units, detail: 'Daftar unit dipulihkan otomatis.' });
      }
    }
  }
  return normalized;
}

function aktifkanAntrianWaBerikutnya_() {
  const items = bacaAntrianWaDariSheet_();

  // Jika ada ACTIVE yang masih valid, pertahankan. FIFO tidak boleh melompati
  // transaksi aktif, termasuk kendaraan yang masih menunggu pilihan unit.
  for (let i = 0; i < items.length; i++) {
    if (items[i].queueStatus !== 'ACTIVE') continue;
    const validActive = konteksWaMasihValid_(items[i]);
    if (validActive) return validActive;
    updateRowWaQueue_(items[i].rowIndex, {
      queueStatus: 'SKIPPED',
      detail: 'Dilewati otomatis karena transaksi tidak lagi berstatus Pending.'
    });
  }

  // Tidak ada ACTIVE valid: aktifkan WAITING PALING TUA (row paling atas).
  const refreshed = bacaAntrianWaDariSheet_();
  for (let i = 0; i < refreshed.length; i++) {
    if (refreshed[i].queueStatus !== 'WAITING') continue;
    const validWaiting = konteksWaMasihValid_(refreshed[i]);
    if (!validWaiting) {
      updateRowWaQueue_(refreshed[i].rowIndex, {
        queueStatus: 'SKIPPED',
        detail: 'Dilewati otomatis karena transaksi tidak lagi berstatus Pending.'
      });
      continue;
    }
    updateRowWaQueue_(refreshed[i].rowIndex, {
      queueStatus: 'ACTIVE',
      detail: validWaiting.mode === 'PILIH_UNIT'
        ? 'Aktif: menunggu pilihan unit kendaraan.'
        : 'Aktif: menunggu keputusan operator.'
    });
    validWaiting.queueStatus = 'ACTIVE';
    return validWaiting;
  }

  return null;
}

function ambilKonteksWaOperator_(mode) {
  pastikanAntrianWaOperatorSiap_();
  const wanted = String(mode || 'ANY').trim().toUpperCase();
  const active = aktifkanAntrianWaBerikutnya_();
  if (!active) return { id: '', mode: '', tipe: '', units: [] };

  // FIFO keras: selama ada transaksi ACTIVE, command tidak pernah lompat ke
  // WAITING berikutnya. ACC saat kendaraan berada di PILIH_UNIT tetap mengarah
  // ke kendaraan yang sama dan hanya akan menampilkan ulang pilihan unit.
  if (wanted === 'PILIH_UNIT' && active.mode !== 'PILIH_UNIT') {
    return { id: '', mode: '', tipe: '', units: [], blockedBy: active.id, blockedMode: active.mode };
  }

  return active;
}

function tandaiKonteksWaSelesai_(id, detail) {
  const target = String(id || '').trim().toUpperCase();
  if (!target) return null;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const existing = cariRowWaQueueById_(target);
    if (existing && existing.rowIndex) {
      updateRowWaQueue_(existing.rowIndex, {
        queueStatus: 'DONE',
        detail: detail || 'Selesai diproses melalui WhatsApp.'
      });
    }
    return aktifkanAntrianWaBerikutnya_();
  } finally {
    lock.releaseLock();
  }
}

function hapusKonteksWaOperatorJikaId_(id) {
  // Nama fungsi lama dipertahankan agar kompatibel. Implementasi baru tidak
  // menghapus histori; transaksi ditandai DONE lalu FIFO berikutnya diaktifkan.
  return tandaiKonteksWaSelesai_(id, 'Selesai diproses.');
}

function labelTipeWa_(tipe) {
  const value = String(tipe || '').trim().toLowerCase();
  if (value === 'booking') return 'Pinjam Ruangan';
  if (value === 'kendaraan') return 'Pinjam Kendaraan';
  if (value === 'sarpras') return 'Pinjam Sarpras';
  return 'Pengajuan';
}

function buatRingkasanAntreanBerikutnyaWa_(context) {
  if (!context || !context.id) {
    return ['', 'Antrean approval WhatsApp saat ini kosong.'];
  }

  const trx = ambilTransaksiUntukWa_(context.id);
  if (!trx.found || trx.status !== 'Pending') return [];

  const lines = [
    '',
    '*Berikutnya dalam antrean:*',
    'ID: ' + context.id,
    'Jenis: ' + labelTipeWa_(trx.tipe),
    'Peminjam: ' + (trx.nama || '-'),
    'Kegiatan: ' + (trx.kegiatan || '-')
  ];

  if (trx.tipe === 'kendaraan' && trx.jenisMobil) {
    lines.push('Jenis Mobil: ' + trx.jenisMobil);
  }

  if (context.mode === 'PILIH_UNIT') {
    lines.push('', 'Transaksi ini masih menunggu pemilihan unit kendaraan.');
    if (Array.isArray(context.units) && context.units.length) {
      lines.push('Balas angka 1 sampai ' + context.units.length + ' sesuai pilihan unit yang sudah dikirim.');
    }
  } else {
    lines.push('', 'Balas:', '```ACC```', 'atau', '```TOLAK_Alasan penolakan```');
  }
  return lines;
}

function balasKonteksWaTidakAda_(sender, command) {
  const active = aktifkanAntrianWaBerikutnya_();
  let pesan;

  if (String(command || '').toUpperCase() === 'PILIH_UNIT' && active && active.id && active.mode !== 'PILIH_UNIT') {
    pesan = [
      '*SIMANTAP BMN*',
      '',
      '❌ Belum ada kendaraan yang sedang menunggu pilihan unit.',
      '',
      'Pengajuan aktif saat ini:',
      active.id + ' — ' + labelTipeWa_(active.tipe),
      '',
      'Balas ```ACC``` atau ```TOLAK_Alasan``` untuk menyelesaikan pengajuan aktif terlebih dahulu.'
    ].join('\n');
  } else {
    pesan = [
      '*SIMANTAP BMN*',
      '',
      '❌ Tidak ada pengajuan Pending yang cocok untuk perintah ' + command + '.',
      '',
      'SIMANTAP sudah mencoba memulihkan antrean dari riwayat notifikasi.',
      'Jika pengajuan memang masih Pending, gunakan perintah lengkap satu kali agar dapat diproses.'
    ].join('\n');
  }

  kirimBalasanWaOperatorAman_('WA_CONTEXT_NOT_FOUND', '-', sender, pesan);
  return { processed: false, command: command, reason: 'CONTEXT_NOT_FOUND' };
}

function cekKonteksWaOperator() {
  pastikanAntrianWaOperatorSiap_();
  const queue = bacaAntrianWaDariSheet_();
  const active = aktifkanAntrianWaBerikutnya_();
  return {
    jumlahAktifMenunggu: queue.filter(function(item) {
      return item.queueStatus === 'ACTIVE' || item.queueStatus === 'WAITING';
    }).length,
    aktif: active || { id: '', mode: '', tipe: '', units: [] },
    queue: queue.map(function(item) {
      return {
        id: item.id,
        mode: item.mode,
        tipe: item.tipe,
        statusQueue: item.queueStatus,
        rowIndex: item.rowIndex,
        updatedAt: item.updatedAt,
        jumlahUnit: item.units.length
      };
    })
  };
}

function prosesAccWaOperator_(id, sender, requestId) {
  const trx = ambilTransaksiUntukWa_(id);
  if (!trx.found) {
    kirimBalasanWaOperatorAman_('WA_ACC_NOT_FOUND', id, sender, pesanDataTidakDitemukanWa_(id));
    return { processed: false, command: 'ACC', targetId: id, reason: 'NOT_FOUND' };
  }

  if (trx.status !== 'Pending') {
    kirimBalasanWaOperatorAman_('WA_ACC_ALREADY_PROCESSED', id, sender, pesanStatusSudahDiprosesWa_(trx));
    return { processed: false, command: 'ACC', targetId: id, reason: 'ALREADY_PROCESSED', status: trx.status };
  }

  // Kendaraan memerlukan penetapan unit aktual terlebih dahulu.
  if (trx.tipe === 'kendaraan') {
    const units = daftarUnitTersediaWa_(trx);
    if (!units.length) {
      const balasan = [
        '*SIMANTAP BMN*',
        '*Unit Kendaraan Tidak Tersedia*',
        '',
        'ID: ' + id,
        'Jenis: ' + (trx.jenisMobil || '-'),
        'Mulai: ' + formatDateTimeLocalIndonesia_(trx.mulaiPenggunaan),
        'Kembali: ' + formatDateTimeLocalIndonesia_(trx.batasKembali),
        '',
        'Tidak ada unit yang tersedia pada jadwal tersebut.',
        'Pengajuan belum diubah dan masih berstatus Pending.'
      ].join('\n');
      kirimBalasanWaOperatorAman_('WA_KENDARAAN_NO_UNIT', id, sender, balasan);
      return { processed: false, command: 'ACC', targetId: id, reason: 'NO_AVAILABLE_UNIT' };
    }

    const lines = [
      '*SIMANTAP BMN*',
      '*Pilih Unit Kendaraan*',
      '',
      'ID: ' + id,
      'Peminjam: ' + (trx.nama || '-'),
      'Jenis: ' + (trx.jenisMobil || '-'),
      'Mulai: ' + formatDateTimeLocalIndonesia_(trx.mulaiPenggunaan),
      'Kembali: ' + formatDateTimeLocalIndonesia_(trx.batasKembali),
      '',
      'Unit tersedia:'
    ];

    units.forEach(function(unit, index) {
      lines.push((index + 1) + '. ' + unit.label);
    });

    lines.push('', '*Pilih unit dengan membalas angka:*', '```1```' + (units.length > 1 ? ' / ```2```' : '') + (units.length > 2 ? ' / ```3```' : '') + (units.length > 3 ? ' / ```4```' : '') + (units.length > 4 ? ' / dst.' : ''));
    simpanKonteksWaOperator_({ id: id, tipe: 'kendaraan', mode: 'PILIH_UNIT', units: units });
    kirimBalasanWaOperatorAman_('WA_KENDARAAN_OPTIONS', id, sender, lines.join('\n'));

    return {
      processed: true,
      command: 'ACC',
      targetId: id,
      nextAction: 'PILIH_UNIT',
      availableUnits: units.map(function(unit) { return { id: unit.id, label: unit.label }; })
    };
  }

  let hasil;
  if (trx.tipe === 'booking') {
    hasil = ubahStatusBooking(id, 'ACC', '', 'WA');
  } else if (trx.tipe === 'sarpras') {
    hasil = ubahStatusSarpras(id, 'ACC', '', 'WA');
  } else {
    kirimBalasanWaOperatorAman_('WA_ACC_INVALID_TYPE', id, sender, pesanDataTidakDitemukanWa_(id));
    return { processed: false, command: 'ACC', targetId: id, reason: 'UNSUPPORTED_TYPE' };
  }

  catatAuditAktivitas_({
    requestId: requestId,
    actor: 'Operator WhatsApp',
    action: 'WA_ACC_' + trx.tipe.toUpperCase(),
    targetId: id,
    statusLama: trx.status,
    statusBaru: 'ACC',
    detail: 'Persetujuan diproses melalui perintah WhatsApp operator.'
  });

  const nextContext = tandaiKonteksWaSelesai_(id, 'Disetujui melalui WhatsApp operator.');
  const linesSuccess = ['*SIMANTAP BMN*', '', '✅ BERHASIL', '', id + ' telah DISETUJUI.', 'SIMANTAP telah memproses notifikasi status kepada peminjam.'];
  Array.prototype.push.apply(linesSuccess, buatRingkasanAntreanBerikutnyaWa_(nextContext));

  kirimBalasanWaOperatorAman_(
    'WA_ACC_SUCCESS',
    id,
    sender,
    linesSuccess.join('\n')
  );

  return { processed: true, command: 'ACC', targetId: id, status: 'ACC', result: hasil };
}

function prosesTolakWaOperator_(id, alasan, sender, requestId) {
  const trx = ambilTransaksiUntukWa_(id);
  if (!trx.found) {
    kirimBalasanWaOperatorAman_('WA_TOLAK_NOT_FOUND', id, sender, pesanDataTidakDitemukanWa_(id));
    return { processed: false, command: 'TOLAK', targetId: id, reason: 'NOT_FOUND' };
  }

  if (trx.status !== 'Pending') {
    kirimBalasanWaOperatorAman_('WA_TOLAK_ALREADY_PROCESSED', id, sender, pesanStatusSudahDiprosesWa_(trx));
    return { processed: false, command: 'TOLAK', targetId: id, reason: 'ALREADY_PROCESSED', status: trx.status };
  }

  if (alasan.length > 500) {
    const balasan = ['*SIMANTAP BMN*', '', '❌ Alasan penolakan maksimal 500 karakter.', 'Silakan ringkas alasan lalu kirim kembali.'].join('\n');
    kirimBalasanWaOperatorAman_('WA_TOLAK_REASON_TOO_LONG', id, sender, balasan);
    return { processed: false, command: 'TOLAK', targetId: id, reason: 'REASON_TOO_LONG' };
  }

  let hasil;
  if (trx.tipe === 'booking') {
    hasil = ubahStatusBooking(id, 'Ditolak', alasan, 'WA');
  } else if (trx.tipe === 'kendaraan') {
    hasil = ubahStatusKendaraan(id, 'Ditolak', '', alasan, 'WA');
  } else if (trx.tipe === 'sarpras') {
    hasil = ubahStatusSarpras(id, 'Ditolak', alasan, 'WA');
  } else {
    kirimBalasanWaOperatorAman_('WA_TOLAK_INVALID_TYPE', id, sender, pesanDataTidakDitemukanWa_(id));
    return { processed: false, command: 'TOLAK', targetId: id, reason: 'UNSUPPORTED_TYPE' };
  }

  catatAuditAktivitas_({
    requestId: requestId,
    actor: 'Operator WhatsApp',
    action: 'WA_TOLAK_' + trx.tipe.toUpperCase(),
    targetId: id,
    statusLama: trx.status,
    statusBaru: 'Ditolak',
    detail: 'Ditolak melalui WhatsApp operator. Alasan: ' + ringkasTeks_(alasan, 300)
  });

  const nextContext = tandaiKonteksWaSelesai_(id, 'Ditolak melalui WhatsApp operator.');
  const linesSuccess = ['*SIMANTAP BMN*', '', '✅ BERHASIL', '', id + ' telah DITOLAK.', 'Alasan: ' + alasan, '', 'SIMANTAP telah memproses notifikasi status kepada peminjam.'];
  Array.prototype.push.apply(linesSuccess, buatRingkasanAntreanBerikutnyaWa_(nextContext));

  kirimBalasanWaOperatorAman_(
    'WA_TOLAK_SUCCESS',
    id,
    sender,
    linesSuccess.join('\n')
  );

  return { processed: true, command: 'TOLAK', targetId: id, status: 'Ditolak', result: hasil };
}

function prosesPilihKendaraanWaOperator_(id, unitId, sender, requestId) {
  const trx = ambilTransaksiUntukWa_(id);
  if (!trx.found || trx.tipe !== 'kendaraan') {
    kirimBalasanWaOperatorAman_('WA_PILIH_NOT_FOUND', id, sender, pesanDataTidakDitemukanWa_(id));
    return { processed: false, command: 'PILIH', targetId: id, reason: 'NOT_FOUND' };
  }

  if (trx.status !== 'Pending') {
    kirimBalasanWaOperatorAman_('WA_PILIH_ALREADY_PROCESSED', id, sender, pesanStatusSudahDiprosesWa_(trx));
    return { processed: false, command: 'PILIH', targetId: id, reason: 'ALREADY_PROCESSED', status: trx.status };
  }

  const unit = getMasterKendaraan_().find(function(item) {
    return String(item.id || '').trim().toUpperCase() === String(unitId || '').trim().toUpperCase();
  });

  if (!unit) {
    const options = daftarUnitTersediaWa_(trx);
    const lines = ['*SIMANTAP BMN*', '', '❌ Kode unit ' + unitId + ' tidak ditemukan.', ''];
    if (options.length) {
      lines.push('Unit yang tersedia:');
      options.forEach(function(item) { lines.push('[' + item.id + '] ' + item.label); });
      simpanKonteksWaOperator_({ id: id, tipe: 'kendaraan', mode: 'PILIH_UNIT', units: options });
      lines.push('', 'Balas angka 1 sampai ' + options.length + ' sesuai unit yang dipilih.');
    }
    kirimBalasanWaOperatorAman_('WA_PILIH_INVALID_UNIT', id, sender, lines.join('\n'));
    return { processed: false, command: 'PILIH', targetId: id, reason: 'INVALID_UNIT' };
  }

  if (normalisasiTeks_(unit.jenisMobil) !== normalisasiTeks_(trx.jenisMobil)) {
    const options = daftarUnitTersediaWa_(trx);
    const lines = [
      '*SIMANTAP BMN*',
      '',
      '❌ Unit yang dipilih tidak sesuai jenis mobil yang diminta.',
      'Permintaan: ' + (trx.jenisMobil || '-'),
      'Unit dipilih: ' + unit.label
    ];
    if (options.length) {
      lines.push('', 'Pilih salah satu unit berikut:');
      options.forEach(function(item) { lines.push('[' + item.id + '] ' + item.label); });
    }
    kirimBalasanWaOperatorAman_('WA_PILIH_WRONG_TYPE', id, sender, lines.join('\n'));
    return { processed: false, command: 'PILIH', targetId: id, reason: 'WRONG_VEHICLE_TYPE' };
  }

  // Validasi availability awal untuk memberi balasan lebih ramah. Fungsi
  // ubahStatusKendaraan() tetap mengulang validasi di dalam LockService.
  const options = daftarUnitTersediaWa_(trx);
  const masihTersedia = options.some(function(item) { return item.id === unit.id; });
  if (!masihTersedia) {
    const lines = ['*SIMANTAP BMN*', '', '❌ ' + unit.label + ' sudah tidak tersedia pada jadwal tersebut.'];
    if (options.length) {
      lines.push('', 'Unit yang masih tersedia:');
      options.forEach(function(item) { lines.push('[' + item.id + '] ' + item.label); });
      simpanKonteksWaOperator_({ id: id, tipe: 'kendaraan', mode: 'PILIH_UNIT', units: options });
      lines.push('', 'Balas angka 1 sampai ' + options.length + ' sesuai unit yang dipilih.');
    } else {
      lines.push('', 'Saat ini tidak ada unit ' + (trx.jenisMobil || '') + ' yang tersedia.');
    }
    kirimBalasanWaOperatorAman_('WA_PILIH_UNIT_UNAVAILABLE', id, sender, lines.join('\n'));
    return { processed: false, command: 'PILIH', targetId: id, reason: 'UNIT_UNAVAILABLE' };
  }

  const hasil = ubahStatusKendaraan(id, 'ACC', unit.label, '', 'WA');

  catatAuditAktivitas_({
    requestId: requestId,
    actor: 'Operator WhatsApp',
    action: 'WA_ACC_KENDARAAN',
    targetId: id,
    statusLama: trx.status,
    statusBaru: 'ACC',
    detail: 'Persetujuan kendaraan melalui WhatsApp. Unit: ' + unit.label
  });

  const nextContext = tandaiKonteksWaSelesai_(id, 'Kendaraan disetujui melalui WhatsApp operator. Unit: ' + unit.label);
  const linesSuccess = [
    '*SIMANTAP BMN*',
    '',
    '✅ BERHASIL',
    '',
    id + ' telah DISETUJUI.',
    'Mobil: ' + unit.label,
    'SIMANTAP telah memproses notifikasi status kepada peminjam.'
  ];
  Array.prototype.push.apply(linesSuccess, buatRingkasanAntreanBerikutnyaWa_(nextContext));

  kirimBalasanWaOperatorAman_(
    'WA_PILIH_SUCCESS',
    id,
    sender,
    linesSuccess.join('\n')
  );

  return { processed: true, command: 'PILIH', targetId: id, status: 'ACC', mobilDitugaskan: unit.label, result: hasil };
}

function ambilTransaksiUntukWa_(idInput) {
  const id = String(idInput || '').trim().toUpperCase();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = null;
  let tipe = '';
  let kolomStatus = 0;
  let minKolom = 0;

  if (id.indexOf('JDW-') === 0) {
    tipe = 'booking';
    sheet = ss.getSheetByName(SHEET_JADWAL);
    kolomStatus = 7;
    minKolom = 14;
  } else if (id.indexOf('KND-') === 0) {
    tipe = 'kendaraan';
    sheet = ss.getSheetByName(SHEET_PINJAM_KENDARAAN);
    kolomStatus = 8;
    minKolom = 14;
  } else if (id.indexOf('SPR-') === 0) {
    tipe = 'sarpras';
    sheet = ss.getSheetByName(SHEET_PINJAM_SARPRAS);
    kolomStatus = 9;
    minKolom = 12;
  } else {
    return { found: false, id: id, tipe: '' };
  }

  if (!sheet || sheet.getLastRow() < 2) return { found: false, id: id, tipe: tipe };
  const rowIndex = findRowById_(sheet, id, 1);
  if (rowIndex < 2) return { found: false, id: id, tipe: tipe };

  const row = sheet.getRange(rowIndex, 1, 1, Math.max(sheet.getLastColumn(), minKolom)).getDisplayValues()[0];
  const status = String(row[kolomStatus - 1] || '').trim() || 'Pending';
  const result = {
    found: true,
    id: id,
    tipe: tipe,
    rowIndex: rowIndex,
    status: status,
    nama: String(row[2] || '').trim(),
    kegiatan: String(row[3] || '').trim()
  };

  if (tipe === 'kendaraan') {
    result.tujuan = String(row[4] || '').trim();
    result.batasKembali = String(row[6] || '').trim();
    result.jenisMobil = String(row[11] || '').trim();
    result.mulaiPenggunaan = String(row[12] || '').trim();
    result.mobilDitugaskan = String(row[13] || '').trim();
  }

  return result;
}

function daftarUnitTersediaWa_(trx) {
  if (!trx || trx.tipe !== 'kendaraan' || !trx.jenisMobil || !trx.mulaiPenggunaan || !trx.batasKembali) return [];
  const semua = getPinjamKendaraan();
  return getMasterKendaraan_().filter(function(unit) {
    if (normalisasiTeks_(unit.jenisMobil) !== normalisasiTeks_(trx.jenisMobil)) return false;
    return !cekBentrokUnitKendaraanDariDaftar_(unit.label, trx.mulaiPenggunaan, trx.batasKembali, trx.id, semua);
  });
}

function pesanDataTidakDitemukanWa_(id) {
  return ['*SIMANTAP BMN*', '', '❌ Data ' + (id || '-') + ' tidak ditemukan.', 'Pastikan ID sama persis dengan yang tercantum pada notifikasi pengajuan.'].join('\n');
}

function pesanStatusSudahDiprosesWa_(trx) {
  return [
    '*SIMANTAP BMN*',
    '',
    'ℹ️ ' + (trx.id || '-') + ' sudah berstatus ' + (trx.status || '-') + '.',
    'Tidak ada perubahan yang dilakukan.'
  ].join('\n');
}

function kirimBalasanWaOperatorAman_(eventName, targetId, sender, pesan) {
  return kirimNotifWhatsAppKeTargetAman_(eventName, targetId, sender, pesan);
}

// ================================================================
// NOTIFIKASI WHATSAPP OPERATOR - FONNTE
// ================================================================
// Prinsip:
// 1. Token dan nomor operator hanya dibaca dari Script Properties.
// 2. Pengiriman WA dilakukan setelah transaksi utama berhasil tersimpan.
// 3. Gagal kirim WA TIDAK BOLEH menggagalkan transaksi utama.
// 4. Token Fonnte tidak pernah ditulis ke log atau dikirim ke frontend.

function cekKonfigurasiNotifikasiWhatsApp() {
  const props = PropertiesService.getScriptProperties();
  const target = normalisasiNomorWaIndonesia_(props.getProperty('WA_OPERATOR') || '');
  const groupKendaraan = normalisasiTargetFonnte_(props.getProperty('WA_GROUP_KENDARAAN') || '');
  const groupRuangan = normalisasiTargetFonnte_(props.getProperty('WA_GROUP_RUANGAN') || '');

  return {
    fonnteTokenConfigured: !!String(props.getProperty('FONNTE_TOKEN') || '').trim(),
    waOperatorConfigured: !!target,
    waOperatorMasked: target ? samarkanNomorWa_(target) : '',

    waGroupKendaraanConfigured: !!groupKendaraan && isFonnteGroupTarget_(groupKendaraan),
    waGroupKendaraanMasked: groupKendaraan && isFonnteGroupTarget_(groupKendaraan)
      ? samarkanTargetFonnte_(groupKendaraan)
      : '',

    waGroupRuanganConfigured: !!groupRuangan && isFonnteGroupTarget_(groupRuangan),
    waGroupRuanganMasked: groupRuangan && isFonnteGroupTarget_(groupRuangan)
      ? samarkanTargetFonnte_(groupRuangan)
      : '',

    endpoint: FONNTE_API_URL
  };
}

function testFonnteNotification() {
  const pesan =
    '*SIMANTAP BMN*\n\n' +
    'Tes notifikasi WhatsApp berhasil.\n' +
    'Backend Google Apps Script sudah terhubung dengan Fonnte.\n\n' +
    'Kantor Wilayah Kementerian Hukum Nusa Tenggara Barat';

  try {
    const hasil = kirimNotifWhatsApp_('TEST_NOTIFIKASI', 'TEST', pesan);
    catatNotificationLog_({
      event: 'TEST_NOTIFIKASI',
      targetId: 'TEST',
      penerima: hasil.target,
      status: 'QUEUED',
      httpCode: hasil.httpCode,
      providerRequestId: hasil.providerRequestId,
      detail: hasil.detail
    });
    return hasil;
  } catch (e) {
    catatNotificationLog_({
      event: 'TEST_NOTIFIKASI',
      targetId: 'TEST',
      penerima: '',
      status: 'FAILED',
      httpCode: '',
      providerRequestId: '',
      detail: bersihkanPesanError_(e)
    });
    throw e;
  }
}

function kirimNotifWhatsAppAman_(eventName, targetId, pesan) {
  const target = normalisasiNomorWaIndonesia_(PropertiesService.getScriptProperties().getProperty('WA_OPERATOR') || '');
  return kirimNotifWhatsAppKeTargetAman_(eventName, targetId, target, pesan);
}

function kirimNotifStatusPeminjamAman_(eventName, targetId, whatsapp, pesanClient, pesanGrup) {
  const target = normalisasiNomorWaIndonesia_(whatsapp || '');
  let hasilPeminjam;

  if (!target) {
    catatNotificationLog_({
      event: eventName, targetId: targetId, penerima: '', status: 'SKIPPED', httpCode: '', providerRequestId: '',
      detail: 'Nomor WhatsApp peminjam tidak tersedia atau tidak valid.'
    });
    hasilPeminjam = { ok: false, skipped: true, reason: 'INVALID_CLIENT_TARGET' };
  } else {
    hasilPeminjam = kirimNotifWhatsAppKeTargetAman_(
      eventName,
      targetId,
      target,
      String(pesanClient || '').trim()
    );
  }

  // Grup kendaraan/ruangan hanya menerima snapshot daftar kerja saat ada ACC.
  // TOLAK tidak dikirim ke grup. Sarpras tetap client-only.
  let hasilGrup = { ok: false, skipped: true, reason: 'CLIENT_ONLY' };
  if (String(pesanGrup || '').trim()) {
    hasilGrup = kirimNotifStatusGrupAman_(
      eventName,
      targetId,
      String(pesanGrup || '').trim()
    );
  }

  return {
    ok: !!(hasilPeminjam && hasilPeminjam.ok),
    client: hasilPeminjam,
    group: hasilGrup
  };
}

function tentukanTargetGrupStatus_(eventName) {
  const props = PropertiesService.getScriptProperties();
  const event = String(eventName || '').trim().toUpperCase();

  let propertyName = '';
  let label = '';

  if (event === 'STATUS_PINJAM_KENDARAAN') {
    propertyName = 'WA_GROUP_KENDARAAN';
    label = 'KENDARAAN';
  } else if (event === 'STATUS_PINJAM_RUANGAN') {
    propertyName = 'WA_GROUP_RUANGAN';
    label = 'RUANGAN';
  } else if (event === 'STATUS_PINJAM_SARPRAS') {
    // Sarpras hanya dikirim ke WA client/peminjam.
    // Tidak ada mirror ke grup karena tidak ada grup yang relevan.
    return {
      ok: false,
      skipped: true,
      reason: 'SARPRAS_CLIENT_ONLY',
      propertyName: '',
      label: 'SARPRAS'
    };
  } else {
    return {
      ok: false,
      skipped: true,
      reason: 'GROUP_ROUTE_NOT_DEFINED',
      propertyName: '',
      label: ''
    };
  }

  const target = normalisasiTargetFonnte_(props.getProperty(propertyName) || '');
  if (!target) {
    return {
      ok: false,
      skipped: true,
      reason: propertyName + '_NOT_CONFIGURED',
      propertyName: propertyName,
      label: label
    };
  }

  if (!isFonnteGroupTarget_(target)) {
    return {
      ok: false,
      skipped: true,
      reason: propertyName + '_NOT_GROUP_ID',
      propertyName: propertyName,
      label: label
    };
  }

  return {
    ok: true,
    target: target,
    propertyName: propertyName,
    label: label
  };
}

function kirimNotifStatusGrupAman_(eventName, targetId, pesan) {
  const route = tentukanTargetGrupStatus_(eventName);
  if (!route.ok) return route;

  // Grup sudah dipisahkan per jenis layanan, jadi tidak perlu header monitoring tambahan.
  // Pesan dibuat sama ringkasnya dengan pesan yang diterima client.
  const pesanGrup = String(pesan || '').trim();

  return kirimNotifWhatsAppKeTargetAman_(
    String(eventName || 'STATUS') + '_GROUP_' + route.label,
    targetId,
    route.target,
    pesanGrup
  );
}

function testFonnteGroupKendaraan() {
  const route = tentukanTargetGrupStatus_('STATUS_PINJAM_KENDARAAN');
  if (!route.ok) {
    throw new Error('WA_GROUP_KENDARAAN belum dikonfigurasi dengan Group ID Fonnte yang valid.');
  }

  return kirimNotifWhatsAppKeTarget_(
    'TEST_DAFTAR_KERJA_KENDARAAN',
    'TEST-GROUP-KENDARAAN',
    route.target,
    buatPesanDaftarKerjaKendaraanGrup_()
  );
}

function testFonnteGroupRuangan() {
  const route = tentukanTargetGrupStatus_('STATUS_PINJAM_RUANGAN');
  if (!route.ok) {
    throw new Error('WA_GROUP_RUANGAN belum dikonfigurasi dengan Group ID Fonnte yang valid.');
  }

  return kirimNotifWhatsAppKeTarget_(
    'TEST_DAFTAR_KERJA_RUANGAN',
    'TEST-GROUP-RUANGAN',
    route.target,
    buatPesanDaftarKerjaRuanganGrup_()
  );
}

// Dipertahankan untuk kompatibilitas jika function test lama masih dipilih di editor.
function testFonnteGroupNotification() {
  return {
    kendaraan: testFonnteGroupKendaraan(),
    ruangan: testFonnteGroupRuangan()
  };
}

function kirimNotifWhatsAppKeTargetAman_(eventName, targetId, target, pesan) {
  try {
    const hasil = kirimNotifWhatsAppKeTarget_(eventName, targetId, target, pesan);
    catatNotificationLog_({
      event: eventName,
      targetId: targetId,
      penerima: hasil.target,
      status: 'QUEUED',
      httpCode: hasil.httpCode,
      providerRequestId: hasil.providerRequestId,
      detail: hasil.detail
    });
    return { ok: true, result: hasil };
  } catch (e) {
    const detail = bersihkanPesanError_(e) || 'Notifikasi WhatsApp gagal dikirim.';
    catatNotificationLog_({
      event: eventName,
      targetId: targetId,
      penerima: target || '',
      status: 'FAILED',
      httpCode: '',
      providerRequestId: '',
      detail: detail
    });
    console.error('Notifikasi WhatsApp gagal [' + eventName + ' / ' + targetId + ']: ' + detail);
    return { ok: false, error: detail };
  }
}

function kirimNotifWhatsApp_(eventName, targetId, pesan) {
  const target = normalisasiNomorWaIndonesia_(PropertiesService.getScriptProperties().getProperty('WA_OPERATOR') || '');
  if (!target) throw new Error('WA_OPERATOR belum dikonfigurasi atau format nomornya tidak valid.');
  return kirimNotifWhatsAppKeTarget_(eventName, targetId, target, pesan);
}

function kirimNotifWhatsAppKeTarget_(eventName, targetId, targetInput, pesan) {
  const props = PropertiesService.getScriptProperties();
  const token = String(props.getProperty('FONNTE_TOKEN') || '').trim();
  const target = normalisasiTargetFonnte_(targetInput || '');

  if (!token) throw new Error('FONNTE_TOKEN belum dikonfigurasi pada Script Properties.');
  if (!target) throw new Error('Target WhatsApp/Fonnte tidak valid.');

  const teks = String(pesan || '').trim();
  if (!teks) throw new Error('Pesan notifikasi WhatsApp kosong.');

  const payload = { target: target, message: teks };
  if (!isFonnteGroupTarget_(target)) payload.countryCode = '62';

  const response = UrlFetchApp.fetch(FONNTE_API_URL, {
    method: 'post',
    headers: { Authorization: token },
    payload: payload,
    muteHttpExceptions: true
  });

  const httpCode = response.getResponseCode();
  const responseText = String(response.getContentText() || '').trim();
  let json = null;
  try { json = responseText ? JSON.parse(responseText) : null; } catch (e) { json = null; }

  if (httpCode < 200 || httpCode >= 300) throw new Error('Fonnte HTTP ' + httpCode + ': ' + ringkasTeks_(responseText, 350));
  if (!json || json.status !== true) {
    const providerMessage = json && (json.reason || json.detail || json.message)
      ? (json.reason || json.detail || json.message)
      : responseText;
    throw new Error('Fonnte menolak pengiriman: ' + ringkasTeks_(providerMessage, 350));
  }

  const providerRequestId = String(json.requestid || json.requestId || '').trim();
  const process = String(json.process || '').trim();
  const detail = String(json.detail || 'Pesan diterima Fonnte.').trim() + (process ? ' | process=' + process : '');

  return {
    ok: true,
    event: String(eventName || '').trim(),
    targetId: String(targetId || '').trim(),
    target: target,
    maskedTarget: samarkanNomorWa_(target),
    httpCode: httpCode,
    providerRequestId: providerRequestId,
    process: process,
    detail: detail
  };
}

function buatPesanNotifPinjamRuangan_(idBooking, data) {
  data = data || {};
  return [
    '*SIMANTAP BMN*',
    '*Pengajuan Pinjam Ruangan Baru*',
    '',
    'ID: ' + (idBooking || '-'),
    'Peminjam: ' + (data.nama || '-'),
    'NIP: ' + (data.nip || '-'),
    'Kegiatan: ' + (data.namaKegiatan || '-'),
    'Ruangan: ' + (data.ruangan || '-'),
    'Tanggal: ' + formatTanggalIndonesiaDariInput_(data.tanggalInput),
    'Waktu: ' + (data.jamMulai || '-') + ' - ' + (data.jamSelesai || '-') + ' WITA',
    'Jumlah Peserta: ' + (data.jumlahPeserta || '-'),
    'Peserta/Jabatan: ' + (data.pesertaJabatan || '-'),
    'Status: Pending',
    '',
    '*Balas langsung:*',
    '```ACC```',
    'atau',
    '```TOLAK_Alasan penolakan```',
    '',
    '_Catatan: perintah singkat diproses berdasarkan antrean masuk paling awal (FIFO)._ '
  ].join('\n');
}

function buatPesanNotifPinjamKendaraan_(data) {
  data = data || {};
  return [
    '*SIMANTAP BMN*',
    '*Pengajuan Pinjam Kendaraan Baru*',
    '',
    'ID: ' + (data.idPinjam || '-'),
    'Peminjam: ' + (data.nama || '-'),
    'NIP: ' + (data.nip || '-'),
    'Kegiatan: ' + (data.kegiatan || '-'),
    'Tujuan: ' + (data.tujuan || '-'),
    'Jenis Mobil: ' + (data.jenisMobil || '-'),
    'Mulai: ' + formatDateTimeLocalIndonesia_(data.mulaiPenggunaan),
    'Batas Kembali: ' + formatDateTimeLocalIndonesia_(data.batasKembali),
    'Status: Pending',
    '',
    '*Balas langsung:*',
    '```ACC```',
    'atau',
    '```TOLAK_Alasan penolakan```',
    '',
    'Jika ACC, SIMANTAP akan mengirim daftar unit kendaraan yang tersedia.',
    '',
    '_Catatan: perintah singkat diproses berdasarkan antrean masuk paling awal (FIFO)._ '
  ].join('\n');
}

function buatPesanNotifPinjamSarpras_(data) {
  data = data || {};
  return [
    '*SIMANTAP BMN*',
    '*Pengajuan Pinjam Sarpras Baru*',
    '',
    'ID: ' + (data.idPinjam || '-'),
    'Peminjam: ' + (data.nama || '-'),
    'NIP: ' + (data.nip || '-'),
    'Kegiatan: ' + (data.kegiatan || '-'),
    'Tempat: ' + (data.tujuan || '-'),
    'Jenis Barang: ' + (data.jenisBarang || '-'),
    'Lama Penggunaan: ' + (data.lama || '-'),
    'Batas Kembali: ' + formatDateTimeLocalIndonesia_(data.batasKembali),
    'Status: Pending',
    '',
    '*Balas langsung:*',
    '```ACC```',
    'atau',
    '```TOLAK_Alasan penolakan```',
    '',
    '_Catatan: perintah singkat diproses berdasarkan antrean masuk paling awal (FIFO)._ '
  ].join('\n');
}

function buatPesanStatusClientPinjamRuangan_(data) {
  const disetujui = String(data.status || '') === 'ACC';
  const nama = data.nama || 'Pemohon';

  if (disetujui) {
    const lines = [
      '✅ *PENGAJUAN DISETUJUI*',
      '',
      'Halo ' + nama + ', pengajuan penggunaan ruangan Anda telah disetujui.',
      '',
      '🏢 Ruangan: ' + (data.ruangan || '-'),
      '🕒 Jadwal: ' + formatTanggalIndonesiaDariInput_(data.tanggal) + ', ' + (data.mulai || '-') + ' - ' + (data.selesai || '-') + ' WITA',
      '📋 Kegiatan: ' + (data.namaKegiatan || '-')
    ];

    if (data.keteranganAdmin) lines.push('📝 Catatan: ' + data.keteranganAdmin);
    lines.push('', 'ID: ' + (data.idBooking || '-'));
    return lines.join('\n');
  }

  return [
    '❌ *PENGAJUAN DITOLAK*',
    '',
    'Halo ' + nama + ', pengajuan penggunaan ruangan Anda belum dapat disetujui.',
    '',
    '🏢 Ruangan: ' + (data.ruangan || '-'),
    '📝 Alasan: ' + (data.keteranganAdmin || '-'),
    '',
    'ID: ' + (data.idBooking || '-')
  ].join('\n');
}

function buatPesanStatusClientPinjamKendaraan_(data) {
  const disetujui = String(data.status || '') === 'ACC';
  const nama = data.nama || 'Pemohon';
  const kendaraan = data.mobilDitugaskan || data.jenisMobil || '-';

  if (disetujui) {
    const lines = [
      '✅ *PENGAJUAN DISETUJUI*',
      '',
      'Halo ' + nama + ', pengajuan peminjaman kendaraan Anda telah disetujui.',
      '',
      '🚗 Kendaraan: ' + kendaraan,
      '🕒 Jadwal: ' + formatDateTimeLocalIndonesia_(data.mulaiPenggunaan) + ' s.d. ' + formatDateTimeLocalIndonesia_(data.batasKembali),
      '📍 Tujuan: ' + (data.tujuan || '-')
    ];

    if (data.keteranganAdmin) lines.push('📝 Catatan: ' + data.keteranganAdmin);
    lines.push('', 'ID: ' + (data.idPinjam || '-'));
    return lines.join('\n');
  }

  return [
    '❌ *PENGAJUAN DITOLAK*',
    '',
    'Halo ' + nama + ', pengajuan peminjaman kendaraan Anda belum dapat disetujui.',
    '',
    '📝 Alasan: ' + (data.keteranganAdmin || '-'),
    '',
    'ID: ' + (data.idPinjam || '-')
  ].join('\n');
}

function buatPesanStatusClientPinjamSarpras_(data) {
  const disetujui = String(data.status || '') === 'ACC';
  const nama = data.nama || 'Pemohon';

  if (disetujui) {
    const lines = [
      '✅ *PENGAJUAN DISETUJUI*',
      '',
      'Halo ' + nama + ', pengajuan peminjaman sarana/prasarana Anda telah disetujui.',
      '',
      '📦 Barang: ' + (data.jenisBarang || '-'),
      '📍 Tempat: ' + (data.tujuan || '-'),
      '⏱ Batas kembali: ' + formatDateTimeLocalIndonesia_(data.batasKembali)
    ];

    if (data.keteranganAdmin) lines.push('📝 Catatan: ' + data.keteranganAdmin);
    lines.push('', 'ID: ' + (data.idPinjam || '-'));
    return lines.join('\n');
  }

  return [
    '❌ *PENGAJUAN DITOLAK*',
    '',
    'Halo ' + nama + ', pengajuan peminjaman sarana/prasarana Anda belum dapat disetujui.',
    '',
    '📦 Barang: ' + (data.jenisBarang || '-'),
    '📝 Alasan: ' + (data.keteranganAdmin || '-'),
    '',
    'ID: ' + (data.idPinjam || '-')
  ].join('\n');
}

function buatPesanDaftarKerjaKendaraanGrup_() {
  const sekarang = new Date();
  const daftar = getPinjamKendaraan()
    .filter(function(row) {
      if (String(row.status || '').trim() !== 'ACC') return false;

      const selesai = parseDateTimeLocal_(row.batasKembali || '');
      if (!selesai || selesai < sekarang) return false;

      const mulai = parseDateTimeLocal_(row.mulaiPenggunaan || '');
      if (!mulai) return false;

      // Daftar grup hanya berisi transaksi yang sudah memiliki unit aktual.
      if (!String(row.mobilDitugaskan || '').trim()) return false;

      return true;
    })
    .sort(function(a, b) {
      const aMulai = parseDateTimeLocal_(a.mulaiPenggunaan || '');
      const bMulai = parseDateTimeLocal_(b.mulaiPenggunaan || '');
      return (aMulai ? aMulai.getTime() : Number.MAX_SAFE_INTEGER) -
             (bMulai ? bMulai.getTime() : Number.MAX_SAFE_INTEGER);
    });

  const lines = [
    '🚗 *DAFTAR TUGAS KENDARAAN*',
    '_Update: ' + formatWaktuUpdateGrup_() + '_',
    ''
  ];

  if (!daftar.length) {
    lines.push('Belum ada permintaan kendaraan yang perlu dilaksanakan.');
    return lines.join('\n');
  }

  const maxItem = 20;
  daftar.slice(0, maxItem).forEach(function(row, index) {
    lines.push(
      (index + 1) + '. *' + formatRentangKendaraanGrup_(row.mulaiPenggunaan, row.batasKembali) + '*',
      '   ' + (row.nama || '-'),
      '   🚗 ' + (row.mobilDitugaskan || row.jenisMobil || '-'),
      '   📍 ' + (row.tujuan || '-'),
      '   📝 ' + (row.kegiatan || '-')
    );

    if (row.keteranganAdmin) {
      lines.push('   ℹ️ ' + row.keteranganAdmin);
    }

    if (index < Math.min(daftar.length, maxItem) - 1) lines.push('');
  });

  if (daftar.length > maxItem) {
    lines.push('', '+ ' + (daftar.length - maxItem) + ' permintaan lainnya.');
  }

  lines.push('', 'Mohon kendaraan dapat dipersiapkan sesuai jadwal.');
  return lines.join('\n');
}

function buatPesanDaftarKerjaRuanganGrup_() {
  const sekarang = new Date();

  const daftar = getJadwal()
    .map(function(row) {
      const tanggal = parseTanggal_(row.tanggal);
      const menitMulai = parseJamKeMenit_(row.mulai);
      const menitSelesai = parseJamKeMenit_(row.selesai);

      let mulai = null;
      let selesai = null;

      if (tanggal && menitMulai !== null) mulai = buatDateTime_(tanggal, menitMulai);
      if (tanggal && menitSelesai !== null) selesai = buatDateTime_(tanggal, menitSelesai);

      return {
        row: row,
        mulaiDate: mulai,
        selesaiDate: selesai
      };
    })
    .filter(function(item) {
      if (String(item.row.status || '').trim() !== 'ACC') return false;
      if (!item.mulaiDate || !item.selesaiDate) return false;
      return item.selesaiDate >= sekarang;
    })
    .sort(function(a, b) {
      return a.mulaiDate.getTime() - b.mulaiDate.getTime();
    });

  const lines = [
    '🏢 *DAFTAR PERSIAPAN RUANGAN*',
    '_Update: ' + formatWaktuUpdateGrup_() + '_',
    ''
  ];

  if (!daftar.length) {
    lines.push('Belum ada ruangan yang perlu dipersiapkan.');
    return lines.join('\n');
  }

  const maxItem = 20;
  daftar.slice(0, maxItem).forEach(function(item, index) {
    const row = item.row;

    lines.push(
      (index + 1) + '. *' + (row.ruangan || '-') + '*',
      '   🕒 ' + formatJadwalRuanganGrup_(row.tanggal, row.mulai, row.selesai),
      '   📋 ' + (row.namaKegiatan || '-'),
      '   👤 ' + (row.nama || '-'),
      '   👥 Peserta: ' + (row.jumlahPeserta || '-') + ' orang'
    );

    const kebutuhan = formatPersiapanBmnGrup_(row.bmnPinjam);
    if (kebutuhan.length) {
      lines.push('   🧰 Persiapan:');
      kebutuhan.forEach(function(itemBmn) {
        lines.push('      • ' + itemBmn);
      });
    } else {
      lines.push('   🧰 Persiapan: tidak ada BMN tambahan');
    }

    if (row.keteranganAdmin) {
      lines.push('   ℹ️ ' + row.keteranganAdmin);
    }

    if (index < Math.min(daftar.length, maxItem) - 1) lines.push('');
  });

  if (daftar.length > maxItem) {
    lines.push('', '+ ' + (daftar.length - maxItem) + ' permintaan lainnya.');
  }

  lines.push('', 'Mohon ruangan dan perlengkapan dapat dipersiapkan sesuai jadwal.');
  return lines.join('\n');
}

function formatWaktuUpdateGrup_() {
  const zona = Session.getScriptTimeZone() || 'Asia/Makassar';
  return Utilities.formatDate(new Date(), zona, 'dd/MM/yyyy HH:mm') + ' WITA';
}

function formatRentangKendaraanGrup_(mulaiInput, selesaiInput) {
  const mulai = parseDateTimeLocal_(mulaiInput);
  const selesai = parseDateTimeLocal_(selesaiInput);

  if (!mulai || !selesai) {
    return formatDateTimeLocalIndonesia_(mulaiInput) + ' s.d. ' +
      formatDateTimeLocalIndonesia_(selesaiInput);
  }

  const zona = Session.getScriptTimeZone() || 'Asia/Makassar';
  const tanggalMulai = Utilities.formatDate(mulai, zona, 'dd/MM/yyyy');
  const tanggalSelesai = Utilities.formatDate(selesai, zona, 'dd/MM/yyyy');
  const jamMulai = Utilities.formatDate(mulai, zona, 'HH:mm');
  const jamSelesai = Utilities.formatDate(selesai, zona, 'HH:mm');

  if (tanggalMulai === tanggalSelesai) {
    return tanggalMulai + ' | ' + jamMulai + '-' + jamSelesai + ' WITA';
  }

  return tanggalMulai + ' ' + jamMulai + ' s.d. ' +
    tanggalSelesai + ' ' + jamSelesai + ' WITA';
}

function formatJadwalRuanganGrup_(tanggalInput, mulai, selesai) {
  const tanggal = parseTanggal_(tanggalInput);
  let tanggalRingkas = String(tanggalInput || '-').trim() || '-';

  if (tanggal) {
    const zona = Session.getScriptTimeZone() || 'Asia/Makassar';
    tanggalRingkas = Utilities.formatDate(tanggal, zona, 'dd/MM/yyyy');
  }

  return tanggalRingkas + ' | ' +
    String(mulai || '-').trim() + '-' +
    String(selesai || '-').trim() + ' WITA';
}

function formatPersiapanBmnGrup_(value) {
  const teks = String(value || '').trim();
  if (!teks || teks === '-') return [];

  return teks
    .split(';')
    .map(function(item) {
      return String(item || '').replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);
}

function buatPesanNotifPemeliharaan_(data) {
  data = data || {};
  return [
    '*SIMANTAP BMN*',
    '*Laporan Pemeliharaan Baru*',
    '',
    'ID: ' + (data.idPemeliharaan || '-'),
    'Kode Barang: ' + (data.kodeBarang || '-'),
    'NUP: ' + (data.nup || '-'),
    'Nama BMN: ' + (data.namaBmn || '-'),
    'Tanggal: ' + formatTanggalIndonesiaDariInput_(data.tanggal),
    'Keterangan: ' + ringkasTeks_(data.deskripsi || '-', 400),
    'Status: Pending',
    '',
    'Silakan buka Dashboard Administrator SIMANTAP BMN untuk melakukan verifikasi.'
  ].join('\n');
}

function normalisasiNomorWaIndonesia_(value) {
  let nomor = String(value || '').replace(/\D/g, '');
  if (!nomor) return '';
  if (nomor.indexOf('0') === 0) nomor = '62' + nomor.substring(1);
  if (nomor.indexOf('62') !== 0) nomor = '62' + nomor;
  if (!/^62\d{8,15}$/.test(nomor)) return '';
  return nomor;
}

function isFonnteGroupTarget_(value) {
  return /^\d{5,}@g\.us$/i.test(String(value || '').trim());
}

function normalisasiTargetFonnte_(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (isFonnteGroupTarget_(raw)) return raw.toLowerCase();
  return normalisasiNomorWaIndonesia_(raw);
}

function samarkanTargetFonnte_(value) {
  const raw = String(value || '').trim();
  if (isFonnteGroupTarget_(raw)) {
    const id = raw.replace(/@g\.us$/i, '');
    if (id.length <= 8) return '***@g.us';
    return id.substring(0, 4) + '****' + id.substring(id.length - 4) + '@g.us';
  }
  return samarkanNomorWa_(raw);
}

function samarkanNomorWa_(value) {
  const nomor = String(value || '').replace(/\D/g, '');
  if (nomor.length <= 7) return nomor ? '***' : '';
  return nomor.substring(0, 4) + '****' + nomor.substring(nomor.length - 4);
}

function formatTanggalIndonesiaDariInput_(value) {
  const tanggal = parseTanggal_(value);
  if (!tanggal) return String(value || '-').trim() || '-';
  const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return hari[tanggal.getDay()] + ', ' + String(tanggal.getDate()).padStart(2, '0') + ' ' + bulan[tanggal.getMonth()] + ' ' + tanggal.getFullYear();
}

function formatDateTimeLocalIndonesia_(value) {
  const parsed = parseDateTimeLocal_(value);
  if (!parsed) return String(value || '').trim() || '-';
  const jam = String(parsed.getHours()).padStart(2, '0');
  const menit = String(parsed.getMinutes()).padStart(2, '0');
  return formatTanggalIndonesiaDariInput_(parsed) + ', ' + jam + ':' + menit + ' WITA';
}

function ringkasTeks_(value, max) {
  const teks = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const batas = Math.max(10, Number(max || 300));
  if (teks.length <= batas) return teks;
  return teks.substring(0, batas - 3).trim() + '...';
}

function getOrCreateNotificationLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NOTIFICATION_LOG);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NOTIFICATION_LOG);
    sheet.getRange(1, 1, 1, NOTIFICATION_LOG_HEADERS.length).setValues([NOTIFICATION_LOG_HEADERS]);
    return sheet;
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, NOTIFICATION_LOG_HEADERS.length).setValues([NOTIFICATION_LOG_HEADERS]);
  }
  return sheet;
}

function catatNotificationLog_(data) {
  try {
    const sheet = getOrCreateNotificationLogSheet_();
    sheet.appendRow([
      new Date(),
      'WhatsApp/Fonnte',
      String(data.event || '-').trim(),
      String(data.targetId || '-').trim(),
      samarkanTargetFonnte_(data.penerima || ''),
      String(data.status || '-').trim(),
      String(data.httpCode || '-').trim(),
      String(data.providerRequestId || '-').trim(),
      ringkasTeks_(data.detail || '-', 700)
    ]);
  } catch (e) {
    // Logging notifikasi tidak boleh mengganggu transaksi utama.
    console.error('Notification log gagal: ' + bersihkanPesanError_(e));
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

    validasiPanjangTeks_(kodeBarang, 'Kode Barang', 100);
    validasiPanjangTeks_(nup, 'NUP', 50);
    validasiPanjangTeks_(namaBmn, 'Nama BMN', MAX_TEXT.namaBmn);

    const merk = String(form.merk || '').trim();
    const tahunPerolehan = String(form.tahunPerolehan || form.tahun || '').trim();
    const kondisi = String(form.kondisi || '').trim() || 'Baik';
    const lokasi = String(form.lokasi || '').trim();
    const pj = String(form.pj || '').trim();

    validasiPanjangTeks_(merk, 'Merk', MAX_TEXT.merk);
    validasiPanjangTeks_(lokasi, 'Lokasi', MAX_TEXT.lokasi);
    validasiPanjangTeks_(pj, 'Penanggung Jawab/Pemilik', MAX_TEXT.pj);

    if (tahunPerolehan && !/^\d{4}$/.test(tahunPerolehan)) {
      throw new Error('Tahun Perolehan harus berupa 4 digit tahun.');
    }

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
    sheet.appendRow(['ID Booking', 'Tanggal', 'Ruangan', 'Jam Mulai', 'Jam Selesai', 'Nama Peminjam', 'Status', 'BMN Dipinjam', 'Nama Kegiatan', 'Jumlah Peserta', 'Peserta/Jabatan', 'NIP', 'No WhatsApp', 'Keterangan Admin']);
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
  const header = ['ID Pinjam', 'Tanggal Pengajuan', 'Nama Peminjam', 'Kegiatan', 'Tujuan', 'Lama Penggunaan', 'Batas Kembali', 'Status', 'Keterangan Admin', 'NIP', 'No WhatsApp', 'Jenis Mobil', 'Mulai Penggunaan', 'Mobil Ditugaskan'];
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PINJAM_KENDARAAN);
    sheet.appendRow(header);
    return sheet;
  }
  if (sheet.getLastRow() === 0) sheet.appendRow(header);
  pastikanKolomPinjamKendaraanTambahan_(sheet);
  return sheet;
}

function pastikanKolomPinjamKendaraanTambahan_(sheet) {
  pastikanHeaderMinimal_(sheet, ['ID Pinjam', 'Tanggal Pengajuan', 'Nama Peminjam', 'Kegiatan', 'Tujuan', 'Lama Penggunaan', 'Batas Kembali', 'Status', 'Keterangan Admin', 'NIP', 'No WhatsApp', 'Jenis Mobil', 'Mulai Penggunaan', 'Mobil Ditugaskan']);
}

function getOrCreatePinjamSarprasSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_PINJAM_SARPRAS);
  const header = ['ID Pinjam', 'Tanggal Pengajuan', 'Nama Peminjam', 'Kegiatan', 'Tempat Kegiatan', 'Jenis Barang', 'Lama Penggunaan', 'Batas Kembali', 'Status', 'NIP', 'No WhatsApp', 'Keterangan Admin'];
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PINJAM_SARPRAS);
    sheet.appendRow(header);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
  }
  pastikanKolomPinjamSarprasTambahan_(sheet);
  return sheet;
}

function pastikanKolomPinjamSarprasTambahan_(sheet) {
  pastikanHeaderMinimal_(sheet, ['ID Pinjam', 'Tanggal Pengajuan', 'Nama Peminjam', 'Kegiatan', 'Tempat Kegiatan', 'Jenis Barang', 'Lama Penggunaan', 'Batas Kembali', 'Status', 'NIP', 'No WhatsApp', 'Keterangan Admin']);
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
  pastikanHeaderMinimal_(sheet, ['ID Booking', 'Tanggal', 'Ruangan', 'Jam Mulai', 'Jam Selesai', 'Nama Peminjam', 'Status', 'BMN Dipinjam', 'Nama Kegiatan', 'Jumlah Peserta', 'Peserta/Jabatan', 'NIP', 'No WhatsApp', 'Keterangan Admin']);
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
  const numCols = Math.max(sheet.getLastColumn(), headers.length);
  const currentHeaderRow = sheet.getRange(1, 1, 1, numCols).getDisplayValues()[0];
  let changed = false;
  const newHeaderRow = [...currentHeaderRow];

  headers.forEach(function (h, idx) {
    if (normalisasiTeks_(currentHeaderRow[idx]) !== normalisasiTeks_(h)) {
      newHeaderRow[idx] = h;
      changed = true;
    }
  });

  if (changed) {
    sheet.getRange(1, 1, 1, newHeaderRow.length).setValues([newHeaderRow]);
  }
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

function ubahStatusById_(sheet, idValue, kolomStatus, statusBaru, jenisTransaksi) {
  const id = String(idValue || '').trim();
  if (!id) throw new Error('ID data tidak valid. Muat ulang halaman lalu coba lagi.');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Data tidak ditemukan.');

  const rows = sheet.getRange(2, 1, lastRow - 1, Math.max(sheet.getLastColumn(), kolomStatus)).getDisplayValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0] || '').trim() !== id) continue;

    const statusLama = String(rows[i][kolomStatus - 1] || '').trim() || 'Pending';
    const statusBaruNormal = String(statusBaru || '').trim();
    validasiTransisiStatus_(jenisTransaksi || 'umum', statusLama, statusBaruNormal);

    sheet.getRange(i + 2, kolomStatus).setValue(statusBaruNormal);
    return {
      row: i + 2,
      statusLama: statusLama,
      statusBaru: statusBaruNormal
    };
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

function validasiTransisiStatus_(jenisTransaksi, statusLama, statusBaru) {
  validasiStatus_(statusBaru);

  const jenis = normalisasiTeks_(jenisTransaksi);
  const lama = String(statusLama || '').trim() || 'Pending';
  const baru = String(statusBaru || '').trim();

  if (lama === baru) {
    throw new Error('Status sudah ' + baru + '. Tidak ada perubahan yang perlu dilakukan.');
  }

  const aturan = {
    booking: {
      'Pending': ['ACC', 'Ditolak']
    },
    kendaraan: {
      'Pending': ['ACC', 'Ditolak'],
      'ACC': ['Dikembalikan'],
      'Dipakai': ['Dikembalikan']
    },
    sarpras: {
      'Pending': ['ACC', 'Ditolak'],
      'ACC': ['Dikembalikan'],
      'Dipakai': ['Dikembalikan']
    },
    pemeliharaan: {
      'Pending': ['ACC', 'Ditolak']
    },
    umum: {
      'Pending': ['ACC', 'Ditolak'],
      'ACC': ['Dipakai', 'Dikembalikan'],
      'Dipakai': ['Dikembalikan']
    }
  };

  const aturanJenis = aturan[jenis] || aturan.umum;
  const boleh = aturanJenis[lama] || [];
  if (boleh.indexOf(baru) === -1) {
    throw new Error('Transisi status tidak diizinkan: ' + lama + ' → ' + baru + '.');
  }
}

function validasiPanjangTeks_(value, label, max) {
  const teks = String(value == null ? '' : value).trim();
  if (teks.length > max) {
    throw new Error(label + ' terlalu panjang. Maksimal ' + max + ' karakter.');
  }
}

function validasiBMNExist_(kodeBarang, nup) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DATA_BMN);
  if (!sheet || sheet.getLastRow() < 2) {
    throw new Error('Master Data_BMN belum tersedia.');
  }

  const kode = normalisasiTeks_(kodeBarang);
  const nomor = normalisasiTeks_(nup);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
  const ditemukan = data.some(function(row) {
    return normalisasiTeks_(row[0]) === kode && normalisasiTeks_(row[1]) === nomor;
  });

  if (!ditemukan) {
    throw new Error('BMN dengan Kode Barang ' + kodeBarang + ' dan NUP ' + nup + ' tidak ditemukan pada master Data_BMN.');
  }
}

function awalHariIni_() {
  const sekarang = new Date();
  const zona = Session.getScriptTimeZone() || 'Asia/Makassar';
  const tanggalLokal = Utilities.formatDate(sekarang, zona, 'yyyy-MM-dd');
  const bagian = tanggalLokal.split('-').map(Number);
  return new Date(bagian[0], bagian[1] - 1, bagian[2], 0, 0, 0, 0);
}

function bacaKolomTerbatas_(sheet, column) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, column, lastRow - 1, 1).getDisplayValues()
    .map(function(row) { return String(row[0] || '').trim(); })
    .filter(Boolean);
}

function buatRequestId_() {
  const tz = Session.getScriptTimeZone() || 'Asia/Makassar';
  const stamp = Utilities.formatDate(new Date(), tz, 'yyyyMMdd-HHmmss');
  const uuid = Utilities.getUuid().replace(/-/g, '').substring(0, 10).toUpperCase();
  return 'REQ-' + stamp + '-' + uuid;
}

function ambilTargetAudit_(action, args, result) {
  const first = args && args.length ? args[0] : null;

  if (/^ubahStatus/i.test(action) || action === 'updateKeteranganKendaraan') {
    return String(first || '-').trim() || '-';
  }

  if (action === 'simpanBMN' && first) {
    return buatIdBMN_(first.kodeBarang || first.idBarang || '', first.nup || '') || '-';
  }

  const teks = String(result || '');
  const match = teks.match(/ID(?: Booking| Pemeliharaan| Pinjam)?\s+([A-Z]{3}-\d{8}-\d+)/i);
  return match ? match[1] : '-';
}

function ambilStatusLamaAudit_(result) {
  const teks = String(result || '');
  const match = teks.match(/diubah dari\s+(.+?)\s+menjadi\s+(.+?)\.$/i);
  return match ? match[1] : '-';
}

function ambilStatusBaruAudit_(action, args) {
  if (/^ubahStatus/i.test(action)) return String(args && args[1] || '-').trim() || '-';
  return '-';
}

function ambilDetailAudit_(action, args, result) {
  if (action === 'updateKeteranganKendaraan') return 'Keterangan admin kendaraan diperbarui.';
  if (action === 'simpanBMN' && args && args[0]) return 'Menambahkan BMN: ' + String(args[0].namaBmn || '-').trim();
  if (action === 'simpanPemeliharaan') return 'Menambahkan pemeliharaan oleh Administrator.';
  if (/^ubahStatus/i.test(action)) return String(result || '').trim();
  return String(result || action || '-').trim();
}

function kodeErrorBackend_(err) {
  const pesan = normalisasiTeks_(bersihkanPesanError_(err));
  if (pesan.includes('tidak valid')) return 'VALIDATION_ERROR';
  if (pesan.includes('wajib') || pesan.includes('belum lengkap') || pesan.includes('tidak boleh') || pesan.includes('maksimal')) return 'VALIDATION_ERROR';
  if (pesan.includes('tidak ditemukan')) return 'NOT_FOUND';
  if (pesan.includes('transisi status')) return 'INVALID_STATUS_TRANSITION';
  if (pesan.includes('sesi administrator')) return 'ADMIN_REQUIRED';
  return 'BACKEND_ERROR';
}

function getOrCreateAuditLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_AUDIT_LOG);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_AUDIT_LOG);
    sheet.getRange(1, 1, 1, AUDIT_LOG_HEADERS.length).setValues([AUDIT_LOG_HEADERS]);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, AUDIT_LOG_HEADERS.length).setValues([AUDIT_LOG_HEADERS]);
  }
  return sheet;
}

function catatAuditAktivitas_(data) {
  try {
    const sheet = getOrCreateAuditLogSheet_();
    const detail = String(data.detail || '').trim().substring(0, 1000);
    sheet.appendRow([
      new Date(),
      String(data.requestId || '-').trim(),
      String(data.actor || 'Administrator').trim(),
      String(data.action || '-').trim(),
      String(data.targetId || '-').trim(),
      String(data.statusLama || '-').trim(),
      String(data.statusBaru || '-').trim(),
      detail
    ]);
  } catch (e) {
    // Audit log tidak boleh membuat transaksi utama gagal. Error dicatat ke log Apps Script.
    console.error('Audit log gagal: ' + bersihkanPesanError_(e));
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
  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(value.getTime());
  }

  const teks = String(value || '').trim();
  if (!teks) return null;

  // Frontend mengirim datetime-local: 2026-11-26T08:00
  // Google Sheet getDisplayValues() mengembalikan: 2026-11-26 08:00
  // Keduanya harus diperlakukan identik.
  const match = teks.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s]+(\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (!match) return null;

  const tahun = Number(match[1]);
  const bulan = Number(match[2]) - 1;
  const tanggal = Number(match[3]);
  const jam = Number(match[4]);
  const menit = Number(match[5]);
  const detik = Number(match[6] || 0);

  const hasil = new Date(tahun, bulan, tanggal, jam, menit, detik, 0);
  if (isNaN(hasil.getTime())) return null;

  // Cegah tanggal/jam overflow diam-diam, mis. 2026-02-31.
  if (
    hasil.getFullYear() !== tahun ||
    hasil.getMonth() !== bulan ||
    hasil.getDate() !== tanggal ||
    hasil.getHours() !== jam ||
    hasil.getMinutes() !== menit
  ) {
    return null;
  }

  return hasil;
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
