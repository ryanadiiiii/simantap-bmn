let masterData = { pegawai: [], bmn: [] };
let daftarJadwal = [];
let daftarJadwalUser = [];
let tanggalJadwalAktif = '';
let bulanKalenderJadwal = '';
let requestJadwalUserAktif = 0;
let daftarKendaraan = [];
let daftarSarpras = [];
let adminLogin = sessionStorage.getItem('adminLoginBMN') === '1';
let sortDataBMN = { key: 'kodeBarang', dir: 'asc' };
let sortLokasiBMN = { key: 'lokasi', dir: 'asc' };
let inventarisLokasiAktif = '';
let skipPushHistory = false;
let masterDataLoaded = false;
let masterDataLoading = false;
let masterDataCallbacks = [];
const LIMIT_USER = 50;
const LIMIT_ADMIN = 100;
let daftarKetersediaanKendaraan = [];
let requestKetersediaanKendaraanAktif = 0;
const identitasPeminjam = {
  ruangan: { verifiedNip: '', whatsappTerdaftar: false, ubahWhatsapp: false, requestId: 0, timer: null },
  kendaraan: { verifiedNip: '', whatsappTerdaftar: false, ubahWhatsapp: false, requestId: 0, timer: null },
  sarpras: { verifiedNip: '', whatsappTerdaftar: false, ubahWhatsapp: false, requestId: 0, timer: null }
};

document.addEventListener('DOMContentLoaded', function () {
  initBrowserBackNavigation();
  setTanggalHariIni();
  setMinDateTimeLocal();
  resetPanelPinjam();
  inisialisasiFooter();
  inisialisasiJadwalRuangan();
});

function inisialisasiFooter() {
  const homeLogo = document.querySelector('.home-logo-wrap img');
  const footerLogo = document.getElementById('footerLogo');
  const topbarLogo = document.getElementById('topbarLogo');
  if (homeLogo && footerLogo) footerLogo.src = homeLogo.src;
  if (homeLogo && topbarLogo) topbarLogo.src = homeLogo.src;

  const yearEl = document.getElementById('footerYear');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
}

function inisialisasiJadwalRuangan() {
  tanggalJadwalAktif = tanggalHariIniWita();
  bulanKalenderJadwal = tanggalJadwalAktif.slice(0, 7) + '-01';
  perbaruiLabelTanggalJadwal();
  renderKalenderJadwal();

  document.addEventListener('click', function(event) {
    const picker = document.querySelector('.schedule-date-picker');
    if (!picker || picker.contains(event.target)) return;
    tutupKalenderJadwal();
  });

  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') tutupKalenderJadwal();
  });
}

function tanggalHariIniWita() {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Makassar',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const map = {};
    parts.forEach(part => { if (part.type !== 'literal') map[part.type] = part.value; });
    if (map.year && map.month && map.day) return map.year + '-' + map.month + '-' + map.day;
  } catch (e) {
    console.warn('Timezone Asia/Makassar tidak tersedia, memakai tanggal lokal browser.', e);
  }
  return formatDateInputLokal(new Date());
}

function parseYmdParts(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

function ymdDariUtc(date) {
  return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
}

function geserYmd(value, jumlahHari) {
  const parts = parseYmdParts(value);
  if (!parts) return tanggalHariIniWita();
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + Number(jumlahHari || 0));
  return ymdDariUtc(date);
}

function formatTanggalJadwal(value) {
  const parts = parseYmdParts(value);
  if (!parts) return String(value || '-');
  const date = new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0);
  try {
    return new Intl.DateTimeFormat('id-ID', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }).format(date);
  } catch (e) {
    return String(parts.day).padStart(2, '0') + '/' + String(parts.month).padStart(2, '0') + '/' + parts.year;
  }
}

function perbaruiLabelTanggalJadwal(jumlahJadwal) {
  const label = document.getElementById('labelTanggalJadwal');
  const ringkasan = document.getElementById('ringkasanTanggalJadwal');
  const teksTanggal = formatTanggalJadwal(tanggalJadwalAktif);
  const hariIni = tanggalJadwalAktif === tanggalHariIniWita();

  if (label) label.textContent = teksTanggal;
  if (ringkasan) {
    const prefix = hariIni ? 'Hari ini' : 'Tanggal terpilih';
    ringkasan.textContent = Number.isInteger(jumlahJadwal)
      ? prefix + ' · ' + jumlahJadwal + ' jadwal'
      : prefix + ' · ' + teksTanggal;
  }
}

function toggleKalenderJadwal() {
  const popover = document.getElementById('kalenderJadwal');
  const trigger = document.getElementById('btnTanggalJadwal');
  if (!popover || !trigger) return;

  const akanBuka = popover.classList.contains('hidden');
  if (akanBuka) {
    bulanKalenderJadwal = tanggalJadwalAktif.slice(0, 7) + '-01';
    renderKalenderJadwal();
    popover.classList.remove('hidden');
  } else {
    popover.classList.add('hidden');
  }
  trigger.setAttribute('aria-expanded', akanBuka ? 'true' : 'false');
}

function tutupKalenderJadwal() {
  const popover = document.getElementById('kalenderJadwal');
  const trigger = document.getElementById('btnTanggalJadwal');
  if (popover) popover.classList.add('hidden');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

function gantiBulanKalenderJadwal(delta) {
  const parts = parseYmdParts(bulanKalenderJadwal || tanggalJadwalAktif);
  if (!parts) return;
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + Number(delta || 0), 1));
  bulanKalenderJadwal = ymdDariUtc(date);
  renderKalenderJadwal();
}

function renderKalenderJadwal() {
  const grid = document.getElementById('gridKalenderJadwal');
  const labelBulan = document.getElementById('labelBulanKalenderJadwal');
  if (!grid || !labelBulan) return;

  const parts = parseYmdParts(bulanKalenderJadwal || tanggalJadwalAktif || tanggalHariIniWita());
  if (!parts) return;

  const firstDay = new Date(Date.UTC(parts.year, parts.month - 1, 1));
  const offsetSenin = (firstDay.getUTCDay() + 6) % 7;
  const start = new Date(firstDay.getTime());
  start.setUTCDate(start.getUTCDate() - offsetSenin);

  try {
    labelBulan.textContent = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(firstDay);
  } catch (e) {
    labelBulan.textContent = String(parts.month).padStart(2, '0') + '/' + parts.year;
  }

  const hariIni = tanggalHariIniWita();
  const buttons = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(start.getTime());
    date.setUTCDate(start.getUTCDate() + i);
    const ymd = ymdDariUtc(date);
    const isOutside = date.getUTCMonth() !== parts.month - 1;
    const classes = ['schedule-calendar-day'];
    if (isOutside) classes.push('is-outside');
    if (ymd === hariIni) classes.push('is-today');
    if (ymd === tanggalJadwalAktif) classes.push('is-selected');
    const ariaCurrent = ymd === hariIni ? ' aria-current="date"' : '';
    const ariaPressed = ymd === tanggalJadwalAktif ? 'true' : 'false';
    buttons.push('<button type="button" class="' + classes.join(' ') + '" data-tanggal="' + ymd + '" aria-label="' + escapeHtml(formatTanggalJadwal(ymd)) + '" aria-pressed="' + ariaPressed + '"' + ariaCurrent + '>' + date.getUTCDate() + '</button>');
  }
  grid.innerHTML = buttons.join('');
  grid.querySelectorAll('[data-tanggal]').forEach(function(button) {
    button.addEventListener('click', function() { pilihTanggalJadwal(button.dataset.tanggal); });
  });
}

function pilihTanggalJadwal(value) {
  if (!parseYmdParts(value)) return;
  tanggalJadwalAktif = value;
  bulanKalenderJadwal = value.slice(0, 7) + '-01';
  tutupKalenderJadwal();
  perbaruiLabelTanggalJadwal();
  renderKalenderJadwal();
  muatJadwal();
}

function geserTanggalJadwal(delta) {
  tanggalJadwalAktif = geserYmd(tanggalJadwalAktif || tanggalHariIniWita(), delta);
  bulanKalenderJadwal = tanggalJadwalAktif.slice(0, 7) + '-01';
  tutupKalenderJadwal();
  perbaruiLabelTanggalJadwal();
  renderKalenderJadwal();
  muatJadwal();
}

function kembaliJadwalHariIni() {
  const hariIni = tanggalHariIniWita();
  tanggalJadwalAktif = hariIni;
  bulanKalenderJadwal = hariIni.slice(0, 7) + '-01';
  tutupKalenderJadwal();
  perbaruiLabelTanggalJadwal();
  renderKalenderJadwal();
  muatJadwal();
}

function allSections() { return ['dashboardUtama','dashboardInventarisRuangan','dashboardPinjamPakaiBMN','dashboardPemeliharaan','dashboardLoginAdmin','dashboardAdmin','adminDataBMN','adminLokasiBMN','adminPemeliharaan','adminPinjamPakaiBMN']; }

function aturTopbar(sectionId) {
  const topbar = document.getElementById('appTopbar');
  if (!topbar) return;
  if (sectionId === 'dashboardUtama') topbar.classList.add('hidden');
  else topbar.classList.remove('hidden');
}

function currentVisibleSection() {
  return allSections().find(id => {
    const el = document.getElementById(id);
    return el && !el.classList.contains('hidden');
  }) || 'dashboardUtama';
}

function pushHistoryState(state) {
  if (skipPushHistory) return;
  const section = (state && state.section) || currentVisibleSection();
  const finalState = Object.assign({ appBMN: true, section: section }, state || {});
  history.pushState(finalState, '', '#' + encodeURIComponent(section));
}

function initBrowserBackNavigation() {
  history.replaceState({ appBMN: true, section: 'dashboardUtama' }, '', '#dashboardUtama');
  aturTopbar('dashboardUtama');
  window.addEventListener('popstate', function(event) {
    const state = event.state;
    if (!state || !state.appBMN) return;
    applyHistoryState(state);
  });
}

