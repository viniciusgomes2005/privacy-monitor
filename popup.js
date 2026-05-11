// popup.js

// ─── Score ────────────────────────────────────────────────────────────────────

const TRACKER_DOMAINS = {
  analytics: ["google-analytics.com", "hotjar.com", "clarity.ms", "scorecardresearch.com"],
  ads:       ["doubleclick.net", "adnxs.com", "amazon-adsystem.com", "googlesyndication.com"],
  social:    ["facebook.net", "accounts.google.com"],
  cdn:       ["cloudflare.com", "jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com"],
};

function classifyDomain(domain) {
  for (const [cat, list] of Object.entries(TRACKER_DOMAINS)) {
    if (list.some(d => domain.includes(d))) return cat;
  }
  return "unknown";
}

function calculatePrivacyScore(state) {
  let score = 100;
  const breakdown = { thirds: 0, cookies: 0, fingerprinting: 0, critical: 0, bonus: 0 };

  // Terceiros (cap -35)
  const seenDomains = new Set();
  for (const req of state.thirdPartyRequests || []) {
    if (seenDomains.has(req.domain)) continue;
    seenDomains.add(req.domain);
    const cat = classifyDomain(req.domain);
    const pen = { analytics: 8, ads: 10, social: 5, cdn: 1, unknown: 3 }[cat];
    breakdown.thirds = Math.min(35, breakdown.thirds + pen);
  }

  // Cookies (cap -25)
  const now = Date.now() / 1000;
  for (const c of state.cookies || []) {
    let pen = 0;
    if (!c.isFirstParty) pen += 4;
    if (!c.isSession && c.expirationDate && (c.expirationDate - now) > 30 * 86400) pen += 2;
    if (!c.httpOnly)  pen += 1;
    if (!c.secure)    pen += 1;
    if (!c.sameSite || c.sameSite === "no_restriction") pen += 2;
    breakdown.cookies = Math.min(25, breakdown.cookies + pen);
  }

  // Fingerprinting (cap -30)
  const fpSeen = new Set();
  for (const fp of state.fingerprinting || []) {
    const key = fp.technique;
    if (fpSeen.has(key)) continue;
    fpSeen.add(key);
    const pen = { canvas: 15, webgl: 15, audio: 12, navigator: 5 }[fp.technique] ?? 5;
    breakdown.fingerprinting = Math.min(30, breakdown.fingerprinting + pen);
  }

  // Comportamentos críticos (sem cap)
  const syncDomains = new Set((state.cookieSyncing || []).map(s => s.domain));
  breakdown.critical += syncDomains.size * 20;

  for (const h of state.hijacking || []) {
    breakdown.critical += h.type === "redirect" ? 30 : 25;
  }

  // Aplica penalizações
  score -= breakdown.thirds + breakdown.cookies + breakdown.fingerprinting + breakdown.critical;

  // Bônus
  const thirdPartyReqs = state.thirdPartyRequests || [];

  if (thirdPartyReqs.length === 0) { breakdown.bonus += 10; score += 10; }

  const uniqueThirdDomains = new Set(thirdPartyReqs.map(r => r.domain));
  if (uniqueThirdDomains.size < 5) { breakdown.bonus += 5; score += 5; }

  const fp = state.fingerprinting || [];
  if (fp.length === 0) { breakdown.bonus += 10; score += 10; }

  const cookies = state.cookies || [];
  const allSecure = cookies.length > 0 && cookies.every(c =>
    c.httpOnly && c.secure && c.sameSite === "strict"
  );
  if (allSecure) { breakdown.bonus += 5; score += 5; }

  score = Math.max(0, Math.min(100, score));
  return { score, breakdown };
}

