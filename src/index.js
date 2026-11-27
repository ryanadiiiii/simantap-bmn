const PUBLIC_ACTIONS = new Set([
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
]);

const ADMIN_ACTIONS = new Set([
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
]);

const ADMIN_COOKIE = 'simantap_admin';
const encoder = new TextEncoder();


// Request baca boleh dicoba ulang jika Google Apps Script sesaat mengembalikan
// halaman HTML/error gateway, karena operasi ini tidak mengubah data.
// Request tulis/ubah status TIDAK pernah di-retry otomatis untuk mencegah duplikasi.
const READ_ONLY_ACTIONS = new Set([
  'getMasterDataOptimized',
  'getPegawaiByNip',
  'getKendaraanAvailabilitySnapshot',
  'getKetersediaanKendaraan',
  'getJadwalRingkas',
  'getPemeliharaanRingkas',
  'getPinjamKendaraanRingkas',
  'getPinjamSarprasRingkas',
  'getJadwalAdminRingkas',
  'getPemeliharaanAdminRingkas',
  'getPinjamKendaraanAdminRingkas',
  'getPinjamSarprasAdminRingkas'
]);

const GAS_READ_MAX_ATTEMPTS = 3;
const GAS_RETRY_DELAYS_MS = [0, 250, 700];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'SIMANTAP BMN Worker', backendConfigured: Boolean(env.GAS_WEBAPP_URL && env.GAS_API_SECRET), fonnteWebhookConfigured: Boolean(env.FONNTE_WEBHOOK_SECRET), waWebhookVersion: 'WA-WEBHOOK-PARSER-V4' });
    }

    if (url.pathname === '/api/logout' && request.method === 'POST') {
      return json({ ok: true }, 200, {
        'Set-Cookie': `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
      });
    }

    if (url.pathname === '/api/fonnte/webhook') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method tidak diizinkan.' }, 405);
      return handleFonnteWebhook(request, env, url);
    }

    if (url.pathname === '/api/gas') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method tidak diizinkan.' }, 405);
      return handleGas(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleFonnteWebhook(request, env, url) {
  if (!env.GAS_WEBAPP_URL || !env.GAS_API_SECRET) {
    return json({ ok: false, error: 'Backend SIMANTAP belum dikonfigurasi.' }, 503);
  }
  if (!env.FONNTE_WEBHOOK_SECRET) {
    return json({ ok: false, error: 'FONNTE_WEBHOOK_SECRET belum dikonfigurasi pada Worker.' }, 503);
  }

  let body;
  try {
    body = await readWebhookBody(request);
  } catch (_) {
    // Webhook malformed dianggap selesai agar provider tidak mengulang payload
    // yang sama berkali-kali.
    return json({ ok: true, ignored: true, reason: 'INVALID_PAYLOAD' });
  }

  const suppliedSecret = String(
    url.searchParams.get('key') ||
    request.headers.get('x-fonnte-secret') ||
    request.headers.get('x-webhook-secret') ||
    body?.secret || body?.secretKey || body?.secret_key || ''
  ).trim();

  if (!safeSecretEqual(suppliedSecret, String(env.FONNTE_WEBHOOK_SECRET))) {
    return json({ ok: false, error: 'Webhook tidak terotorisasi.' }, 403);
  }

  const requestId = createRequestId();
  const contentType = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const rawSender = String(body?.sender || '').trim();
  const rawMember = String(body?.member || '').trim();
  const rawMessage = String(body?.message ?? body?.text ?? '').trim();
  const senderIdentity = parseWhatsappIdentity(rawSender);
  const memberIdentity = parseWhatsappIdentity(rawMember);
  const sender = senderIdentity.phone || memberIdentity.phone;
  const senderSource = senderIdentity.phone ? 'sender' : (memberIdentity.phone ? 'member' : 'none');
  const message = rawMessage.slice(0, 800);

  // Diagnosis aman diletakkan SEBELUM early-return. Tidak mencetak nomor/pesan penuh.
  const keys = Object.keys(body || {}).sort().slice(0, 40).join(',');
  console.log(
    `[SIMANTAP][${requestId}] Fonnte payload ct=${contentType || '-'} keys=${keys || '-'} ` +
    `senderKind=${senderIdentity.kind} senderLast4=${senderIdentity.last4} ` +
    `memberKind=${memberIdentity.kind} memberLast4=${memberIdentity.last4} ` +
    `messageLen=${rawMessage.length} command=${classifyWhatsappCommand(rawMessage)}`
  );

  if (!message) {
    console.warn(`[SIMANTAP][${requestId}] Webhook diabaikan: EMPTY_MESSAGE`);
    return json({ ok: true, ignored: true, reason: 'EMPTY_MESSAGE', requestId }, 200);
  }

  // Jangan pernah mengubah @lid menjadi nomor telepon secara paksa. Itu dapat
  // membuat identitas palsu yang kebetulan lolos regex dan merusak otorisasi.
  if (!sender) {
    const reason = (senderIdentity.kind === 'LID' || memberIdentity.kind === 'LID')
      ? 'LID_SENDER_UNMAPPED'
      : 'SENDER_NOT_READABLE';
    console.warn(`[SIMANTAP][${requestId}] Webhook diabaikan: ${reason}`);
    return json({ ok: true, ignored: true, reason, requestId }, 200);
  }

  console.log(`[SIMANTAP][${requestId}] Fonnte inbound source=${senderSource} sender=${maskWhatsappNumber(sender)} command=${classifyWhatsappCommand(message)}`);
  const gasPayload = {
    apiKey: env.GAS_API_SECRET,
    action: 'prosesPerintahWaOperator',
    args: [{
      sender,
      message,
      device: normalizeWhatsappNumber(body?.device || ''),
      timestamp: String(body?.timestamp || ''),
      inboxid: String(body?.inboxid || ''),
      requestId
    }],
    webhookAuthorized: true,
    requestId
  };

  // Perintah WhatsApp dapat mengubah data. Jangan retry di Worker. Fonnte sendiri
  // akan mengulang webhook jika endpoint tidak mengembalikan HTTP 200, sementara
  // backend SIMANTAP dibuat idempotent terhadap status yang sudah diproses.
  const gasCall = await callAppsScriptJson({
    url: env.GAS_WEBAPP_URL,
    payload: gasPayload,
    action: 'prosesPerintahWaOperator',
    requestId,
    retryable: false
  });

  if (!gasCall.ok) {
    // PENTING: setelah secret webhook valid, selalu ACK HTTP 200 ke Fonnte.
    // Fonnte akan retry webhook setiap menit bila menerima non-200. Untuk command
    // singkat FIFO seperti ACC, retry provider berisiko memproses transaksi berikutnya
    // bila request pertama sebenarnya sudah tersimpan tetapi respons GAS bermasalah.
    console.error(`[SIMANTAP][${requestId}] Fonnte -> GAS FAILED code=${gasCall.code || 'UNKNOWN'} error=${String(gasCall.error || '-').slice(0, 180)}`);
    return json({
      ok: true,
      accepted: true,
      backendOk: false,
      code: gasCall.code || 'GAS_FAILED',
      requestId
    }, 200);
  }

  const result = gasCall.result;
  if (!result || result.ok !== true) {
    console.error(`[SIMANTAP][${requestId}] GAS REJECTED code=${result?.code || 'BACKEND_REJECTED'} error=${String(result?.error || '-').slice(0, 180)}`);
    return json({
      ok: true,
      accepted: true,
      backendOk: false,
      code: result?.code || 'BACKEND_REJECTED',
      requestId: result?.requestId || requestId
    }, 200);
  }

  const backendResult = result.result || {};
  console.log(`[SIMANTAP][${requestId}] Fonnte -> GAS OK processed=${backendResult.processed === true} ignored=${backendResult.ignored === true} reason=${String(backendResult.reason || '-').slice(0, 100)} target=${String(backendResult.targetId || '-').slice(0, 80)}`);

  return json({
    ok: true,
    accepted: true,
    backendOk: true,
    processed: backendResult.processed === true,
    ignored: backendResult.ignored === true,
    reason: backendResult.reason || '',
    requestId: result.requestId || requestId
  }, 200);
}

async function readWebhookBody(request) {
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();

  // Fonnte umumnya JSON, tetapi setelah reconnect/provider update payload dapat
  // dikirim sebagai form-urlencoded atau multipart. Dukung ketiganya.
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const out = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') out[key] = value;
      else out[key] = value?.name || '';
    }
    return out;
  }

  const raw = await request.text();
  if (!raw) return {};

  if (contentType.includes('application/json')) {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    const out = {};
    for (const [key, value] of params.entries()) out[key] = value;
    return out;
  }

  // Fallback untuk provider/proxy yang tidak memberi Content-Type yang tepat.
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    const params = new URLSearchParams(raw);
    const out = {};
    for (const [key, value] of params.entries()) out[key] = value;
    return out;
  }
}

function parseWhatsappIdentity(value) {
  const raw = String(value || '').trim();
  if (!raw) return { kind: 'EMPTY', phone: '', last4: '-' };
  const lower = raw.toLowerCase();
  const digits = raw.replace(/\D/g, '');
  const last4 = digits ? digits.slice(-4) : '-';

  if (lower.includes('@lid')) {
    return { kind: 'LID', phone: '', last4 };
  }

  const phone = normalizeWhatsappNumber(raw);
  if (phone) {
    return {
      kind: lower.includes('@s.whatsapp.net') ? 'JID_PHONE' : 'PHONE',
      phone,
      last4: phone.slice(-4)
    };
  }

  return { kind: 'OTHER', phone: '', last4 };
}

function normalizeWhatsappNumber(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.toLowerCase().includes('@lid')) return '';
  let number = raw.replace(/\D/g, '');
  if (!number) return '';
  if (number.startsWith('0')) number = '62' + number.slice(1);
  if (!number.startsWith('62')) number = '62' + number;
  return /^62\d{8,15}$/.test(number) ? number : '';
}

function maskWhatsappNumber(value) {
  const number = String(value || '').replace(/\D/g, '');
  if (!number) return '-';
  return '***' + number.slice(-4);
}

function classifyWhatsappCommand(value) {
  const message = String(value || '').trim();
  if (/^ACC\s*$/i.test(message)) return 'ACC';
  if (/^TOLAK_.+/i.test(message)) return 'TOLAK';
  if (/^\d+$/.test(message)) return 'PILIH_UNIT';
  if (/^ACC\s+\S+/i.test(message)) return 'ACC_FULL';
  if (/^TOLAK\s+\S+/i.test(message)) return 'TOLAK_FULL';
  if (/^PILIH\s+/i.test(message)) return 'PILIH_FULL';
  return 'OTHER';
}

function safeSecretEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

async function handleGas(request, env) {
  if (!env.GAS_WEBAPP_URL || !env.GAS_API_SECRET || !env.ADMIN_SESSION_SECRET) {
    return json({ ok: false, error: 'Konfigurasi Worker belum lengkap. Isi GAS_WEBAPP_URL, GAS_API_SECRET, dan ADMIN_SESSION_SECRET.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ ok: false, error: 'Payload JSON tidak valid.' }, 400);
  }

  const action = String(body?.action || '').trim();
  const args = Array.isArray(body?.args) ? body.args : [];
  const requestId = normalizeRequestId(body?.requestId) || createRequestId();
  if (!action || (!PUBLIC_ACTIONS.has(action) && !ADMIN_ACTIONS.has(action))) {
    return json({ ok: false, error: `Action tidak diizinkan: ${action || '-'}` }, 403);
  }

  const adminSession = await hasValidAdminSession(request, env.ADMIN_SESSION_SECRET);
  const adminMaintenance = action === 'simpanPemeliharaan' &&
    args[0] && String(args[0].sumber || '').trim().toLowerCase() === 'administrator';

  if ((ADMIN_ACTIONS.has(action) || adminMaintenance) && !adminSession) {
    return json({
      ok: false,
      code: 'ADMIN_REQUIRED',
      error: 'Sesi Administrator berakhir. Silakan login kembali.',
      requestId
    }, 401);
  }

  const gasPayload = {
    apiKey: env.GAS_API_SECRET,
    action,
    args,
    adminAuthorized: adminSession,
    requestId
  };

  const gasCall = await callAppsScriptJson({
    url: env.GAS_WEBAPP_URL,
    payload: gasPayload,
    action,
    requestId,
    retryable: READ_ONLY_ACTIONS.has(action)
  });

  if (!gasCall.ok) {
    return json({
      ok: false,
      code: gasCall.code,
      error: gasCall.error,
      requestId
    }, 502);
  }

  const result = gasCall.result;

  if (!result || result.ok !== true) {
    // Jika login PIN gagal, hapus kemungkinan cookie lama.
    const headers = action === 'verifikasiPin'
      ? { 'Set-Cookie': `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` }
      : {};
    return json({
      ok: false,
      code: result?.code || 'BACKEND_REJECTED',
      error: result?.error || 'Backend menolak request.',
      requestId: result?.requestId || requestId
    }, 400, headers);
  }

  if (action === 'verifikasiPin') {
    if (result.result !== true) {
      return json({ ok: true, result: false, requestId }, 200, {
        'Set-Cookie': `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
      });
    }

    const token = await createAdminToken(env.ADMIN_SESSION_SECRET);
    return json({ ok: true, result: true, requestId }, 200, {
      // Session cookie: hilang saat sesi browser berakhir.
      'Set-Cookie': `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict`
    });
  }

  return json({ ...result, requestId: result.requestId || requestId });
}


