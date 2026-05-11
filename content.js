// content.js — injetado em todas as páginas no document_start

// ─── Fingerprinting ──────────────────────────────────────────────────────────

(function patchFingerprinting() {
  const report = (method, detail) => {
    try {
      browser.runtime.sendMessage({ type: "FINGERPRINT", payload: { method, detail, url: location.href } });
    } catch (e) {}
  };

  // Canvas 2D
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...args) {
    report("canvas.toDataURL", { width: this.width, height: this.height });
    return origToDataURL.apply(this, args);
  };

  const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function (...args) {
    report("canvas.getImageData", {});
    return origGetImageData.apply(this, args);
  };

  // WebGL
  const origGetParam = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function (param) {
    if ([37445, 37446].includes(param)) {
      report("webgl.getParameter", { param });
    }
    return origGetParam.apply(this, arguments);
  };

  // AudioContext fingerprinting
  if (typeof AudioBuffer !== "undefined") {
    const origCopyFromChannel = AudioBuffer.prototype.copyFromChannel;
    AudioBuffer.prototype.copyFromChannel = function (...args) {
      report("audioContext.copyFromChannel", {});
      return origCopyFromChannel.apply(this, args);
    };
  }

  // navigator properties comuns em fingerprinting
  const NAV_PROPS = ["hardwareConcurrency", "deviceMemory", "languages", "platform"];
  NAV_PROPS.forEach(prop => {
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, prop);
    if (!desc || !desc.get) return;
    const orig = desc.get;
    Object.defineProperty(Navigator.prototype, prop, {
      get() {
        report(`navigator.${prop}`, {});
        return orig.call(this);
      },
      configurable: true
    });
  });
})();

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
