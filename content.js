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

// Coleta storage após carregamento completo
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", collectStorage);
} else {
  collectStorage();
}
