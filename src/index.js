const PUBLIC_ACTIONS = new Set([
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'SIMANTAP BMN Worker', backendConfigured: Boolean(env.GAS_WEBAPP_URL && env.GAS_API_SECRET) });
    }

    if (url.pathname === '/api/logout' && request.method === 'POST') {
      return json({ ok: true }, 200, {
        'Set-Cookie': `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
      });
    }

    if (url.pathname === '/api/gas') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method tidak diizinkan.' }, 405);
      return handleGas(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};

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
  if (!action || (!PUBLIC_ACTIONS.has(action) && !ADMIN_ACTIONS.has(action))) {
    return json({ ok: false, error: `Action tidak diizinkan: ${action || '-'}` }, 403);
  }

  const adminSession = await hasValidAdminSession(request, env.ADMIN_SESSION_SECRET);
  const adminMaintenance = action === 'simpanPemeliharaan' &&
    args[0] && String(args[0].sumber || '').trim().toLowerCase() === 'administrator';

  if ((ADMIN_ACTIONS.has(action) || adminMaintenance) && !adminSession) {
    return json({ ok: false, error: 'Sesi Administrator berakhir. Silakan login kembali.' }, 401);
  }

  const gasPayload = {
    apiKey: env.GAS_API_SECRET,
    action,
    args,
    adminAuthorized: adminSession
  };

  let upstream;
  try {
    upstream = await fetch(env.GAS_WEBAPP_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(gasPayload)
    });
  } catch (err) {
    return json({ ok: false, error: 'Tidak dapat menghubungi backend Apps Script: ' + safeError(err) }, 502);
  }

  const raw = await upstream.text();
  let result;
  try {
    result = JSON.parse(raw);
  } catch (_) {
    return json({
      ok: false,
      error: 'Backend Apps Script tidak mengembalikan JSON. Pastikan Web App sudah dideploy dengan akses yang dapat dipanggil Worker.'
    }, 502);
  }

  if (!result || result.ok !== true) {
    // Jika login PIN gagal, hapus kemungkinan cookie lama.
    const headers = action === 'verifikasiPin'
      ? { 'Set-Cookie': `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` }
      : {};
    return json({ ok: false, error: result?.error || 'Backend menolak request.' }, 400, headers);
  }

  if (action === 'verifikasiPin') {
    if (result.result !== true) {
      return json({ ok: true, result: false }, 200, {
        'Set-Cookie': `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
      });
    }

    const token = await createAdminToken(env.ADMIN_SESSION_SECRET);
    return json({ ok: true, result: true }, 200, {
      // Session cookie: hilang saat sesi browser berakhir.
      'Set-Cookie': `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict`
    });
  }

  return json(result);
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
      ...extraHeaders
    }
  });
}

function safeError(err) {
  return String(err?.message || err || 'Unknown error').replace(/\s+/g, ' ').trim();
}
