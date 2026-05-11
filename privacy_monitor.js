// privacy_monitor.js — script principal, inicializa o estado global da extensão

const state = {
  thirdPartyRequests: [],   // conexões a domínios externos
  cookies: [],              // cookies detectados
  fingerprinting: [],       // tentativas de fingerprinting
  storage: [],              // dados em localStorage/sessionStorage/IndexedDB
  hijacking: [],            // scripts suspeitos / redirecionamentos
  cookieSyncing: [],        // tentativas de cookie syncing
  currentDomain: null
};

// Exporta para os outros scripts acessarem
this.privacyState = state;
