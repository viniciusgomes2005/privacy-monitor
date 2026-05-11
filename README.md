Extensão validada em ambiente controlado

# Privacy Monitor

Extensão Firefox para detecção e análise de práticas de rastreamento durante a navegação. Monitora requisições de terceiros, cookies, fingerprinting, supercookies, cookie syncing e comportamentos suspeitos em tempo real, exibindo um Privacy Score para a página ativa.

---

## Funcionalidades

- **Terceiros**: detecta e classifica domínios de terceiros (analytics, ads, social, CDN) com contagem de requisições por domínio
- **Cookies**: analisa atributos de segurança (`Secure`, `HttpOnly`, `SameSite`), persistência e origem (1st/3rd party)
- **Fingerprinting**: intercepta Canvas API (`toDataURL`, `getImageData`), WebGL (`getParameter`), AudioContext e Navigator para detectar coleta de impressão digital
- **Supercookies**: detecta identificadores persistentes em `localStorage` (heurística de alta entropia: UUID, hex ≥ 20 chars, alfanumérico ≥ 32 chars), nomes de banco IndexedDB suspeitos, entradas na Cache API e registros de Service Worker
- **Cookie Syncing**: identifica parâmetros de ID de usuário em URLs de terceiros
- **Hijacking**: detecta scripts suspeitos e redirecionamentos cross-domain não autorizados
- **Privacy Score**: pontuação de 0 a 100 com breakdown detalhado por categoria

---

## Instalação via about:debugging

1. Abra o Firefox e acesse `about:debugging#/runtime/this-firefox`
2. Clique em **"Carregar extensão temporária..."**
3. Navegue até a pasta do projeto e selecione o arquivo `manifest.json`
4. A extensão será carregada e o ícone aparecerá na barra de ferramentas

> A extensão temporária é removida ao fechar o Firefox. Para uso persistente, assine a extensão via [addons.mozilla.org](https://addons.mozilla.org).

---

## Como usar

1. Navegue para qualquer página web
2. Aguarde o carregamento completo (3-5 segundos para coleta de cookies)
3. Clique no ícone **Privacy Monitor** na barra de ferramentas
4. O popup exibe o Privacy Score e as seções de detalhes
5. Clique em **↻** para atualizar os dados sem recarregar a página
6. Clique nos cabeçalhos de cada seção para expandir/recolher os detalhes

---

## Metodologia do Privacy Score

O score é calculado a partir de 100 pontos, com penalizações por categoria e bônus para boas práticas. A fórmula final é:

```
final = max(0, min(100, 100 + Σ ajustes))
```

### Penalizações por categoria

| Categoria | Penalização por item | Cap máximo |
|---|---|---|
| Terceiros | analytics −8, ads −10, social −5, CDN −1, desconhecido −3 | −35 |
| Cookies | 3rd party −4, persistente −2, sem Secure −1, sem HttpOnly −1, sem SameSite −2 | −25 |
| Fingerprinting | canvas −15, webgl −15, audio −12, navigator −5 (dedup por técnica) | −20 |
| Supercookies | −20 por item detectado | −40 |
| Comportamentos críticos | cookie syncing −20/domínio, redirect −30, script suspeito −25 | −50 |
| **Soma máxima** | | **−100** |

### Bônus

| Condição | Bônus |
|---|---|
| Zero requisições de terceiros | +10 |
| Menos de 5 domínios terceiros únicos | +5 |
| Zero fingerprinting detectado | +10 |
| Todos os cookies com Secure + HttpOnly + SameSite=strict | +5 |

### Classificação

| Score | Classificação |
|---|---|
| 85 – 100 | 🟢 Excelente |
| 65 – 84 | 🟡 Boa |
| 40 – 64 | 🟠 Comprometida |
| 0 – 39 | 🔴 Alto Risco |

---

## Arquitetura

```
manifest.json          — configuração da extensão (MV2)
privacy_monitor.js     — estado global compartilhado (background)
background.js          — interceptação de rede, cookies, hijacking, cookie syncing
content.js             — fingerprinting (via page script injection), storage, supercookies
popup.html / popup.css — interface do usuário
popup.js               — cálculo do score, renderização das seções
```

---

## Tecnologias

- WebExtensions API (Firefox, Manifest V2)
- `browser.webRequest` para interceptação de rede
- `browser.webNavigation` para reset de estado por página
- `browser.cookies` para leitura de cookies
- Injeção de script via `<script>` tag para contornar o sandbox do content script no Firefox
- `CustomEvent` para comunicação entre page context e content script