async function callAppsScriptJson({ url, payload, action, requestId, retryable }) {
  const maxAttempts = retryable ? GAS_READ_MAX_ATTEMPTS : 1;
  let lastFailure = 'UNKNOWN';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const delayMs = GAS_RETRY_DELAYS_MS[Math.min(attempt - 1, GAS_RETRY_DELAYS_MS.length - 1)] || 0;
    if (delayMs > 0) await sleep(delayMs);

    let upstream;
    try {
      upstream = await fetch(url, {
        method: 'POST',
        redirect: 'follow',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          'Accept': 'application/json,text/plain;q=0.9,*/*;q=0.1',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      lastFailure = 'NETWORK_' + safeError(err);
      console.warn(`[SIMANTAP][${requestId}] GAS network error action=${action} attempt=${attempt}/${maxAttempts}: ${safeError(err)}`);
      if (attempt < maxAttempts) continue;

      return {
        ok: false,
        code: retryable ? 'BACKEND_TEMPORARY_UNAVAILABLE' : 'BACKEND_CONNECTION_FAILED',
        error: retryable
          ? 'Gangguan sementara saat membaca data. Silakan tekan Refresh.'
          : 'Tidak dapat memastikan respons backend. Silakan cek riwayat sebelum mengirim ulang agar tidak terjadi transaksi ganda.'
      };
    }

    const raw = await upstream.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      const contentType = String(upstream.headers.get('content-type') || '-').slice(0, 120);
      lastFailure = `NON_JSON_HTTP_${upstream.status}`;
      console.warn(`[SIMANTAP][${requestId}] GAS non-JSON action=${action} attempt=${attempt}/${maxAttempts} status=${upstream.status} type=${contentType} length=${raw.length}`);

      // Hanya request baca yang aman dicoba ulang. Request tulis sengaja berhenti
      // di sini karena backend mungkin sebenarnya sudah menyimpan data sebelum
      // respons upstream terputus/berubah menjadi HTML.
      if (attempt < maxAttempts) continue;

      return {
        ok: false,
        code: retryable ? 'BACKEND_TEMPORARY_UNAVAILABLE' : 'BACKEND_RESPONSE_UNCERTAIN',
        error: retryable
          ? 'Gangguan sementara saat membaca data. Sistem sudah mencoba ulang otomatis. Silakan tekan Refresh jika data belum tampil.'
          : 'Respons backend tidak dapat dipastikan. Untuk mencegah transaksi ganda, permintaan tidak diulang otomatis. Silakan cek riwayat terlebih dahulu.'
      };
    }

    return { ok: true, result: parsed };
  }

  console.warn(`[SIMANTAP][${requestId}] GAS exhausted retries action=${action} reason=${lastFailure}`);
  return {
    ok: false,
    code: 'BACKEND_TEMPORARY_UNAVAILABLE',
    error: 'Gangguan sementara saat membaca data. Silakan tekan Refresh.'
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createRequestId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `REQ-${Date.now().toString(36).toUpperCase()}-${hex.toUpperCase()}`;
}

function normalizeRequestId(value) {
  const id = String(value || '').trim();
  if (!id || id.length > 80) return '';
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) return '';
  return id;
}

