// privacy_monitor.js — script principal, inicializa o estado global da extensão

var privacyState = {
  thirdPartyRequests: [],
  cookies: [],
  fingerprinting: [],
  storage: [],
  hijacking: [],
  cookieSyncing: [],
  currentDomain: null
};