function scoreClass(score) {
  if (score >= 85) return { cls: "score-green",  emoji: "🟢", label: "Excelente" };
  if (score >= 65) return { cls: "score-yellow", emoji: "🟡", label: "Boa" };
  if (score >= 40) return { cls: "score-orange", emoji: "🟠", label: "Comprometida" };
  return               { cls: "score-red",    emoji: "🔴", label: "Alto Risco" };
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render(state) {
  const { score } = calculatePrivacyScore(state);
  const { cls, emoji, label } = scoreClass(score);

  document.getElementById("current-domain").textContent = state.currentDomain || "desconhecido";

  const numEl  = document.getElementById("score-number");
  const ringEl = document.getElementById("score-ring");
  const labelEl = document.getElementById("score-label");
  const barEl  = document.getElementById("score-bar");

  numEl.textContent = score;
  numEl.className = cls;
  ringEl.style.borderColor = getComputedStyle(document.documentElement)
    .getPropertyValue(cls === "score-green" ? "--green" : cls === "score-yellow" ? "--yellow" : cls === "score-orange" ? "--orange" : "--red").trim();
  labelEl.textContent = `${emoji} ${label}`;
  labelEl.className = cls;

  const colorMap = { "score-green": "#22c55e", "score-yellow": "#eab308", "score-orange": "#f97316", "score-red": "#ef4444" };
  barEl.style.background = colorMap[cls];
  requestAnimationFrame(() => { barEl.style.width = score + "%"; });

  const sectionsEl = document.getElementById("sections");
  sectionsEl.innerHTML = "";

  sectionsEl.appendChild(renderThirds(state.thirdPartyRequests || []));
  sectionsEl.appendChild(renderCookies(state.cookies || []));
  sectionsEl.appendChild(renderFingerprinting(state.fingerprinting || []));
  sectionsEl.appendChild(renderStorage(state.storage || {}));
  sectionsEl.appendChild(renderHijacking(state.hijacking || []));
  sectionsEl.appendChild(renderCookieSyncing(state.cookieSyncing || []));
}

function makeSection(icon, title, count, bodyEl, forceOpen) {
  const section = document.createElement("div");
  section.className = "section";

  const badgeClass = count === 0 ? "" : count > 5 ? "badge-danger" : "badge-warn";
  const header = document.createElement("div");
  header.className = "section-header";
  header.innerHTML = `
    <div class="section-title">
      <span class="section-icon">${icon}</span>
      ${title}
      <span class="badge ${badgeClass}">${count}</span>
    </div>
    <span class="chevron ${forceOpen ? "open" : ""}">▼</span>
  `;

  bodyEl.className = "section-body" + (forceOpen ? " open" : "");

  header.addEventListener("click", () => {
    const open = bodyEl.classList.toggle("open");
    header.querySelector(".chevron").classList.toggle("open", open);
  });

  section.appendChild(header);
  section.appendChild(bodyEl);
  return section;
}

function renderThirds(reqs) {
  const body = document.createElement("div");
  const grouped = {};
  for (const r of reqs) {
    if (!grouped[r.domain]) grouped[r.domain] = { ...r, count: 0, types: new Set() };
    grouped[r.domain].count++;
    grouped[r.domain].types.add(r.type);
  }
  const entries = Object.values(grouped).sort((a, b) => b.count - a.count);

  if (entries.length === 0) {
    body.innerHTML = '<p class="empty">Nenhuma requisição de terceiros</p>';
  } else {
    const list = document.createElement("div");
    list.className = "item-list";
    for (const e of entries) {
      const cat = classifyDomain(e.domain);
      const tagCls = { analytics: "tag-tracker", ads: "tag-ads", social: "tag-social", cdn: "tag-cdn", unknown: "" }[cat];
      const tagLabel = { analytics: "tracker", ads: "ads", social: "social", cdn: "cdn", unknown: "3rd" }[cat];
      list.innerHTML += `
        <div class="item">
          <div>
            <div class="item-domain">${e.domain}</div>
            <div class="item-meta">${e.count} req · ${[...e.types].join(", ")}</div>
          </div>
          <div class="item-tags">
            <span class="tag ${tagCls}">${tagLabel}</span>
            ${e.isKnownTracker ? '<span class="tag tag-tracker">known</span>' : ""}
          </div>
        </div>`;
    }
    body.appendChild(list);
  }
  return makeSection("🌐", "Terceiros", entries.length, body, entries.length > 0);
}

function renderCookies(cookies) {
  const body = document.createElement("div");
  if (cookies.length === 0) {
    body.innerHTML = '<p class="empty">Nenhum cookie detectado</p>';
  } else {
    const list = document.createElement("div");
    list.className = "item-list";
    const now = Date.now() / 1000;
    for (const c of cookies) {
      const days = c.expirationDate ? Math.round((c.expirationDate - now) / 86400) : null;
      const persistent = !c.isSession && days !== null && days > 30;
      list.innerHTML += `
        <div class="item">
          <div>
            <div class="item-domain">${c.name} <span class="item-meta">${c.domain}</span></div>
            <div class="item-meta">${days !== null ? `expira em ${days}d` : "sessão"}</div>
          </div>
          <div class="item-tags">
            <span class="tag ${c.isFirstParty ? "tag-ok" : "tag-tracker"}">${c.isFirstParty ? "1st" : "3rd"}</span>
            ${c.secure   ? "" : '<span class="tag tag-warn">!secure</span>'}
            ${c.httpOnly ? "" : '<span class="tag tag-warn">!httpOnly</span>'}
            ${!c.sameSite || c.sameSite === "no_restriction" ? '<span class="tag tag-warn">!samesite</span>' : ""}
            ${persistent ? '<span class="tag tag-warn">persist</span>' : ""}
          </div>
        </div>`;
    }
    body.appendChild(list);
  }
  return makeSection("🍪", "Cookies", cookies.length, body);
}

function renderFingerprinting(fps) {
  const body = document.createElement("div");
  if (fps.length === 0) {
    body.innerHTML = '<p class="empty">Nenhum fingerprinting detectado</p>';
  } else {
    const list = document.createElement("div");
    list.className = "item-list";
    const tagMap = { canvas: "tag-canvas", webgl: "tag-webgl", audio: "tag-audio" };
    for (const fp of fps) {
      list.innerHTML += `
        <div class="item">
          <div>
            <div class="item-domain">${fp.technique}</div>
            <div class="item-meta">${fp.detail || ""}</div>
          </div>
          <div class="item-tags">
            <span class="tag ${tagMap[fp.technique] || "tag-warn"}">${fp.technique}</span>
          </div>
        </div>`;
    }
    body.appendChild(list);
  }
  return makeSection("👁", "Fingerprinting", fps.length, body, fps.length > 0);
}

function renderStorage(storage) {
  const local   = (storage.local   || []);
  const session = (storage.session || []);
  const idb     = (storage.indexedDB || []);
  const total   = local.length + session.length + idb.length;
  const body    = document.createElement("div");

  if (total === 0) {
    body.innerHTML = '<p class="empty">Nenhum dado em storage</p>';
  } else {
    const list = document.createElement("div");
    list.className = "item-list";
    for (const e of local) {
      list.innerHTML += `<div class="item"><div><div class="item-domain">${e.key}</div><div class="item-meta">localStorage · ${e.size}b</div></div><div class="item-tags"><span class="tag tag-warn">local</span></div></div>`;
    }
    for (const e of session) {
      list.innerHTML += `<div class="item"><div><div class="item-domain">${e.key}</div><div class="item-meta">sessionStorage · ${e.size}b</div></div><div class="item-tags"><span class="tag tag-cdn">session</span></div></div>`;
    }
    for (const e of idb) {
      list.innerHTML += `<div class="item"><div><div class="item-domain">${e.name}</div><div class="item-meta">IndexedDB</div></div><div class="item-tags"><span class="tag tag-cdn">idb</span></div></div>`;
    }
    body.appendChild(list);
  }
  return makeSection("💾", "Web Storage", total, body);
}

function renderHijacking(items) {
  const body = document.createElement("div");
  if (items.length === 0) {
    body.innerHTML = '<p class="empty">Nenhuma ameaça detectada</p>';
  } else {
    const list = document.createElement("div");
    list.className = "item-list";
    for (const h of items) {
      const label = h.type === "redirect" ? "redirect" : "script";
      const url   = h.url || h.from || "";
      list.innerHTML += `
        <div class="item">
          <div>
            <div class="item-domain" style="word-break:break-all;font-size:10px">${url.slice(0, 60)}${url.length > 60 ? "…" : ""}</div>
            ${h.to ? `<div class="item-meta">→ ${h.to.slice(0, 50)}</div>` : ""}
          </div>
          <div class="item-tags">
            <span class="tag tag-danger">${label}</span>
          </div>
        </div>`;
    }
    body.appendChild(list);
  }
  return makeSection("⚠️", "Hijacking", items.length, body, items.length > 0);
}

function renderCookieSyncing(syncs) {
  const body = document.createElement("div");
  if (syncs.length === 0) {
    body.innerHTML = '<p class="empty">Nenhum cookie syncing detectado</p>';
  } else {
    const list = document.createElement("div");
    list.className = "item-list";
    for (const s of syncs) {
      list.innerHTML += `
        <div class="item">
          <div>
            <div class="item-domain">${s.domain}</div>
            <div class="item-meta">${s.param}=${s.value.slice(0, 16)}…</div>
          </div>
          <div class="item-tags"><span class="tag tag-danger">sync</span></div>
        </div>`;
    }
    body.appendChild(list);
  }
  return makeSection("🔗", "Cookie Syncing", syncs.length, body, syncs.length > 0);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

let retryCount = 0;

function showWaiting(msg) {
  document.getElementById("score-number").textContent = "…";
  document.getElementById("current-domain").textContent = "—";
  document.getElementById("score-label").textContent = msg;
  document.getElementById("sections").innerHTML = "";
}

function load() {
  browser.runtime.sendMessage({ type: "GET_STATE" }).then(state => {
    const noData = !state || state.currentDomain === null || (state.thirdPartyRequests || []).length === 0;
    if (noData) {
      if (retryCount < 5) {
        retryCount++;
        showWaiting("Aguardando dados da página...");
        setTimeout(load, 2000);
        return;
      }
      retryCount = 0;
      if (state && state.currentDomain !== null) {
        render(state);
        return;
      }
      showWaiting("Navegue para uma página para analisar.");
      return;
    }
    retryCount = 0;
    render(state);
  }).catch(() => {
    document.getElementById("score-number").textContent = "!";
    document.getElementById("score-label").textContent = "Erro ao carregar estado";
  });
}

document.getElementById("btn-refresh").addEventListener("click", () => {
  retryCount = 0;
  load();
});

load();