async function createAdminToken(secret) {
  const payload = {
    role: 'administrator',
    exp: Date.now() + 8 * 60 * 60 * 1000
  };
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await hmacSign(body, secret);
  return `${body}.${base64UrlEncode(signature)}`;
}

async function hasValidAdminSession(request, secret) {
  try {
    const token = readCookie(request.headers.get('Cookie') || '', ADMIN_COOKIE);
    if (!token) return false;
    const [body, signatureText] = token.split('.');
    if (!body || !signatureText) return false;

    const signature = base64UrlDecode(signatureText);
    const valid = await hmacVerify(body, signature, secret);
    if (!valid) return false;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
    return payload?.role === 'administrator' && Number(payload.exp || 0) > Date.now();
  } catch (_) {
    return false;
  }
}

async function hmacKey(secret, usage) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usage
  );
}

async function hmacSign(value, secret) {
  const key = await hmacKey(secret, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

async function hmacVerify(value, signature, secret) {
  const key = await hmacKey(secret, ['verify']);
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(value));
}

function readCookie(cookieHeader, name) {
  const prefix = `${name}=`;
  const part = cookieHeader.split(';').map(v => v.trim()).find(v => v.startsWith(prefix));
  return part ? part.slice(prefix.length) : '';
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      ...extraHeaders
    }
  });
}

function safeError(err) {
  return String(err?.message || err || 'Unknown error').replace(/\s+/g, ' ').trim();
}