function applyHistoryState(state) {
  skipPushHistory = true;
  const section = state.section || 'dashboardUtama';
  tampilkanSection(section, false);

  if (section === 'dashboardPemeliharaan') {
    muatPemeliharaan();
    tutupFormPemeliharaanUser();
  }

  if (section === 'dashboardPinjamPakaiBMN') {
    resetPanelPinjam();
    if (state.panelPinjam) bukaPanelPinjam(state.panelPinjam, false);
  }

  if (section === 'dashboardInventarisRuangan') {
    if (state.inventarisLokasi) inventarisLokasiAktif = state.inventarisLokasi;
    pastikanMasterData(function() { renderInventarisRuangan(!state.inventarisLokasi); });
  }

  if (section === 'dashboardLoginAdmin') {
    setTimeout(() => { const pin = document.getElementById('pinAdmin'); if (pin) pin.focus(); }, 100);
  }

  if (section === 'adminDataBMN') pastikanMasterData(renderAdminDataBMN);
  if (section === 'adminLokasiBMN') pastikanMasterData(renderAdminLokasiBMN);
  if (section === 'adminPemeliharaan') muatPemeliharaanAdmin();
  if (section === 'adminPinjamPakaiBMN') {
    resetPanelAdminPinjam();
    if (state.panelAdminPinjam) bukaPanelAdminPinjam(state.panelAdminPinjam, false);
  }

  skipPushHistory = false;
}

function tampilkanSection(id, pushHistory) {
  allSections().forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
  aturTopbar(id);
  if (pushHistory !== false) pushHistoryState({ section: id });
  window.scrollTo({top:0, behavior:'smooth'});
}

function bukaDashboard(id, pushHistory) {
  tampilkanSection(id, pushHistory);
  if (id === 'dashboardPemeliharaan') {
    muatPemeliharaan();
    tutupFormPemeliharaanUser();
  }
  if (id === 'dashboardPinjamPakaiBMN') {
    resetPanelPinjam();
  }
  if (id === 'dashboardInventarisRuangan') {
    pastikanMasterData(function() { renderInventarisRuangan(true); });
  }
}
function kembaliKeUtama() { tampilkanSection('dashboardUtama'); }
function bukaLoginAdmin() { tampilkanSection('dashboardLoginAdmin'); setTimeout(() => document.getElementById('pinAdmin').focus(), 100); }

