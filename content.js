// content.js — injetado em todas as páginas no document_start

console.log("PRIVACY MONITOR: content script carregado em", location.href);

// ─── Fingerprinting ──────────────────────────────────────────────────────────
// O sandbox do Firefox isola o window do content script do window da página.
// A solução é injetar o patch via <script> tag para rodar no contexto real da página,
// e usar CustomEvent para passar os dados de volta ao content script.

function injectPageScript() {
  const script = document.createElement("script");
  script.textContent = `
    (function() {
      const report = (technique, detail) => {
        window.dispatchEvent(new CustomEvent("__pmFingerprint", {
          detail: { technique, detail, url: location.href }
        }));
      };

      // Canvas
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (...args) {
        report("canvas", "toDataURL");
        return origToDataURL.apply(this, args);
      };

      const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function (...args) {
        report("canvas", "getImageData");
        return origGetImageData.apply(this, args);
      };

      // WebGL
      const origGetParam = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (param) {
        if (param === 37445 || param === 37446) {
          report("webgl", "getParameter(" + param + ")");
        }
        return origGetParam.apply(this, arguments);
      };

      // AudioContext
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        const origOsc = AC.prototype.createOscillator;
        AC.prototype.createOscillator = function (...args) {
          report("audio", "createOscillator");
          return origOsc.apply(this, args);
        };
        const origDyn = AC.prototype.createDynamicsCompressor;
        AC.prototype.createDynamicsCompressor = function (...args) {
          report("audio", "createDynamicsCompressor");
          return origDyn.apply(this, args);
        };
      }
    })();
  `;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

injectPageScript();

// Recebe os eventos da página e repassa para o background
window.addEventListener("__pmFingerprint", function (e) {
  browser.runtime.sendMessage({
    type: "FINGERPRINT_DETECTED",
    payload: e.detail
  });
});

// ─── Web Storage ─────────────────────────────────────────────────────────────

function collectStorage() {
  const result = { local: [], session: [], indexedDB: [] };

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key   = localStorage.key(i);
      const value = localStorage.getItem(key) || "";
      result.local.push({ key, size: new Blob([value]).size, domain: location.hostname });
    }
  } catch (e) {}

  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key   = sessionStorage.key(i);
      const value = sessionStorage.getItem(key) || "";
      result.session.push({ key, size: new Blob([value]).size, domain: location.hostname });
    }
  } catch (e) {}

  // IndexedDB — nem todos os contextos suportam .databases()
  try {
    if (typeof indexedDB !== "undefined" && indexedDB.databases) {
      indexedDB.databases().then(dbs => {
        result.indexedDB = dbs.map(db => ({ name: db.name, domain: location.hostname }));
        browser.runtime.sendMessage({ type: "STORAGE_DATA", payload: result });
      }).catch(() => {
        browser.runtime.sendMessage({ type: "STORAGE_DATA", payload: result });
      });
    } else {
      browser.runtime.sendMessage({ type: "STORAGE_DATA", payload: result });
    }
  } catch (e) {
    browser.runtime.sendMessage({ type: "STORAGE_DATA", payload: result });
  }
}

// ─── Supercookies ────────────────────────────────────────────────────────────

function looksLikeTrackingId(str) {
  if (!str || str.length < 20) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) return true;
  if (/^[0-9a-f]{20,}$/i.test(str)) return true;
  if (/^[A-Za-z0-9_\-]{32,}$/.test(str)) return true;
  return false;
}

function detectSupercookies() {
  // localStorage: heurística de alta entropia nos valores
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key) || "";
      if (looksLikeTrackingId(val)) {
        browser.runtime.sendMessage({ type: "SUPERCOOKIE_DETECTED",
          payload: { technique: "localStorage", key, detail: val.slice(0, 40) } });
      }
    }
  } catch (e) {}

  // IndexedDB: nomes de banco com alta entropia
  try {
    if (typeof indexedDB !== "undefined" && indexedDB.databases) {
      indexedDB.databases().then(dbs => {
        for (const db of dbs) {
          if (looksLikeTrackingId(db.name)) {
            browser.runtime.sendMessage({ type: "SUPERCOOKIE_DETECTED",
              payload: { technique: "indexedDB", key: db.name, detail: location.hostname } });
          }
        }
      }).catch(() => {});
    }
  } catch (e) {}

  // Cache API: qualquer cache registrado
  if ("caches" in self) {
    caches.keys().then(names => {
      for (const name of names) {
        browser.runtime.sendMessage({ type: "SUPERCOOKIE_DETECTED",
          payload: { technique: "cacheAPI", key: name, detail: location.hostname } });
      }
    }).catch(() => {});
  }

  // Service Worker: qualquer registro ativo
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      for (const reg of regs) {
        browser.runtime.sendMessage({ type: "SUPERCOOKIE_DETECTED",
          payload: { technique: "serviceWorker", key: reg.scope, detail: location.hostname } });
      }
    }).catch(() => {});
  }
}

// Coleta storage e detecta supercookies após carregamento completo
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { collectStorage(); detectSupercookies(); });
} else {
  collectStorage();
  detectSupercookies();
}
