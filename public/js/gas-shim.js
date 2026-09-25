// Compatibility layer: emulates google.script.run on Cloudflare Workers.
// Existing SIMANTAP frontend can stay almost unchanged while requests are sent
// to the same-origin /api/gas Worker endpoint.
(() => {
  async function callGas(action, args) {
    const response = await fetch('/api/gas', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, args })
    });

    let payload;
    try {
      payload = await response.json();
    } catch (_) {
      throw new Error('Respons API SIMANTAP tidak valid. Periksa konfigurasi Worker dan Apps Script.');
    }

    if (!response.ok || !payload || payload.ok !== true) {
      throw new Error((payload && payload.error) || `API gagal (${response.status}).`);
    }
    return payload.result;
  }

  function makeRunner(successHandler, failureHandler) {
    return new Proxy({}, {
      get(_target, prop) {
        if (prop === 'withSuccessHandler') {
          return (fn) => makeRunner(fn, failureHandler);
        }
        if (prop === 'withFailureHandler') {
          return (fn) => makeRunner(successHandler, fn);
        }
        if (prop === 'withUserObject') {
          // Tidak dipakai SIMANTAP saat ini; dipertahankan agar kompatibel.
          return () => makeRunner(successHandler, failureHandler);
        }
        return (...args) => {
          callGas(String(prop), args)
            .then((result) => {
              if (typeof successHandler === 'function') successHandler(result);
            })
            .catch((err) => {
              if (typeof failureHandler === 'function') failureHandler(err);
              else console.error(err);
            });
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = makeRunner();
})();