function resetPanelPinjam() {
  ['panelPinjamRuangan','panelPinjamKendaraan','panelPinjamSarpras'].forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
  document.querySelectorAll('.module-card[data-panel]').forEach(el => el.classList.remove('active'));
  const guide = document.getElementById('guidePinjam'); if (guide) guide.classList.remove('hidden');
}
function bukaPanelPinjam(tipe, pushHistory) {
  resetPanelPinjam();
  const map = { ruangan: 'panelPinjamRuangan', kendaraan: 'panelPinjamKendaraan', sarpras: 'panelPinjamSarpras' };
  const panelId = map[tipe];
  const panel = document.getElementById(panelId);
  const guide = document.getElementById('guidePinjam'); if (guide) guide.classList.add('hidden');
  if (panel) panel.classList.remove('hidden');
  const btn = document.querySelector(`.module-card[data-panel="${tipe}"]`);
  if (btn) btn.classList.add('active');
  if (tipe === 'ruangan') {
    pastikanMasterData(function() {
      renderChecklistBMNPinjam();
      muatJadwal();
    });
  }
  if (tipe === 'kendaraan') { muatPinjamKendaraan(); muatKetersediaanKendaraan(); }
  if (tipe === 'sarpras') muatPinjamSarpras();
  setMinDateTimeLocal();
  if (pushHistory !== false) pushHistoryState({ section: 'dashboardPinjamPakaiBMN', panelPinjam: tipe });
  setTimeout(() => panel && panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
}

function tutupFormPemeliharaanUser() {
  const form = document.getElementById('cardFormPemeliharaanUser');
  const btn = document.getElementById('btnToggleFormPemeliharaanUser');
  if (form) form.classList.add('hidden');
  if (btn) btn.textContent = '➕ Buat Laporan Pemeliharaan';
}
function toggleFormPemeliharaanUser() {
  const form = document.getElementById('cardFormPemeliharaanUser');
  const btn = document.getElementById('btnToggleFormPemeliharaanUser');
  if (!form) return;
  const akanBuka = form.classList.contains('hidden');
  form.classList.toggle('hidden', !akanBuka);
  if (btn) btn.textContent = akanBuka ? 'Tutup Form' : '➕ Buat Laporan Pemeliharaan';
  if (akanBuka) {
    pastikanMasterData();
    setTimeout(() => form.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }
}

function resetPanelAdminPinjam() {
  ['panelAdminRuangan','panelAdminKendaraan','panelAdminSarpras'].forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
  document.querySelectorAll('.module-card[data-admin-panel]').forEach(el => el.classList.remove('active'));
  const guide = document.getElementById('guideAdminPinjam'); if (guide) guide.classList.remove('hidden');
}
function bukaPanelAdminPinjam(tipe, pushHistory) {
  if (!pastikanAdminLogin()) return;
  resetPanelAdminPinjam();
  const map = { ruangan: 'panelAdminRuangan', kendaraan: 'panelAdminKendaraan', sarpras: 'panelAdminSarpras' };
  const panelId = map[tipe];
  const panel = document.getElementById(panelId);
  const guide = document.getElementById('guideAdminPinjam'); if (guide) guide.classList.add('hidden');
  if (panel) panel.classList.remove('hidden');
  const btn = document.querySelector(`.module-card[data-admin-panel="${tipe}"]`);
  if (btn) btn.classList.add('active');
  if (tipe === 'ruangan') muatJadwalAdmin();
  if (tipe === 'kendaraan') muatPinjamKendaraanAdmin();
  if (tipe === 'sarpras') muatPinjamSarprasAdmin();
  if (pushHistory !== false) pushHistoryState({ section: 'adminPinjamPakaiBMN', panelAdminPinjam: tipe });
  setTimeout(() => panel && panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
}

function setTanggalHariIni() {
  const today = formatDateInputLokal(new Date());
  ['tanggalBooking','tanggalPemeliharaan','tanggalAdminPemeliharaan'].forEach(id => { const el = document.getElementById(id); if (el) { el.min = today; if (!el.value) el.value = today; } });
}
function setMinDateTimeLocal() {
  const min = formatDateTimeLocal(new Date());
  ['mulaiKendaraan','batasKembaliKendaraan','batasKembaliSarpras'].forEach(id => { const el = document.getElementById(id); if (el) el.min = min; });
}
function formatDateInputLokal(date) { return date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0'); }
function formatDateTimeLocal(date) { return formatDateInputLokal(date) + 'T' + String(date.getHours()).padStart(2,'0') + ':' + String(date.getMinutes()).padStart(2,'0'); }

// --- IDENTITAS PEMINJAM BERBASIS NIP ---
function configIdentitasPeminjam(tipe) {
  const map = {
    ruangan: { nip: 'nipPeminjamRuangan', nama: 'namaPeminjamRuangan', info: 'infoPegawaiRuangan', waBox: 'waBoxRuangan', waStored: 'waStoredRuangan', waMasked: 'waMaskedRuangan', waWrap: 'waInputWrapRuangan', waInput: 'waPeminjamRuangan' },
    kendaraan: { nip: 'nipPeminjamKendaraan', nama: 'namaPeminjamKendaraan', info: 'infoPegawaiKendaraan', waBox: 'waBoxKendaraan', waStored: 'waStoredKendaraan', waMasked: 'waMaskedKendaraan', waWrap: 'waInputWrapKendaraan', waInput: 'waPeminjamKendaraan' },
    sarpras: { nip: 'nipPeminjamSarpras', nama: 'namaPeminjamSarpras', info: 'infoPegawaiSarpras', waBox: 'waBoxSarpras', waStored: 'waStoredSarpras', waMasked: 'waMaskedSarpras', waWrap: 'waInputWrapSarpras', waInput: 'waPeminjamSarpras' }
  };
  return map[tipe] || null;
}

function resetIdentitasPeminjam(tipe, pertahankanNip) {
  const cfg = configIdentitasPeminjam(tipe);
  const state = identitasPeminjam[tipe];
  if (!cfg || !state) return;
  if (state.timer) clearTimeout(state.timer);
  state.verifiedNip = '';
  state.whatsappTerdaftar = false;
  state.ubahWhatsapp = false;
  state.requestId++;
  const nipEl = document.getElementById(cfg.nip);
  const namaEl = document.getElementById(cfg.nama);
  const infoEl = document.getElementById(cfg.info);
  const waBox = document.getElementById(cfg.waBox);
  const stored = document.getElementById(cfg.waStored);
  const masked = document.getElementById(cfg.waMasked);
  const wrap = document.getElementById(cfg.waWrap);
  const waInput = document.getElementById(cfg.waInput);
  if (nipEl && !pertahankanNip) nipEl.value = '';
  if (namaEl) namaEl.value = '';
  if (infoEl) { infoEl.textContent = 'Masukkan NIP untuk memvalidasi nama pegawai.'; infoEl.className = 'identity-status muted'; }
  if (waBox) waBox.classList.add('hidden');
  if (stored) stored.classList.add('hidden');
  if (masked) masked.textContent = '-';
  if (wrap) wrap.classList.add('hidden');
  if (waInput) { waInput.value = ''; waInput.required = false; }
}

function onNipInput(tipe) {
  const cfg = configIdentitasPeminjam(tipe);
  const state = identitasPeminjam[tipe];
  if (!cfg || !state) return;
  const nipEl = document.getElementById(cfg.nip);
  if (!nipEl) return;
  nipEl.value = String(nipEl.value || '').replace(/\D/g, '').slice(0, 18);
  const nip = nipEl.value;
  if (state.verifiedNip && state.verifiedNip !== nip) resetIdentitasPeminjam(tipe, true);
  if (state.timer) clearTimeout(state.timer);
  if (nip.length === 18 && state.verifiedNip !== nip) {
    state.timer = setTimeout(function() {
      if (val(cfg.nip) === nip) cekPegawaiNip(tipe);
    }, 180);
  }
}

function cekPegawaiNip(tipe) {
  const cfg = configIdentitasPeminjam(tipe);
  const state = identitasPeminjam[tipe];
  if (!cfg || !state) return;
  const nip = val(cfg.nip).replace(/\D/g, '');
  const infoEl = document.getElementById(cfg.info);
  if (!/^\d{18}$/.test(nip)) {
    resetIdentitasPeminjam(tipe, true);
    if (infoEl) { infoEl.textContent = 'NIP harus terdiri dari 18 digit.'; infoEl.className = 'identity-status is-error'; }
    return;
  }
  if (state.verifiedNip === nip && val(cfg.nama)) return;

  const requestId = ++state.requestId;
  if (infoEl) { infoEl.textContent = 'Memeriksa NIP...'; infoEl.className = 'identity-status is-loading'; }

  google.script.run.withSuccessHandler(function(result) {
    if (requestId !== state.requestId || val(cfg.nip).replace(/\D/g, '') !== nip) return;
    if (!result || result.found !== true) {
      resetIdentitasPeminjam(tipe, true);
      if (infoEl) { infoEl.textContent = (result && result.message) || 'NIP tidak ditemukan pada Master Pegawai.'; infoEl.className = 'identity-status is-error'; }
      return;
    }

    state.verifiedNip = nip;
    state.whatsappTerdaftar = !!result.whatsappTerdaftar;
    state.ubahWhatsapp = false;
    const namaEl = document.getElementById(cfg.nama);
    if (namaEl) namaEl.value = result.nama || '';
    if (infoEl) {
      infoEl.textContent = '✓ ' + (result.nama || 'Pegawai ditemukan') + (result.jabatan ? ' · ' + result.jabatan : '');
      infoEl.className = 'identity-status is-valid';
    }

    const waBox = document.getElementById(cfg.waBox);
    const stored = document.getElementById(cfg.waStored);
    const masked = document.getElementById(cfg.waMasked);
    const wrap = document.getElementById(cfg.waWrap);
    const waInput = document.getElementById(cfg.waInput);
    if (waBox) waBox.classList.remove('hidden');
    if (result.whatsappTerdaftar) {
      if (stored) stored.classList.remove('hidden');
      if (masked) masked.textContent = result.whatsappMasked || 'Nomor tersimpan';
      if (wrap) wrap.classList.add('hidden');
      if (waInput) { waInput.value = ''; waInput.required = false; }
    } else {
      if (stored) stored.classList.add('hidden');
      if (wrap) wrap.classList.remove('hidden');
      if (waInput) { waInput.required = true; setTimeout(() => waInput.focus(), 60); }
    }
  }).withFailureHandler(function(err) {
    if (requestId !== state.requestId) return;
    resetIdentitasPeminjam(tipe, true);
    if (infoEl) { infoEl.textContent = 'Gagal memeriksa NIP: ' + ((err && err.message) || err || 'Kesalahan backend.'); infoEl.className = 'identity-status is-error'; }
  }).getPegawaiByNip(nip);
}

function aktifkanUbahWhatsapp(tipe) {
  const cfg = configIdentitasPeminjam(tipe);
  const state = identitasPeminjam[tipe];
  if (!cfg || !state || !state.verifiedNip) return;
  state.ubahWhatsapp = true;
  const wrap = document.getElementById(cfg.waWrap);
  const waInput = document.getElementById(cfg.waInput);
  if (wrap) wrap.classList.remove('hidden');
  if (waInput) { waInput.required = true; waInput.value = ''; setTimeout(() => waInput.focus(), 60); }
}

function normalisasiWhatsappClient(value) {
  let nomor = String(value || '').replace(/\D/g, '');
  if (nomor.startsWith('0')) nomor = '62' + nomor.slice(1);
  if (nomor.startsWith('8')) nomor = '62' + nomor;
  return /^628\d{7,12}$/.test(nomor) ? nomor : '';
}

function identitasUntukSubmit(tipe) {
  const cfg = configIdentitasPeminjam(tipe);
  const state = identitasPeminjam[tipe];
  if (!cfg || !state) throw new Error('Konfigurasi identitas peminjam tidak tersedia.');
  const nip = val(cfg.nip).replace(/\D/g, '');
  if (!/^\d{18}$/.test(nip) || state.verifiedNip !== nip || !val(cfg.nama)) {
    throw new Error('Validasi NIP terlebih dahulu sampai nama pegawai muncul.');
  }
  let whatsapp = '';
  if (!state.whatsappTerdaftar || state.ubahWhatsapp) {
    whatsapp = normalisasiWhatsappClient(val(cfg.waInput));
    if (!whatsapp) throw new Error('Nomor WhatsApp tidak valid. Gunakan nomor aktif, contoh 081234567890.');
  }
  return { nip: nip, nama: val(cfg.nama), whatsapp: whatsapp, ubahWhatsapp: !!state.ubahWhatsapp };
}

// --- KETERSEDIAAN KENDARAAN ---
function resetKetersediaanKendaraan() {
  daftarKetersediaanKendaraan = [];
  requestKetersediaanKendaraanAktif++;
  const select = document.getElementById('jenisMobilKendaraan');
  const box = document.getElementById('ketersediaanKendaraan');
  if (select) { select.disabled = true; select.innerHTML = '<option value="">Isi waktu penggunaan terlebih dahulu</option>'; }
  if (box) box.innerHTML = '<span class="muted">Isi waktu mulai dan batas kembali untuk melihat ketersediaan kendaraan.</span>';
}

function muatKetersediaanKendaraan() {
  const mulai = val('mulaiKendaraan');
  const selesai = val('batasKembaliKendaraan');
  const select = document.getElementById('jenisMobilKendaraan');
  const box = document.getElementById('ketersediaanKendaraan');
  if (!select || !box) return;

  if (!mulai || !selesai) { resetKetersediaanKendaraan(); return; }
  const start = new Date(mulai);
  const end = new Date(selesai);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    resetKetersediaanKendaraan();
    box.innerHTML = '<span class="vehicle-availability-error">Batas kembali harus setelah waktu mulai penggunaan.</span>';
    return;
  }
  if (start < new Date()) {
    resetKetersediaanKendaraan();
    box.innerHTML = '<span class="vehicle-availability-error">Waktu mulai penggunaan tidak boleh berada di masa lalu.</span>';
    return;
  }

  const requestId = ++requestKetersediaanKendaraanAktif;
  const pilihanSebelumnya = select.value;
  select.disabled = true;
  select.innerHTML = '<option value="">Memeriksa kendaraan...</option>';
  box.innerHTML = '<span class="muted">Memeriksa ketersediaan kendaraan...</span>';

  google.script.run.withSuccessHandler(function(data) {
    if (requestId !== requestKetersediaanKendaraanAktif) return;
    daftarKetersediaanKendaraan = Array.isArray(data) ? data : [];
    renderKetersediaanKendaraan(pilihanSebelumnya);
  }).withFailureHandler(function(err) {
    if (requestId !== requestKetersediaanKendaraanAktif) return;
    daftarKetersediaanKendaraan = [];
    select.disabled = true;
    select.innerHTML = '<option value="">Ketersediaan gagal dimuat</option>';
    box.innerHTML = '<span class="vehicle-availability-error">' + escapeHtml((err && err.message) || String(err || 'Gagal memuat ketersediaan.')) + '</span>';
  }).getKetersediaanKendaraan(mulai, selesai);
}

function renderKetersediaanKendaraan(pilihanSebelumnya) {
  const select = document.getElementById('jenisMobilKendaraan');
  const box = document.getElementById('ketersediaanKendaraan');
  if (!select || !box) return;

  const data = Array.isArray(daftarKetersediaanKendaraan)
    ? daftarKetersediaanKendaraan
    : [];

  if (!data.length) {
    select.disabled = true;
    select.innerHTML = '<option value="">Belum ada kendaraan aktif</option>';
    box.innerHTML = '<span class="vehicle-availability-error">Master kendaraan belum memiliki unit aktif.</span>';
    return;
  }

  const tersediaData = data.filter(function(item) {
    return Number(item.tersedia || 0) > 0;
  });

  const pilihanMasihValid = !!pilihanSebelumnya && data.some(function(item) {
    return item.jenisMobil === pilihanSebelumnya && Number(item.tersedia || 0) > 0;
  });

  select.innerHTML =
    '<option value="">Pilih jenis mobil</option>' +
    data.map(function(item) {
      const tersedia = Number(item.tersedia || 0);
      const total = Number(item.total || 0);
      const penuh = tersedia < 1;

      const label = penuh
        ? item.jenisMobil + ' — PENUH / sudah terbooking'
        : item.jenisMobil + ' — ' + tersedia + ' dari ' + total + ' tersedia';

      return '<option value="' + escapeHtml(item.jenisMobil) + '"' +
        (penuh ? ' disabled' : '') +
        '>' + escapeHtml(label) + '</option>';
    }).join('');

  select.disabled = tersediaData.length < 1;

  if (pilihanMasihValid) {
    select.value = pilihanSebelumnya;
  } else {
    select.value = '';
  }

  const semuaPenuh = tersediaData.length < 1;

  box.innerHTML =
    (semuaPenuh
      ? '<div class="vehicle-availability-error" style="margin-bottom:10px;">' +
          'Semua kendaraan pada jadwal ini sudah terbooking/ACC. Silakan ubah waktu penggunaan.' +
        '</div>'
      : '') +
    '<div class="vehicle-availability-grid">' +
      data.map(function(item) {
        const tersedia = Number(item.tersedia || 0);
        const total = Number(item.total || 0);
        const penuh = tersedia < 1;
        const cls = penuh ? 'is-unavailable' : 'is-available';

        const status = penuh
          ? 'PENUH — tidak dapat dipilih'
          : tersedia + ' dari ' + total + ' tersedia';

        return '<div class="vehicle-availability-item ' + cls + '">' +
          '<strong>' + escapeHtml(item.jenisMobil) + '</strong>' +
          '<span>' + escapeHtml(status) + '</span>' +
        '</div>';
      }).join('') +
    '</div>';

  // Bila jadwal diubah dan jenis yang sebelumnya dipilih kini penuh,
  // tampilkan peringatan seperti booking ruangan yang sudah terisi.
  if (pilihanSebelumnya && !pilihanMasihValid) {
    tampilAlert(
      'alertPinjam',
      'Jenis mobil yang sebelumnya dipilih sudah terbooking pada jadwal tersebut. Silakan pilih jenis mobil lain atau ubah waktu penggunaan.',
      'error'
    );
  }
}

function formatDateTimeRingkas(value) {
  const teks = String(value || '').trim();
  if (!teks) return '-';
  const m = teks.match(/^(\d{4})-(\d{2})-(\d{2})[T\s]+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return teks;
  const tahun = Number(m[1]);
  const bulan = Number(m[2]) - 1;
  const tanggal = Number(m[3]);
  const jam = Number(m[4]);
  const menit = Number(m[5]);
  const detik = Number(m[6] || 0);
  const hasil = new Date(tahun, bulan, tanggal, jam, menit, detik, 0);
  if (
    isNaN(hasil.getTime()) ||
    hasil.getFullYear() !== tahun ||
    hasil.getMonth() !== bulan ||
    hasil.getDate() !== tanggal ||
    hasil.getHours() !== jam ||
    hasil.getMinutes() !== menit
  ) {
    return teks;
  }
  return m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5] + ' WITA';
}

function muatMasterData(callback, forceRefresh) {
  if (typeof callback === 'function') masterDataCallbacks.push(callback);

  if (masterDataLoaded && !forceRefresh) {
    jalankanMasterDataCallbacks();
    return;
  }

  if (masterDataLoading) return;

  masterDataLoading = true;
  google.script.run.withSuccessHandler(function (data) {
    masterDataLoading = false;
    masterDataLoaded = true;
    masterData = data || { pegawai: [], bmn: [] };
    isiDatalistPegawai();
    isiDatalistBMN();
    renderChecklistBMNPinjam();
    jalankanMasterDataCallbacks();
  }).withFailureHandler(function (err) {
    masterDataLoading = false;
    console.error(err);
    jalankanMasterDataCallbacks();
  }).getMasterDataOptimized(!!forceRefresh);
}

function pastikanMasterData(callback, forceRefresh) {
  if (masterDataLoaded && !forceRefresh) {
    if (typeof callback === 'function') callback();
    return;
  }
  muatMasterData(callback, forceRefresh);
}

function jalankanMasterDataCallbacks() {
  const callbacks = masterDataCallbacks.splice(0, masterDataCallbacks.length);
  callbacks.forEach(function (fn) {
    try { if (typeof fn === 'function') fn(); } catch (e) { console.error(e); }
  });
}

function isiDatalistPegawai() { const el = document.getElementById('listPegawai'); if (el) el.innerHTML = (masterData.pegawai || []).map(n => `<option value="${escapeHtml(n)}"></option>`).join(''); }
function labelBMN(item) { return [item.kodeBarang ? 'Kode: ' + item.kodeBarang : '', item.nup ? 'NUP: ' + item.nup : '', item.nama, item.merk, item.tahunPerolehan, item.lokasi].filter(Boolean).join(' | '); }
function isiDatalistBMN() { const el = document.getElementById('listBMN'); if (el) el.innerHTML = (masterData.bmn || []).map(item => `<option value="${escapeHtml(labelBMN(item))}"></option>`).join(''); }
function cariBMNDariInput(value) { const teks = normalizeText(value); return (masterData.bmn || []).find(item => normalizeText(labelBMN(item)) === teks) || null; }

function renderChecklistBMNPinjam() {
  const container = document.getElementById('bmnChecklistContainer');
  if (!container) return;
  const ruangan = document.getElementById('ruanganBooking').value;
  document.getElementById('bmnDipinjam').value = '-';
  if (!ruangan) { container.innerHTML = '<div class="muted">Pilih ruangan terlebih dahulu untuk menampilkan BMN yang ada di ruangan tersebut.</div>'; return; }
  const data = (masterData.bmn || []).filter(item => normalizeRoom(item.lokasi) === normalizeRoom(ruangan));
  if (!data.length) { container.innerHTML = '<div class="muted">Belum ada BMN tercatat pada ' + escapeHtml(ruangan) + '.</div>'; return; }
  container.innerHTML = data.map((item, i) => `<label class="checkbox-item"><input type="checkbox" class="cekBmnPinjam" value="${escapeHtml(labelBMN(item))}" onchange="updateBMNPinjamTerpilih()"><div>${escapeHtml(item.nama || '-')}<span>${escapeHtml([item.kodeBarang ? 'Kode: ' + item.kodeBarang : '', item.nup ? 'NUP: ' + item.nup : '', item.merk, item.kondisi].filter(Boolean).join(' · '))}</span></div></label>`).join('');
}
function updateBMNPinjamTerpilih() { const values = Array.from(document.querySelectorAll('.cekBmnPinjam:checked')).map(el => el.value); document.getElementById('bmnDipinjam').value = values.length ? values.join('; ') : '-'; }
function normalizeRoom(value) { return normalizeText(value).replace(/ruang /g,'').replace(/ruangan /g,''); }

function muatJadwal() {
  if (!tanggalJadwalAktif) tanggalJadwalAktif = tanggalHariIniWita();
  const tanggalRequest = tanggalJadwalAktif;
  const requestId = ++requestJadwalUserAktif;
  const tbody = document.getElementById('tabelJadwalPinjam');
  const ringkasan = document.getElementById('ringkasanTanggalJadwal');

  if (tbody) tbody.innerHTML = '<tr><td colspan="8">Memuat jadwal...</td></tr>';
  if (ringkasan) ringkasan.textContent = 'Memuat · ' + formatTanggalJadwal(tanggalRequest);

  google.script.run
    .withSuccessHandler(function (data) {
      if (requestId !== requestJadwalUserAktif || tanggalRequest !== tanggalJadwalAktif) return;
      daftarJadwalUser = Array.isArray(data) ? data : [];
      renderTabelJadwal('tabelJadwalPinjam', daftarJadwalUser, true);
      perbaruiLabelTanggalJadwal(daftarJadwalUser.length);
    })
    .withFailureHandler(function (err) {
      if (requestId !== requestJadwalUserAktif || tanggalRequest !== tanggalJadwalAktif) return;
      daftarJadwalUser = [];
      renderError('tabelJadwalPinjam', err && err.message ? err.message : String(err || 'Gagal memuat jadwal.'), 8);
      if (ringkasan) ringkasan.textContent = 'Gagal memuat · ' + formatTanggalJadwal(tanggalRequest);
    })
    .getJadwalRingkas(tanggalRequest, LIMIT_USER);
}
function renderTabelJadwal(targetId, data, detail) {
  const tbody = document.getElementById(targetId); if (!tbody) return;
  const colspan = detail ? 8 : 7;
  if (!data.length) {
    const tanggal = formatTanggalJadwal(tanggalJadwalAktif || tanggalHariIniWita());
    tbody.innerHTML = `<tr class="schedule-empty-row"><td colspan="${colspan}">Belum ada jadwal ruangan pada ${escapeHtml(tanggal)}.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map(row => detail ? `<tr><td>${escapeHtml(row.tanggal)}</td><td>${escapeHtml(row.ruangan)}</td><td>${escapeHtml(row.mulai)} - ${escapeHtml(row.selesai)}</td><td>${escapeHtml(row.nama)}</td><td>${escapeHtml(row.namaKegiatan || '-')}</td><td>${escapeHtml(row.jumlahPeserta || '-')}<br><span class="muted">${escapeHtml(row.pesertaJabatan || '-')}</span></td><td>${escapeHtml(row.bmnPinjam || '-')}</td><td>${badgeStatus(row.status)}</td></tr>` : `<tr><td>${escapeHtml(row.tanggal)}</td><td>${escapeHtml(row.ruangan)}</td><td>${escapeHtml(row.mulai)} - ${escapeHtml(row.selesai)}</td><td>${escapeHtml(row.nama)}</td><td>${escapeHtml(row.namaKegiatan || '-')}</td><td>${escapeHtml(row.bmnPinjam || '-')}</td><td>${badgeStatus(row.status)}</td></tr>`).join('');
}

function validasiBookingRealtime() {
  const pesan = pesanValidasiWaktuBooking(document.getElementById('tanggalBooking').value, document.getElementById('jamMulaiBooking').value, document.getElementById('jamSelesaiBooking').value);
  if (pesan) tampilAlert('alertPinjam', pesan, 'error');
}
function pesanValidasiWaktuBooking(tanggal, mulai, selesai) {
  if (!tanggal || !mulai || !selesai) return '';
  const start = new Date(tanggal + 'T' + mulai); const end = new Date(tanggal + 'T' + selesai);
  if (end <= start) return 'Jam selesai harus lebih besar dari jam mulai.';
  if (start < new Date()) return 'Tanggal dan jam mulai tidak boleh berada di masa lalu.';
  return '';
}
function parseJamClientKeMenit(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})[:.](\d{2})/);
  if (!match) return null;
  const jam = Number(match[1]);
  const menit = Number(match[2]);
  if (jam < 0 || jam > 23 || menit < 0 || menit > 59) return null;
  return jam * 60 + menit;
}

function cariJadwalBentrokClient(form) {
  // Pengecekan client hanya digunakan sebagai peringatan cepat jika tanggal form
  // sama dengan tanggal jadwal yang sedang dimuat. Backend tetap menjadi otoritas final.
  if (!form || form.tanggal !== tanggalJadwalAktif) return null;
  const mulaiBaru = parseJamClientKeMenit(form.jamMulai);
  const selesaiBaru = parseJamClientKeMenit(form.jamSelesai);
  if (mulaiBaru === null || selesaiBaru === null) return null;

  return (daftarJadwalUser || []).find(function(row) {
    if (normalizeText(row.status).includes('tolak')) return false;
    if (normalizeRoom(row.ruangan) !== normalizeRoom(form.ruangan)) return false;
    const mulaiLama = parseJamClientKeMenit(row.mulai);
    const selesaiLama = parseJamClientKeMenit(row.selesai);
    if (mulaiLama === null || selesaiLama === null) return false;
    return mulaiBaru < selesaiLama && selesaiBaru > mulaiLama;
  }) || null;
}

function submitBooking(event) {
  event.preventDefault();
  updateBMNPinjamTerpilih();
  let identitas;
  try { identitas = identitasUntukSubmit('ruangan'); }
  catch (e) { return tampilAlert('alertPinjam', e.message || String(e), 'error'); }

  const form = {
    nip: identitas.nip, nama: identitas.nama, whatsapp: identitas.whatsapp, ubahWhatsapp: identitas.ubahWhatsapp,
    tanggal: val('tanggalBooking'), ruangan: val('ruanganBooking'), jamMulai: val('jamMulaiBooking'), jamSelesai: val('jamSelesaiBooking'),
    bmnDipinjam: val('bmnDipinjam') || '-', namaKegiatan: val('namaKegiatanRuangan'), jumlahPeserta: val('jumlahPesertaRuangan'), pesertaJabatan: val('pesertaJabatanRuangan')
  };
  const pesanWaktu = pesanValidasiWaktuBooking(form.tanggal, form.jamMulai, form.jamSelesai);
  if (pesanWaktu) return tampilAlert('alertPinjam', pesanWaktu, 'error');
  const bentrok = cariJadwalBentrokClient(form);
  if (bentrok) return tampilAlert('alertPinjam', 'Jadwal bentrok dengan ' + bentrok.ruangan + ' pukul ' + bentrok.mulai + ' - ' + bentrok.selesai + ' oleh ' + bentrok.nama + '.', 'error');

  runSubmit('btnSubmitBooking', 'Mengirim...', 'Kirim Pengajuan Pinjam Ruangan', 'alertPinjam', function(runner) {
    runner.simpanBooking(form);
  }, function() {
    document.getElementById('formBooking').reset();
    resetIdentitasPeminjam('ruangan');
    setTanggalHariIni();
    renderChecklistBMNPinjam();
    pilihTanggalJadwal(form.tanggal);
  });
}

function submitPinjamKendaraan(event) {
  event.preventDefault();
  setMinDateTimeLocal();

  let identitas;
  try {
    identitas = identitasUntukSubmit('kendaraan');
  } catch (e) {
    return tampilAlert('alertPinjam', e.message || String(e), 'error');
  }

  const mulai = val('mulaiKendaraan');
  const batasKembali = val('batasKembaliKendaraan');
  const jenisMobil = val('jenisMobilKendaraan');
  const start = new Date(mulai);
  const end = new Date(batasKembali);

  if (!mulai || !batasKembali || isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    return tampilAlert('alertPinjam', 'Waktu penggunaan kendaraan belum valid.', 'error');
  }

  if (start < new Date()) {
    return tampilAlert('alertPinjam', 'Waktu mulai penggunaan kendaraan tidak boleh berada di masa lalu.', 'error');
  }

  if (!jenisMobil) {
    return tampilAlert(
      'alertPinjam',
      'Pilih jenis mobil yang masih tersedia. Kendaraan yang sudah terbooking/ACC tidak dapat dipilih.',
      'error'
    );
  }

  const infoJenis = (daftarKetersediaanKendaraan || []).find(function(item) {
    return item.jenisMobil === jenisMobil;
  });

  if (!infoJenis || Number(infoJenis.tersedia || 0) < 1) {
    const select = document.getElementById('jenisMobilKendaraan');
    if (select) select.value = '';

    return tampilAlert(
      'alertPinjam',
      'Jenis mobil tersebut sudah penuh/terbooking pada jadwal ini. Silakan pilih jenis mobil lain atau ubah waktu penggunaan.',
      'error'
    );
  }

  const form = {
    nip: identitas.nip,
    nama: identitas.nama,
    whatsapp: identitas.whatsapp,
    ubahWhatsapp: identitas.ubahWhatsapp,
    kegiatan: val('kegiatanKendaraan'),
    tujuan: val('tujuanKendaraan'),
    jenisMobil: jenisMobil,
    mulaiPenggunaan: mulai,
    batasKembali: batasKembali
  };

  runSubmit(
    'btnSubmitKendaraan',
    'Mengirim...',
    'Kirim Pengajuan Pinjam Kendaraan',
    'alertPinjam',
    function(runner) {
      runner.simpanPinjamKendaraan(form);
    },
    function() {
      document.getElementById('formPinjamKendaraan').reset();
      resetIdentitasPeminjam('kendaraan');
      resetKetersediaanKendaraan();
      setMinDateTimeLocal();
      muatPinjamKendaraan();
    }
  );
}

function submitPinjamSarpras(event) {
  event.preventDefault();
  setMinDateTimeLocal();
  let identitas;
  try { identitas = identitasUntukSubmit('sarpras'); }
  catch (e) { return tampilAlert('alertPinjam', e.message || String(e), 'error'); }

  const form = {
    nip: identitas.nip, nama: identitas.nama, whatsapp: identitas.whatsapp, ubahWhatsapp: identitas.ubahWhatsapp,
    kegiatan: val('kegiatanSarpras'), tempat: val('tempatSarpras'), tujuan: val('tempatSarpras'),
    jenisBarang: val('jenisBarangSarpras'), lama: val('lamaSarpras'), batasKembali: val('batasKembaliSarpras')
  };
  if (new Date(form.batasKembali) < new Date()) return tampilAlert('alertPinjam', 'Batas kembali sarpras tidak boleh berada di masa lalu.', 'error');
  runSubmit('btnSubmitSarpras', 'Mengirim...', 'Kirim Pengajuan Pinjam Sarpras', 'alertPinjam', r => r.simpanPinjamSarpras(form), function() {
    document.getElementById('formPinjamSarpras').reset();
    resetIdentitasPeminjam('sarpras');
    setMinDateTimeLocal();
    muatPinjamSarpras();
  });
}

function muatPinjamKendaraan() {
  google.script.run.withSuccessHandler(function(data) {
    daftarKendaraan = data || [];
    renderPinjamKendaraan('tabelPinjamKendaraan', daftarKendaraan, false);
  }).withFailureHandler(err => renderError('tabelPinjamKendaraan', err.message, 10)).getPinjamKendaraanRingkas(LIMIT_USER);
}
function muatPinjamSarpras() { google.script.run.withSuccessHandler(function(data) { daftarSarpras = data || []; renderPinjamSarpras('tabelPinjamSarpras', daftarSarpras, false); }).withFailureHandler(err => renderError('tabelPinjamSarpras', err.message, 8)).getPinjamSarprasRingkas(LIMIT_USER); }

function renderUnitKendaraanAdmin(row) {
  const assigned = String(row.mobilDitugaskan || '').trim();
  if (assigned) return '<span class="assigned-vehicle">' + escapeHtml(assigned) + '</span>';
  const modern = !!(row.jenisMobil && row.mulaiPenggunaan && row.batasKembali);
  const pending = normalizeText(row.status).includes('pending') || !normalizeText(row.status);
  if (!modern || !pending) return '<span class="muted">-</span>';
  const options = Array.isArray(row.opsiMobilDitugaskan) ? row.opsiMobilDitugaskan : [];
  const selectId = buatDomId('unitKendaraan_' + (row.idPinjam || ''));
  if (!options.length) return '<select id="' + selectId + '" class="unit-vehicle-select" data-requires-assignment="1" disabled><option value="">Tidak ada unit tersedia</option></select>';
  return '<select id="' + selectId + '" class="unit-vehicle-select" data-requires-assignment="1"><option value="">Pilih unit...</option>' + options.map(unit => '<option value="' + escapeHtml(unit) + '">' + escapeHtml(unit) + '</option>').join('') + '</select>';
}

function renderPinjamKendaraan(id, data, admin) {
  const tbody = document.getElementById(id); if (!tbody) return;
  const colspan = admin ? 12 : 10;
  let rows = data || [];
  if (admin && id === 'tabelAdminKendaraan') {
    rows = filterAdminPinjamRows(rows, 'filterAdminKendaraan', 'filterStatusAdminKendaraan', row => [row.idPinjam,row.tanggalPengajuan,row.nama,row.kegiatan,row.tujuan,row.jenisMobil,row.mulaiPenggunaan,row.batasKembali,row.mobilDitugaskan,row.status,statusDenganTerlambat(row),row.keteranganAdmin].join(' '));
    setTextIfExists('summaryAdminKendaraan', rows.length + ' dari ' + (data || []).length + ' pengajuan kendaraan');
  }
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="${colspan}">Data pinjam kendaraan tidak ditemukan.</td></tr>`; return; }

  tbody.innerHTML = rows.map(row => {
    const ket = row.keteranganAdmin || '';
    const idEncoded = encodeURIComponent(row.idPinjam || '');
    const noteId = buatDomId('ketKendaraan_' + (row.idPinjam || ''));
    const noteCell = admin
      ? `<td class="admin-note-cell"><textarea class="admin-note-input" id="${noteId}" maxlength="500" placeholder="Catatan untuk peminjam kendaraan, opsional...">${escapeHtml(ket)}</textarea><div style="margin-top:6px;"><button class="btn-light btn-small" onclick="simpanKeteranganKendaraan('${idEncoded}', '${noteId}', this)">Simpan Catatan</button></div></td>`
      : `<td><span class="admin-note-view">${escapeHtml(ket || '-')}</span></td>`;
    const jenis = escapeHtml(row.jenisMobil || '-');
    const mulai = escapeHtml(formatDateTimeRingkas(row.mulaiPenggunaan));
    const kembali = escapeHtml(formatDateTimeRingkas(row.batasKembali));
    const unit = admin ? renderUnitKendaraanAdmin(row) : escapeHtml(row.mobilDitugaskan || 'Menunggu penetapan admin');
    const status = badgeStatus(statusDenganTerlambat(row));
    const cls = isOverdue(row) ? 'return-warning' : '';

    if (admin) {
      return `<tr class="${cls}"><td>${escapeHtml(row.idPinjam)}</td><td>${escapeHtml(row.tanggalPengajuan || '-')}</td><td>${escapeHtml(row.nama)}</td><td>${escapeHtml(row.kegiatan)}</td><td>${escapeHtml(row.tujuan)}</td><td>${jenis}</td><td>${mulai}</td><td>${kembali}</td><td>${unit}</td><td>${status}</td>${noteCell}<td>${tombolAksiStatus('kendaraan', row.idPinjam, row.status, statusDenganTerlambat(row))}</td></tr>`;
    }
    return `<tr class="${cls}"><td>${escapeHtml(row.idPinjam)}</td><td>${escapeHtml(row.nama)}</td><td>${escapeHtml(row.kegiatan)}</td><td>${escapeHtml(row.tujuan)}</td><td>${jenis}</td><td>${mulai}</td><td>${kembali}</td><td>${unit}</td><td>${status}</td>${noteCell}</tr>`;
  }).join('');
}

function renderPinjamSarpras(id, data, admin) {
  const tbody = document.getElementById(id); if (!tbody) return;
  const colspan = admin ? 10 : 8;
  let rows = data || [];
  if (admin && id === 'tabelAdminSarpras') {
    rows = filterAdminPinjamRows(rows, 'filterAdminSarpras', 'filterStatusAdminSarpras', row => [row.idPinjam,row.tanggalPengajuan,row.nama,row.kegiatan,row.tempat,row.jenisBarang,row.lama,row.batasKembali,row.status,statusDenganTerlambat(row)].join(' '));
    setTextIfExists('summaryAdminSarpras', rows.length + ' dari ' + (data || []).length + ' pengajuan sarpras');
  }
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="${colspan}">Data pinjam sarpras tidak ditemukan.</td></tr>`; return; }
  tbody.innerHTML = rows.map(row => `<tr class="${isOverdue(row) ? 'return-warning' : ''}"><td>${escapeHtml(row.idPinjam)}</td>${admin ? `<td>${escapeHtml(row.tanggalPengajuan || '-')}</td>` : ''}<td>${escapeHtml(row.nama)}</td><td>${escapeHtml(row.kegiatan)}</td><td>${escapeHtml(row.tempat)}</td><td>${escapeHtml(row.jenisBarang)}</td><td>${escapeHtml(row.lama)}</td><td>${escapeHtml(formatDateTimeRingkas(row.batasKembali))}</td><td>${badgeStatus(statusDenganTerlambat(row))}</td>${admin ? `<td>${tombolAksiStatus('sarpras', row.idPinjam, row.status, statusDenganTerlambat(row))}</td>` : ''}</tr>`).join('');
}
function isOverdue(row) { const st = normalizeText(row.status); if (st.includes('dikembalikan') || st.includes('tolak')) return false; const t = row.batasKembali ? new Date(row.batasKembali) : null; return t && !isNaN(t.getTime()) && t < new Date(); }
function statusDenganTerlambat(row) { return isOverdue(row) ? 'Terlambat' : row.status; }

function submitPemeliharaan(event) { event.preventDefault(); const item = cariBMNDariInput(val('bmnPemeliharaanInput')); if (!item) return tampilAlert('alertPemeliharaan', 'Silakan pilih BMN dari daftar pencarian.', 'error'); const form = { kodeBarang: item.kodeBarang, nup: item.nup, namaBmn: item.nama, tanggal: val('tanggalPemeliharaan'), deskripsi: val('deskripsiPemeliharaan'), sumber: 'User' }; kirimPemeliharaanDenganFoto(form, 'fotoPemeliharaan', 'btnSubmitPemeliharaan', 'Kirim Laporan Pemeliharaan', 'alertPemeliharaan', function() { document.getElementById('formPemeliharaan').reset(); setTanggalHariIni(); tutupFormPemeliharaanUser(); muatPemeliharaan(); }); }
function submitAdminPemeliharaan(event) { event.preventDefault(); const item = cariBMNDariInput(val('bmnAdminPemeliharaanInput')); if (!item) return tampilAlert('alertAdminPemeliharaan', 'Silakan pilih BMN dari daftar pencarian.', 'error'); const form = { kodeBarang: item.kodeBarang, nup: item.nup, namaBmn: item.nama, tanggal: val('tanggalAdminPemeliharaan'), deskripsi: val('deskripsiAdminPemeliharaan'), sumber: 'Administrator' }; kirimPemeliharaanDenganFoto(form, 'fotoAdminPemeliharaan', 'btnSubmitAdminPemeliharaan', 'Simpan Pemeliharaan Rutin', 'alertAdminPemeliharaan', function() { document.getElementById('formAdminPemeliharaan').reset(); setTanggalHariIni(); muatPemeliharaanAdmin(); muatPemeliharaan(); }); }
function kirimPemeliharaanDenganFoto(form, fileInputId, btnId, defaultText, alertId, successCallback) { const file = document.getElementById(fileInputId).files[0]; if (!file) return kirimPemeliharaan(form, btnId, defaultText, alertId, successCallback); const reader = new FileReader(); reader.onload = e => { form.fotoBase64 = e.target.result; form.namaFile = file.name; kirimPemeliharaan(form, btnId, defaultText, alertId, successCallback); }; reader.onerror = () => tampilAlert(alertId, 'Gagal membaca file foto.', 'error'); reader.readAsDataURL(file); }
function kirimPemeliharaan(form, btnId, defaultText, alertId, successCallback) { runSubmit(btnId, 'Menyimpan...', defaultText, alertId, r => r.simpanPemeliharaan(form), successCallback); }
function muatPemeliharaan() { google.script.run.withSuccessHandler(data => renderTabelPemeliharaan(data || [])).withFailureHandler(err => renderError('tabelPemeliharaan', err.message, 7)).getPemeliharaanRingkas(LIMIT_USER); }
function renderTabelPemeliharaan(data) { const tbody = document.getElementById('tabelPemeliharaan'); if (!tbody) return; if (!data.length) { tbody.innerHTML = '<tr><td colspan="7">Belum ada laporan pemeliharaan.</td></tr>'; return; } tbody.innerHTML = data.map(row => `<tr><td>${escapeHtml(row.kodeBarang || '-')}</td><td>${escapeHtml(row.nup || '-')}</td><td>${escapeHtml(row.nama || '-')}</td><td>${escapeHtml(row.tgl || '-')}</td><td>${escapeHtml(row.ket || '-')}</td><td>${row.foto && row.foto !== '-' ? `<a href="${escapeHtml(row.foto)}" target="_blank">Lihat Foto</a>` : '-'}</td><td>${badgeStatus(row.status)}</td></tr>`).join(''); }


function lokasiUtamaInventaris() { return ['Ruang Aula', 'Ruang Zona Integritas', 'Ruang Transit']; }
function namaLokasiBMN(item) { return String((item && item.lokasi) || '').trim() || 'Tanpa Lokasi'; }
function daftarLokasiInventaris() {
  const set = new Set((masterData.bmn || []).map(namaLokasiBMN));
  const utama = lokasiUtamaInventaris().filter(l => set.has(l));
  const lain = Array.from(set).filter(l => !lokasiUtamaInventaris().includes(l)).sort((a,b) => a.localeCompare(b, 'id', { numeric:true, sensitivity:'base' }));
  return utama.concat(lain);
}
function dataInventarisLokasi(lokasi) {
  return (masterData.bmn || []).filter(item => namaLokasiBMN(item) === lokasi);
}
function badgeKondisiRingkas(label, jumlah) { return `<span>${escapeHtml(label)}: ${jumlah}</span>`; }
function hitungKondisi(data) {
  const ringkas = { baik:0, ringan:0, berat:0, lain:0 };
  data.forEach(item => {
    const kondisi = normalizeText(item.kondisi || '');
    if (kondisi.includes('baik')) ringkas.baik++;
    else if (kondisi.includes('ringan')) ringkas.ringan++;
    else if (kondisi.includes('berat')) ringkas.berat++;
    else ringkas.lain++;
  });
  return ringkas;
}
function renderSelectInventarisLokasi(lokasiList) {
  const select = document.getElementById('selectInventarisLokasi');
  if (!select) return;
  select.innerHTML = lokasiList.map(lokasi => `<option value="${escapeHtml(lokasi)}" ${lokasi === inventarisLokasiAktif ? 'selected' : ''}>${escapeHtml(lokasi)}</option>`).join('');
}
function renderKartuInventarisLokasi(lokasiList) {
  const grid = document.getElementById('inventarisRoomGrid');
  if (!grid) return;
  if (!lokasiList.length) {
    grid.innerHTML = '<div class="empty-guide" style="grid-column:1/-1;">Belum ada data lokasi BMN. Isi kolom Lokasi pada sheet Data_BMN terlebih dahulu.</div>';
    return;
  }
  grid.innerHTML = lokasiList.map(lokasi => {
    const data = dataInventarisLokasi(lokasi);
    const k = hitungKondisi(data);
    const aktif = lokasi === inventarisLokasiAktif ? 'active' : '';
    return `<button class="inventory-room-card ${aktif}" onclick="pilihLokasiInventaris('${encodeURIComponent(lokasi)}')">
      <h3>${escapeHtml(lokasi)}</h3>
      <div class="count">${data.length}</div>
      <p class="muted">item BMN tercatat</p>
      <div class="inventory-meta">${badgeKondisiRingkas('Baik', k.baik)}${badgeKondisiRingkas('RR', k.ringan)}${badgeKondisiRingkas('RB', k.berat)}${k.lain ? badgeKondisiRingkas('Lain', k.lain) : ''}</div>
    </button>`;
  }).join('');
}
function pilihLokasiInventaris(encodedLokasi) {
  inventarisLokasiAktif = decodeURIComponent(encodedLokasi || '');
  renderInventarisRuangan(false);
  pushHistoryState({ section: 'dashboardInventarisRuangan', inventarisLokasi: inventarisLokasiAktif });
}
function pilihLokasiInventarisSelect() {
  inventarisLokasiAktif = val('selectInventarisLokasi');
  renderInventarisRuangan(false);
  pushHistoryState({ section: 'dashboardInventarisRuangan', inventarisLokasi: inventarisLokasiAktif });
}
function resetInventarisRuangan() {
  const search = document.getElementById('searchInventarisRuangan');
  if (search) search.value = '';
  renderInventarisRuangan(false);
}
function renderInventarisRuangan(resetLokasi) {
  if (!masterDataLoaded) return pastikanMasterData(function() { renderInventarisRuangan(resetLokasi); });
  const tbody = document.getElementById('tabelInventarisRuangan');
  if (!tbody) return;
  const lokasiList = daftarLokasiInventaris();
  if (resetLokasi || !inventarisLokasiAktif || !lokasiList.includes(inventarisLokasiAktif)) {
    inventarisLokasiAktif = lokasiList[0] || '';
  }
  renderSelectInventarisLokasi(lokasiList);
  renderKartuInventarisLokasi(lokasiList);

  const judul = document.getElementById('judulInventarisRuangan');
  const ringkasan = document.getElementById('ringkasanInventarisRuangan');

  if (!inventarisLokasiAktif) {
    if (judul) judul.textContent = 'Inventaris Ruangan';
    if (ringkasan) ringkasan.textContent = 'Belum ada data lokasi BMN.';
    tbody.innerHTML = '<tr><td colspan="8">Belum ada data lokasi BMN.</td></tr>';
    return;
  }

  const keyword = normalizeText(val('searchInventarisRuangan'));
  const keys = keyword.split(' ').filter(Boolean);
  const semuaDiLokasi = dataInventarisLokasi(inventarisLokasiAktif);
  const data = semuaDiLokasi.filter(item => {
    const txt = normalizeText([item.kodeBarang, item.nup, item.nama, item.merk, item.tahunPerolehan, item.kondisi, item.pj].join(' '));
    return keys.every(k => txt.includes(k));
  }).sort((a,b) => String(a.nama || '').localeCompare(String(b.nama || ''), 'id', { numeric:true, sensitivity:'base' }));

  if (judul) judul.textContent = 'Inventaris ' + inventarisLokasiAktif;
  if (ringkasan) ringkasan.textContent = data.length + ' dari ' + semuaDiLokasi.length + ' BMN ditampilkan' + (keyword ? ' berdasarkan pencarian.' : '.');

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="8">Tidak ada BMN yang cocok pada ruangan ini.</td></tr>';
    return;
  }
  tbody.innerHTML = data.map((item, i) => `<tr><td>${i+1}</td><td>${escapeHtml(item.kodeBarang || '-')}</td><td>${escapeHtml(item.nup || '-')}</td><td>${escapeHtml(item.nama || '-')}</td><td>${escapeHtml(item.merk || '-')}</td><td>${escapeHtml(item.tahunPerolehan || '-')}</td><td>${escapeHtml(item.kondisi || '-')}</td><td>${escapeHtml(item.pj || '-')}</td></tr>`).join('');
}

function submitLoginAdmin(event) { event.preventDefault(); runSubmit('btnLoginAdmin', 'Memverifikasi...', 'Masuk Administrator', 'alertLoginAdmin', r => r.verifikasiPin(val('pinAdmin')), function(valid) { if (!valid) { tampilAlert('alertLoginAdmin', 'PIN salah. Silakan coba lagi.', 'error'); return false; } adminLogin = true; sessionStorage.setItem('adminLoginBMN','1'); document.getElementById('formLoginAdmin').reset(); tampilkanSection('dashboardAdmin'); }); }
function logoutAdmin() { fetch('/api/logout', { method:'POST', credentials:'same-origin' }).catch(() => {}); adminLogin = false; sessionStorage.removeItem('adminLoginBMN'); kembaliKeUtama(); }
function pastikanAdminLogin() { if (adminLogin) return true; bukaLoginAdmin(); return false; }
function kembaliKeDashboardAdmin() { if (pastikanAdminLogin()) tampilkanSection('dashboardAdmin'); }
function bukaAdminFitur(id) {
  if (!pastikanAdminLogin()) return;
  tampilkanSection(id);
  if (id === 'adminDataBMN') pastikanMasterData(renderAdminDataBMN);
  if (id === 'adminLokasiBMN') pastikanMasterData(renderAdminLokasiBMN);
  if (id === 'adminPemeliharaan') muatPemeliharaanAdmin();
  if (id === 'adminPinjamPakaiBMN') resetPanelAdminPinjam();
}

function toggleFormInputBMN(show) { const card = document.getElementById('cardInputBMNBaru'); card.classList.toggle('hidden', !show); if (show) document.getElementById('inputKodeBarangBMN').focus(); }
function submitInputBMNBaru(event) { event.preventDefault(); const form = { kodeBarang: val('inputKodeBarangBMN'), nup: val('inputNupBMN'), namaBmn: val('inputNamaBMN'), merk: val('inputMerkBMN'), tahunPerolehan: val('inputTahunBMN'), kondisi: val('inputKondisiBMN'), lokasi: val('inputLokasiBMN'), pj: val('inputPjBMN') }; runSubmit('btnSimpanBMNBaru', 'Menyimpan...', 'Simpan Data BMN', 'alertInputBMN', r => r.simpanBMN(form), function() { document.getElementById('formInputBMNBaru').reset(); toggleFormInputBMN(false); muatMasterData(function() { renderAdminDataBMN(); renderAdminLokasiBMN(); }, true); }); }
function filterDataBMN(keyword) {
  const keys = normalizeText(keyword).split(' ').filter(Boolean);
  return (masterData.bmn || []).filter(item => {
    const txt = normalizeText([item.kodeBarang,item.nup,item.id,item.nama,item.merk,item.tahunPerolehan,item.kondisi,item.lokasi,item.pj].join(' '));
    return keys.every(k => txt.includes(k));
  });
}
function nilaiSortBMN(item, key) {
  const nilai = item && item[key] != null ? item[key] : '';
  if (key === 'nup' || key === 'tahunPerolehan') {
    const angka = Number(String(nilai).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(angka) ? angka : String(nilai || '').toLowerCase();
  }
  return normalizeText(nilai || '');
}
function sortRowsBMN(data, state) {
  const hasil = [...(data || [])];
  const key = state.key;
  const dir = state.dir === 'desc' ? -1 : 1;
  hasil.sort((a, b) => {
    const va = nilaiSortBMN(a, key);
    const vb = nilaiSortBMN(b, key);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb), 'id', { numeric: true, sensitivity: 'base' }) * dir;
  });
  return hasil;
}
function refreshSortChips(group, state) {
  document.querySelectorAll(`[data-sort-group="${group}"]`).forEach(btn => {
    const aktif = btn.dataset.sortKey === state.key;
    btn.classList.toggle('active', aktif);
    const labelAsli = btn.dataset.originalLabel || btn.textContent.replace(/\s*[↑↓]$/,'');
    btn.dataset.originalLabel = labelAsli;
    btn.textContent = aktif ? `${labelAsli} ${state.dir === 'asc' ? '↑' : '↓'}` : labelAsli;
  });
}
function setSortDataBMN(key) {
  if (sortDataBMN.key === key) sortDataBMN.dir = sortDataBMN.dir === 'asc' ? 'desc' : 'asc';
  else sortDataBMN = { key, dir: 'asc' };
  renderAdminDataBMN();
}
function setSortLokasiBMN(key) {
  if (sortLokasiBMN.key === key) sortLokasiBMN.dir = sortLokasiBMN.dir === 'asc' ? 'desc' : 'asc';
  else sortLokasiBMN = { key, dir: 'asc' };
  renderAdminLokasiBMN();
}
function renderAdminDataBMN() {
  if (!masterDataLoaded) return pastikanMasterData(renderAdminDataBMN);
  const tbody = document.getElementById('tabelAdminDataBMN');
  const semua = masterData.bmn || [];
  const data = sortRowsBMN(filterDataBMN(val('filterAdminDataBMN')), sortDataBMN);
  refreshSortChips('data-bmn', sortDataBMN);
  document.getElementById('jumlahAdminDataBMN').textContent = data.length + ' dari ' + semua.length + ' data BMN';
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="7">Data BMN tidak ditemukan.</td></tr>'; return; }
  tbody.innerHTML = data.map((item,i) => `<tr><td>${i+1}</td><td>${escapeHtml(item.kodeBarang || '-')}</td><td>${escapeHtml(item.nup || '-')}</td><td>${escapeHtml(item.nama || '-')}</td><td>${escapeHtml(item.merk || '-')}</td><td>${escapeHtml(item.tahunPerolehan || '-')}</td><td>${escapeHtml(item.kondisi || '-')}</td></tr>`).join('');
}
function renderAdminLokasiBMN() {
  if (!masterDataLoaded) return pastikanMasterData(renderAdminLokasiBMN);
  const tbody = document.getElementById('tabelAdminLokasiBMN');
  const semua = masterData.bmn || [];
  const data = sortRowsBMN(filterDataBMN(val('filterAdminLokasiBMN')), sortLokasiBMN);
  refreshSortChips('lokasi-bmn', sortLokasiBMN);
  const totalLokasi = new Set(semua.map(item => item.lokasi || 'Tanpa Lokasi')).size;
  document.getElementById('jumlahAdminLokasiBMN').textContent = data.length + ' data BMN · ' + totalLokasi + ' lokasi terdeteksi';
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="9">Data lokasi BMN tidak ditemukan.</td></tr>'; return; }
  tbody.innerHTML = data.map((item,i) => `<tr><td>${i+1}</td><td>${escapeHtml(item.lokasi || 'Tanpa Lokasi')}</td><td>${escapeHtml(item.pj || '-')}</td><td>${escapeHtml(item.kodeBarang || '-')}</td><td>${escapeHtml(item.nup || '-')}</td><td>${escapeHtml(item.nama || '-')}</td><td>${escapeHtml(item.merk || '-')}</td><td>${escapeHtml(item.tahunPerolehan || '-')}</td><td>${escapeHtml(item.kondisi || '-')}</td></tr>`).join('');
}
function kosongkanValue(ids) { ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; }); }
function resetAllAdminDataBMNSearch() { kosongkanValue(['filterAdminDataBMN']); renderAdminDataBMN(); }
function resetAllAdminLokasiBMNSearch() { kosongkanValue(['filterAdminLokasiBMN']); renderAdminLokasiBMN(); }
function resetFilterAdmin(inputId, callback) { const el = document.getElementById(inputId); if (el) el.value = ''; callback(); }

function muatPemeliharaanAdmin() { google.script.run.withSuccessHandler(data => renderTabelPemeliharaanAdmin(data || [])).withFailureHandler(err => renderError('tabelAdminPemeliharaan', err.message, 10)).getPemeliharaanAdminRingkas(LIMIT_ADMIN); }
function renderTabelPemeliharaanAdmin(data) { const tbody = document.getElementById('tabelAdminPemeliharaan'); if (!data.length) { tbody.innerHTML = '<tr><td colspan="10">Belum ada data pemeliharaan.</td></tr>'; return; } tbody.innerHTML = data.map(row => `<tr><td>${escapeHtml(row.idPemeliharaan || '-')}</td><td>${escapeHtml(row.kodeBarang || '-')}</td><td>${escapeHtml(row.nup || '-')}</td><td>${escapeHtml(row.nama || '-')}</td><td>${escapeHtml(row.tgl || '-')}</td><td>${escapeHtml(row.ket || '-')}</td><td>${row.foto && row.foto !== '-' ? `<a href="${escapeHtml(row.foto)}" target="_blank">Lihat Foto</a>` : '-'}</td><td>${escapeHtml(row.sumber || 'User')}</td><td>${badgeStatus(row.status)}</td><td>${tombolAksiStatus('pemeliharaan', row.idPemeliharaan, row.status)}</td></tr>`).join(''); }

function muatPinjamPakaiAdmin() { muatJadwalAdmin(); muatPinjamKendaraanAdmin(); muatPinjamSarprasAdmin(); }
function muatJadwalAdmin() { google.script.run.withSuccessHandler(data => { daftarJadwal = data || []; renderTabelJadwalAdmin(daftarJadwal); }).withFailureHandler(err => renderError('tabelAdminJadwal', err.message, 11)).getJadwalAdminRingkas(LIMIT_ADMIN); }
function muatPinjamKendaraanAdmin() { google.script.run.withSuccessHandler(data => { daftarKendaraan = data || []; renderPinjamKendaraan('tabelAdminKendaraan', daftarKendaraan, true); }).withFailureHandler(err => renderError('tabelAdminKendaraan', err.message, 12)).getPinjamKendaraanAdminRingkas(LIMIT_ADMIN); }
function muatPinjamSarprasAdmin() { google.script.run.withSuccessHandler(data => { daftarSarpras = data || []; renderPinjamSarpras('tabelAdminSarpras', daftarSarpras, true); }).withFailureHandler(err => renderError('tabelAdminSarpras', err.message, 10)).getPinjamSarprasAdminRingkas(LIMIT_ADMIN); }
function filterAdminPinjamRows(data, inputId, statusId, textFn) {
  let hasil = data || [];
  const keyword = normalizeText(val(inputId));
  const status = normalizeText(val(statusId));
  if (keyword) {
    const keys = keyword.split(' ').filter(Boolean);
    hasil = hasil.filter(row => { const teks = normalizeText(textFn(row)); return keys.every(k => teks.includes(k)); });
  }
  if (status && status !== 'semua') hasil = hasil.filter(row => normalizeText(statusDenganTerlambat(row)).includes(status) || normalizeText(row.status).includes(status));
  return hasil;
}
function setTextIfExists(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function renderTabelJadwalAdmin(data) {
  const tbody = document.getElementById('tabelAdminJadwal'); if (!tbody) return;
  const filtered = filterAdminPinjamRows(data, 'filterAdminJadwal', 'filterStatusAdminJadwal', row => [row.idBooking,row.tanggal,row.ruangan,row.mulai,row.selesai,row.nama,row.namaKegiatan,row.jumlahPeserta,row.pesertaJabatan,row.bmnPinjam,row.status].join(' '));
  setTextIfExists('summaryAdminJadwal', filtered.length + ' dari ' + (data || []).length + ' pengajuan ruangan');
  if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="11">Data pinjam ruangan tidak ditemukan.</td></tr>'; return; }
  tbody.innerHTML = filtered.map(row => `<tr><td>${escapeHtml(row.idBooking || '-')}</td><td>${escapeHtml(row.tanggal)}</td><td>${escapeHtml(row.ruangan)}</td><td>${escapeHtml(row.mulai)} - ${escapeHtml(row.selesai)}</td><td>${escapeHtml(row.nama)}</td><td>${escapeHtml(row.namaKegiatan || '-')}</td><td>${escapeHtml(row.jumlahPeserta || '-')}</td><td>${escapeHtml(row.pesertaJabatan || '-')}</td><td>${escapeHtml(row.bmnPinjam || '-')}</td><td>${badgeStatus(row.status)}</td><td>${tombolAksiStatus('booking', row.idBooking, row.status)}</td></tr>`).join('');
}

function simpanKeteranganKendaraan(idEncoded, textareaId, tombol) {
  if (!pastikanAdminLogin()) return;

  const id = decodeURIComponent(idEncoded || '');
  const textarea = document.getElementById(textareaId);
  const keterangan = textarea ? String(textarea.value || '').trim() : '';

  if (keterangan.length > 500) {
    return tampilAlert('alertAdminPinjam', 'Keterangan admin maksimal 500 karakter.', 'error');
  }

  const teksAwal = tombol ? tombol.textContent : '';
  if (tombol) {
    tombol.disabled = true;
    tombol.textContent = 'Menyimpan...';
  }

  google.script.run.withSuccessHandler(function(pesan) {
    if (tombol) {
      tombol.disabled = false;
      tombol.textContent = teksAwal || 'Simpan Catatan';
    }
    tampilAlert('alertAdminPinjam', pesan, 'success');
    muatPinjamKendaraanAdmin();
    muatPinjamKendaraan();
  }).withFailureHandler(function(err) {
    if (tombol) {
      tombol.disabled = false;
      tombol.textContent = teksAwal || 'Simpan Catatan';
    }
    tampilAlert('alertAdminPinjam', 'Gagal menyimpan keterangan admin: ' + (err.message || err), 'error');
  }).updateKeteranganKendaraan(id, keterangan);
}

function tombolAksiStatus(tipe, idData, statusSekarang, statusTampil) {
  if (!idData) return '<span class="muted">ID belum tersedia</span>';

  const statusRaw = normalizeText(statusSekarang);
  const statusView = normalizeText(statusTampil || statusSekarang);
  const id = encodeURIComponent(idData);
  const isPending = !statusRaw || statusRaw.includes('pending');
  const isDitolak = statusRaw.includes('tolak') || statusView.includes('tolak');
  const isDikembalikan = statusRaw.includes('dikembalikan') || statusView.includes('dikembalikan');
  const isDisetujui = statusRaw.includes('acc') || statusRaw.includes('setuju') || statusRaw.includes('dipakai') || statusView.includes('terlambat');

  if (isPending) {
    return `<div class="action-group"><button class="btn-green btn-small" onclick="ubahStatusAdmin('${tipe}','${id}','ACC', this)">ACC</button><button class="btn-danger btn-small" onclick="ubahStatusAdmin('${tipe}','${id}','Ditolak', this)">Tolak</button></div>`;
  }

  if ((tipe === 'kendaraan' || tipe === 'sarpras') && isDisetujui && !isDitolak && !isDikembalikan) {
    return `<div class="action-group"><button class="btn-light btn-small" onclick="ubahStatusAdmin('${tipe}','${id}','Dikembalikan', this)">Dikembalikan</button></div>`;
  }

  return '<span class="muted">Tidak ada aksi</span>';
}
function ubahStatusAdmin(tipe, idEncoded, statusBaru, tombol) {
  if (!pastikanAdminLogin()) return;
  const id = decodeURIComponent(idEncoded || '');
  let keteranganAdmin = '';
  let mobilDitugaskan = '';

  if (tipe === 'kendaraan') {
    const noteEl = document.getElementById(buatDomId('ketKendaraan_' + id));
    keteranganAdmin = noteEl ? String(noteEl.value || '').trim() : '';
    if (statusBaru === 'ACC') {
      const unitEl = document.getElementById(buatDomId('unitKendaraan_' + id));
      if (unitEl) {
        mobilDitugaskan = String(unitEl.value || '').trim();
        if (unitEl.dataset.requiresAssignment === '1' && !mobilDitugaskan) {
          return tampilAlert('alertAdminPinjam', 'Pilih mobil yang ditugaskan sebelum ACC.', 'error');
        }
      }
    }
  }

  if (statusBaru === 'Ditolak' && !keteranganAdmin) {
    const alasan = window.prompt('Keterangan/alasan penolakan untuk peminjam (opsional):', '');
    if (alasan === null) return;
    keteranganAdmin = String(alasan || '').trim();
  }
  if (keteranganAdmin.length > 500) return tampilAlert('alertAdminPinjam', 'Keterangan admin maksimal 500 karakter.', 'error');

  const detailKonfirmasi = tipe === 'kendaraan' && statusBaru === 'ACC' && mobilDitugaskan ? ' dengan unit ' + mobilDitugaskan : '';
  if (!confirm('Ubah status data ' + id + ' menjadi ' + statusBaru + detailKonfirmasi + '?')) return;

  const wrapperAksi = tombol ? tombol.closest('.action-group') : null;
  if (wrapperAksi) {
    wrapperAksi.querySelectorAll('button').forEach(btn => btn.disabled = true);
    wrapperAksi.insertAdjacentHTML('beforeend', '<span class="muted"> Memproses...</span>');
  }

  const runner = google.script.run.withSuccessHandler(function(pesan) {
    tampilAlert(tipe === 'pemeliharaan' ? 'alertAdminPemeliharaan' : 'alertAdminPinjam', pesan, 'success');
    if (tipe === 'pemeliharaan') {
      muatPemeliharaanAdmin();
      if (isVisible('dashboardPemeliharaan')) muatPemeliharaan();
    } else if (tipe === 'booking') {
      muatJadwalAdmin();
      if (isVisible('panelPinjamRuangan')) muatJadwal();
    } else if (tipe === 'kendaraan') {
      muatPinjamKendaraanAdmin();
      if (isVisible('panelPinjamKendaraan')) { muatPinjamKendaraan(); muatKetersediaanKendaraan(); }
    } else if (tipe === 'sarpras') {
      muatPinjamSarprasAdmin();
      if (isVisible('panelPinjamSarpras')) muatPinjamSarpras();
    }
  }).withFailureHandler(function(err) {
    if (wrapperAksi) {
      wrapperAksi.querySelectorAll('button').forEach(btn => btn.disabled = false);
      const proses = wrapperAksi.querySelector('.muted');
      if (proses) proses.remove();
    }
    tampilAlert(tipe === 'pemeliharaan' ? 'alertAdminPemeliharaan' : 'alertAdminPinjam', 'Gagal mengubah status: ' + (err.message || err), 'error');
  });

  if (tipe === 'pemeliharaan') return runner.ubahStatusPemeliharaan(id, statusBaru);
  if (tipe === 'booking') return runner.ubahStatusBooking(id, statusBaru, keteranganAdmin);
  if (tipe === 'kendaraan') return runner.ubahStatusKendaraan(id, statusBaru, mobilDitugaskan, keteranganAdmin);
  if (tipe === 'sarpras') return runner.ubahStatusSarpras(id, statusBaru, keteranganAdmin);
}

function buatDomId(value) { return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_'); }
function runSubmit(btnId, loadingText, defaultText, alertId, callFn, successCallback) { const btn = document.getElementById(btnId); btn.disabled = true; btn.textContent = loadingText; const runner = google.script.run.withSuccessHandler(function(result) { btn.disabled = false; btn.textContent = defaultText; if (successCallback) { const cont = successCallback(result); if (cont === false) return; } tampilAlert(alertId, typeof result === 'string' ? result : 'Berhasil.', 'success'); }).withFailureHandler(function(err) { btn.disabled = false; btn.textContent = defaultText; tampilAlert(alertId, err.message || 'Terjadi kesalahan.', 'error'); }); callFn(runner); }
function badgeStatus(status) { const n = normalizeText(status); let c = 'status-default'; if (n.includes('pending')) c = 'status-pending'; if (n.includes('acc') || n.includes('setuju')) c = 'status-acc'; if (n.includes('tolak')) c = 'status-ditolak'; if (n.includes('dikembalikan')) c = 'status-dikembalikan'; if (n.includes('dipakai')) c = 'status-dipakai'; if (n.includes('terlambat')) c = 'status-terlambat'; return `<span class="status ${c}">${escapeHtml(status || '-')}</span>`; }
function tampilAlert(id, pesan, tipe) { const el = document.getElementById(id); if (!el) return; el.className = 'alert show ' + (tipe === 'success' ? 'alert-success' : tipe === 'info' ? 'alert-info' : 'alert-error'); el.textContent = pesan; }
function renderError(id, pesan, colspan) { const el = document.getElementById(id); if (el) el.innerHTML = `<tr><td colspan="${colspan}">Gagal memuat data: ${escapeHtml(pesan || '')}</td></tr>`; }
function val(id) { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
function normalizeText(value) { return String(value || '').toLowerCase().trim().replace(/\s+/g,' '); }
function isVisible(id) { const el = document.getElementById(id); return !!(el && !el.classList.contains('hidden')); }
function escapeHtml(value) { return String(value == null ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
