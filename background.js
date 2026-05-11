// background.js — interceptação de rede, cookies e detecção de ameaças

const SUSPICIOUS_PATTERNS = [
  /xss/i, /beef/i, /hook\.js/i, /payload/i, /exploit/i,
  /eval\(/i, /document\.write/i
];

const KNOWN_TRACKERS = [
  "google-analytics.com", "doubleclick.net", "facebook.net",
  "scorecardresearch.com", "adnxs.com", "amazon-adsystem.com",
  "googlesyndication.com", "hotjar.com", "clarity.ms"
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractDomain(url) {
  try { return new URL(url).hostname; }
  catch { return null; }
}

function getRootDomain(hostname) {
  if (!hostname) return null;
  const parts = hostname.split(".");
  return parts.length >= 2 ? parts.slice(-2).join(".") : hostname;
}

function isThirdParty(requestDomain, pageDomain) {
  return getRootDomain(requestDomain) !== getRootDomain(pageDomain);
}

// ─── Interceptação de requisições ───────────────────────────────────────────

browser.webRequest.onBeforeRequest.addListener(
  function (details) {
    const tabId = details.tabId;
    if (tabId < 0) return;

    browser.tabs.get(tabId).then(tab => {
      const pageDomain = extractDomain(tab.url);
      const reqDomain  = extractDomain(details.url);
      if (!pageDomain || !reqDomain) return;

      // Terceira parte
      if (isThirdParty(reqDomain, pageDomain)) {
        privacyState.thirdPartyRequests.push({
          domain: reqDomain,
          type:   details.type,
          url:    details.url,
          isKnownTracker: KNOWN_TRACKERS.some(t => reqDomain.includes(t)),
          timestamp: Date.now()
        });
      }

      // Detecção de hijacking: scripts externos com padrões suspeitos
      if (details.type === "script") {
        const isSuspicious = SUSPICIOUS_PATTERNS.some(p => p.test(details.url));
        if (isSuspicious) {
          privacyState.hijacking.push({
            type: "suspicious_script",
            url:  details.url,
            domain: reqDomain
          });
        }
      }

      // Cookie syncing: parâmetros de ID em URLs de terceiros
      detectCookieSyncing(details.url, reqDomain, pageDomain);

    }).catch(() => {});
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

// Detecta redirecionamentos não autorizados
browser.webRequest.onBeforeRedirect.addListener(
  function (details) {
    const from = extractDomain(details.url);
    const to   = extractDomain(details.redirectUrl);
    if (from && to && getRootDomain(from) !== getRootDomain(to)) {
      privacyState.hijacking.push({
        type: "redirect",
        from: details.url,
        to:   details.redirectUrl
      });
    }
  },
  { urls: ["<all_urls>"] }
);

// ─── Cookie Syncing ──────────────────────────────────────────────────────────
// Heurística: URL de terceiro com parâmetros que parecem IDs de usuário
// (strings longas hexadecimais ou UUID-like em query params)

const ID_PARAM_REGEX = /[?&](uid|uuid|id|user_id|sync|cid|pid|visitor)=([a-f0-9\-]{8,})/i;

function detectCookieSyncing(url, reqDomain, pageDomain) {
  if (!isThirdParty(reqDomain, pageDomain)) return;
  const match = ID_PARAM_REGEX.exec(url);
  if (match) {
    privacyState.cookieSyncing.push({
      domain: reqDomain,
      param:  match[1],
      value:  match[2],
      url:    url
    });
  }
}

// ─── Cookies ─────────────────────────────────────────────────────────────────

browser.webNavigation.onCommitted.addListener(function (details) {
  if (details.frameId !== 0) return;

  privacyState.thirdPartyRequests = [];
  privacyState.cookies            = [];
  privacyState.fingerprinting     = [];
  privacyState.storage            = [];
  privacyState.hijacking          = [];
  privacyState.cookieSyncing      = [];
  privacyState.currentDomain      = extractDomain(details.url);

  // Lê cookies com pequeno delay para dar tempo da página setar os cookies
  setTimeout(() => {
    browser.tabs.get(details.tabId).then(tab => {
      if (!tab.url?.startsWith("http")) return;
      const pageRootDomain = getRootDomain(extractDomain(tab.url));
      browser.cookies.getAll({ url: tab.url }).then(cookies => {
        privacyState.cookies = cookies.map(c => {
          const cookieDomain = c.domain.replace(/^\./, "");
          return {
            name:         c.name,
            domain:       c.domain,
            isSession:    c.session,
            isFirstParty: getRootDomain(cookieDomain) === pageRootDomain,
            secure:       c.secure,
            httpOnly:     c.httpOnly,
            sameSite:     c.sameSite,
            expirationDate: c.expirationDate
          };
        });
      });
    });
  }, 3000);
});

// ─── Mensagens do popup ───────────────────────────────────────────────────────

browser.runtime.onMessage.addListener(function (msg) {
  if (msg.type === "GET_STATE") {
    return Promise.resolve(privacyState);
  }

  if (msg.type === "FINGERPRINT_DETECTED") {
    const already = privacyState.fingerprinting
      .some(f => f.technique === msg.payload.technique && f.detail === msg.payload.detail);
    if (!already) {
      privacyState.fingerprinting.push(msg.payload);
    }
  }

  if (msg.type === "STORAGE_DATA") {
    privacyState.storage = msg.payload;
  }
});
