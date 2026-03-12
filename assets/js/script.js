/* ================================================================
   BIG MATCH MANAGER — script.js
   Version : 1.0.6 — Cygnus
   Auteur  : Joyeux Zogo Abaga
   © Tous droits réservés

   ARCHITECTURE DES DONNÉES :
     localStorage["bigMatchDB"]    ← base de données principale
     localStorage["bmm_syncQueue"] ← file de sync GAS (retry auto)
     sessionStorage["bmm_user"]    ← utilisateur connecté (handoff login→index)
     sessionStorage["bmm_role"]    ← type du rôle (handoff login→index)

   FLUX DE CONNEXION :
     login.html / login-equipe.html / admin-login.html
       → bmmLoginRedirect(user)   [shared.js]
       → sessionStorage.setItem("bmm_user", ...)
       → redirect vers index.html
     index.html (inline script en bas de page)
       → sessionStorage.getItem("bmm_user")
       → poll jusqu'à init() terminé
       → completeLogin(user)
   ================================================================ */

'use strict';

// ── VERSION ─────────────────────────────────────────────────────────
const APP_VERSION  = '1.0.6';
const APP_CODENAME = 'Cygnus';
const APP_AUTHOR   = 'Joyeux Zogo Abaga';

const VERSION_HISTORY = [
  { version:'1.0.0', codename:'Aurora',    date:'2025-01-01', description:'Initialisation du projet — structure de base' },
  { version:'1.0.4', codename:'Andromeda', date:'2026-03-07', description:'Système de connexion 3 panneaux, Ionicons, structure multi-fichiers' },
  { version:'1.0.5', codename:'Borealis',  date:'2026-03-08', description:'Règles de sécurité, suppression données démo, traçabilité saisie, gestion versions' },
  { version:'1.0.6', codename:'Cygnus',    date:'2026-03-11', description:'Réinitialisation données, confirmations actions, œil mot de passe, dernière connexion, sync queue GAS' }
];

// ── CONSTANTES ───────────────────────────────────────────────────────
const JOURS = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
const MOIS  = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
const DB_KEY          = 'bigMatchDB';    // localStorage — base de données principale
const SYNC_QUEUE_KEY  = 'bmm_syncQueue'; // localStorage — file de sync GAS
const LOCK_SCORE_H    = 24;   // heures avant verrouillage du score
const LOCK_SCORERS_H  = 48;   // heures avant verrouillage des buteurs
const RETRY_INTERVAL_MS = 30000; // retry GAS toutes les 30 secondes
const MAX_RETRIES     = 10;   // abandon après 10 tentatives

// ── RÈGLES PERMANENTES DU PROJET (v1.0.6+) ──────────────────────────
// Règle 1 : Respect strict de la nomenclature des versions
// Règle 2 : Ne jamais casser le code existant
// Règle 3 : Amélioration progressive et non-destructive
// Règle 4 : Documentation à chaque version

// ════════════════════════════════════════════════════════════════════
//  INTÉGRATION GOOGLE APPS SCRIPT (GAS)
//  ─────────────────────────────────────────────
//  COMMENT CONFIGURER :
//  1. Déployez Code.gs comme WebApp dans Google Apps Script
//  2. Copiez l'URL générée : https://script.google.com/macros/s/.../exec
//  3. Collez-la ci-dessous à la place de la chaîne vide ''
//  Si GAS_URL reste vide → mode local uniquement, aucune erreur.
// ════════════════════════════════════════════════════════════════════
const GAS_URL = '';  // ← COLLEZ ICI L'URL DE VOTRE WEBAPP GAS

// ── STATE GLOBAL ─────────────────────────────────────────────────────
let db          = null;   // base de données en mémoire
let currentUser = null;   // utilisateur connecté
let loginTarget = null;   // équipe cible (login panel team)
let playerNames = [];     // cache des noms de joueurs (autocomplete)
let gasStatus   = 'idle'; // statut GAS courant
let syncWorkerTimer = null; // référence au timer de retry

// ── COUCHE D'ABSTRACTION GAS ──────────────────────────────────────────
async function gasGet(action, params = {}) {
  if (!GAS_URL) return null;
  try {
    const qs  = new URLSearchParams({ action, ...params }).toString();
    const res = await fetch(`${GAS_URL}?${qs}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`[GAS GET /${action}]`, err.message);
    return null;
  }
}

async function gasPost(action, data = {}) {
  if (!GAS_URL) return null;
  try {
    const res = await fetch(GAS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action, role: currentUser?.role || 'Observateur', ...data })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`[GAS POST /${action}]`, err.message);
    return null;
  }
}

// ── FILE DE SYNCHRONISATION ───────────────────────────────────────────
function queueLoad() {
  try { return JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY)) || []; }
  catch { return []; }
}
function queueSave(q) {
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(q));
}
function queueAdd(action, matchId, data) {
  if (!GAS_URL) return;
  const q = queueLoad();
  q.push({
    id: `${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    matchId, action, data,
    retries: 0, createdAt: Date.now(), lastTry: null
  });
  queueSave(q);
  updateMatchSyncBadge(matchId, 'pending');
}
function queueRemove(taskId) {
  queueSave(queueLoad().filter(t => t.id !== taskId));
}

// ── WORKER DE SYNCHRONISATION ─────────────────────────────────────────
async function syncWorker() {
  if (!GAS_URL) return;
  const q = queueLoad();
  if (!q.length) return;
  setGasStatus('syncing');
  let allOk = true;
  for (const task of q) {
    if (task.retries >= MAX_RETRIES) {
      updateMatchSyncBadge(task.matchId, 'failed');
      queueRemove(task.id);
      continue;
    }
    task.lastTry = Date.now();
    task.retries++;
    queueSave(queueLoad().map(t => t.id === task.id ? task : t));
    const result = await gasPost(task.action, task.data);
    if (result?.ok) {
      queueRemove(task.id);
      updateMatchSyncBadge(task.matchId, 'synced');
    } else {
      allOk = false;
    }
  }
  setGasStatus(allOk ? 'ok' : 'offline');
}

function startSyncWorker() {
  if (syncWorkerTimer) return;
  syncWorker();
  syncWorkerTimer = setInterval(syncWorker, RETRY_INTERVAL_MS);
}

// ── DÉTECTION RÉSEAU ──────────────────────────────────────────────────
window.addEventListener('online', () => {
  setGasStatus('syncing');
  showBanner('Connexion rétablie. Synchronisation en cours…', 'info');
  syncWorker();
  syncFromSheets();
});
window.addEventListener('offline', () => {
  setGasStatus('offline');
  showBanner('Connexion perdue. Les données sont sauvegardées localement.', 'warn');
});

// ── INDICATEUR GAS (barre nav) ────────────────────────────────────────
function setGasStatus(status) {
  gasStatus = status;
  const dot = document.getElementById('gasDot');
  const lbl = document.getElementById('gasLabel');
  if (!dot || !lbl) return;
  const map = {
    idle:    { color: '#6b9a78', text: 'GAS non configuré' },
    syncing: { color: '#f5c842', text: 'Synchronisation…'  },
    ok:      { color: '#b5e853', text: 'Google Sheets ✓'   },
    offline: { color: '#e63946', text: 'Hors ligne'        }
  };
  const s = map[status] || map.idle;
  dot.style.background = s.color;
  lbl.textContent = s.text;
  dot.style.animation = status === 'syncing' ? 'pulse 1s infinite' : 'none';
}

// ── BANNIÈRE RÉSEAU ───────────────────────────────────────────────────
function showBanner(message, type) {
  const banner = document.getElementById('networkBanner');
  if (!banner) return;
  const colors = {
    info:  { bg: 'rgba(79,195,247,.12)',  border: 'rgba(79,195,247,.3)',  color: '#4fc3f7' },
    warn:  { bg: 'rgba(245,200,66,.1)',   border: 'rgba(245,200,66,.3)',  color: '#f5c842' },
    error: { bg: 'rgba(230,57,70,.1)',    border: 'rgba(230,57,70,.3)',   color: '#e63946' }
  };
  const c = colors[type] || colors.info;
  banner.style.cssText =
    `display:flex;align-items:center;gap:8px;padding:8px 16px;` +
    `background:${c.bg};border-bottom:1px solid ${c.border};color:${c.color};font-size:12px`;
  banner.innerHTML =
    `<ion-icon name="information-circle-outline" style="font-size:15px;flex-shrink:0"></ion-icon>` +
    `<span style="flex:1">${message}</span>` +
    `<button onclick="document.getElementById('networkBanner').style.display='none'"` +
    ` style="background:transparent;border:none;cursor:pointer;color:inherit;padding:2px">` +
    `<ion-icon name="close-outline" style="font-size:15px"></ion-icon></button>`;
  if (type === 'info') setTimeout(() => { banner.style.display = 'none'; }, 6000);
}

// ── BADGES DE SYNCHRONISATION PAR MATCH ──────────────────────────────
function updateMatchSyncBadge(matchId, status) {
  const m = db?.matches?.find(x => String(x.id) === String(matchId));
  if (m) { m.gasStatus = status; save(); }
  const badge = document.querySelector(`[data-gas-badge="${matchId}"]`);
  if (!badge) return;
  const cfg = {
    pending: { icon: 'time-outline',          color: '#f5c842', title: 'En attente de sync Google Sheets' },
    synced:  { icon: 'cloud-done-outline',     color: '#b5e853', title: 'Confirmé dans Google Sheets ✓'   },
    failed:  { icon: 'cloud-offline-outline',  color: '#e63946', title: 'Échec sync Google Sheets'        }
  };
  const c = cfg[status] || cfg.pending;
  badge.innerHTML = `<ion-icon name="${c.icon}" style="color:${c.color};font-size:13px" title="${c.title}"></ion-icon>`;
}

function getMatchGasBadgeHtml(match) {
  const localBadge =
    `<span title="Sauvegardé en localStorage ✓" style="display:inline-flex;align-items:center;gap:2px;font-size:10px;color:#6b9a78">` +
    `<ion-icon name="phone-portrait-outline" style="font-size:11px"></ion-icon>✓</span>`;
  if (!GAS_URL) return localBadge;
  const gasMap = {
    synced:  { icon: 'cloud-done-outline',   color: '#b5e853', label: '✓' },
    pending: { icon: 'time-outline',         color: '#f5c842', label: '…' },
    failed:  { icon: 'cloud-offline-outline',color: '#e63946', label: '✗' }
  };
  const g = gasMap[match.gasStatus] || gasMap.pending;
  const gasBadge =
    `<span data-gas-badge="${match.id}" title="${
      match.gasStatus === 'synced' ? 'Google Sheets ✓' :
      match.gasStatus === 'failed' ? 'Échec sync GAS'  : 'En attente…'
    }" style="display:inline-flex;align-items:center;gap:2px;font-size:10px;color:${g.color}">` +
    `<ion-icon name="${g.icon}" style="font-size:11px"></ion-icon>${g.label}</span>`;
  return `<div style="display:flex;flex-direction:column;gap:2px;align-items:center">${localBadge}${gasBadge}</div>`;
}

// ── SYNC SHEETS → LOCAL ───────────────────────────────────────────────
async function syncFromSheets() {
  if (!GAS_URL) { setGasStatus('idle'); return; }
  setGasStatus('syncing');
  try {
    const data = await gasGet('matches');
    if (data?.matches) {
      const remoteIds = new Set(data.matches.map(m => String(m.id)));
      const localOnly = db.matches.filter(m => !remoteIds.has(String(m.id)));
      // Remettre en file les matchs locaux absents de Sheets
      localOnly.forEach(m => {
        const q = queueLoad();
        if (!q.find(t => String(t.matchId) === String(m.id) && t.action === 'addMatch')) {
          queueAdd('addMatch', m.id, _matchPayload(m));
        }
      });
      db.matches = [...data.matches.map(m => ({ ...m, gasStatus: 'synced' })), ...localOnly];
      save();
      renderAll();
    }
    setGasStatus('ok');
    startSyncWorker();
  } catch {
    setGasStatus('offline');
  }
}

async function syncAllFromSheets() {
  if (!GAS_URL) { notify('GAS non configuré — ajoutez GAS_URL dans script.js', true); return; }
  setGasStatus('syncing');
  try {
    const data = await gasGet('matches');
    if (data?.matches?.length) {
      db.matches = data.matches.map(m => ({ ...m, gasStatus: 'synced' }));
      save(); renderAll();
    }
    queueSave([]);
    setGasStatus('ok');
    notify('Synchronisation Google Sheets terminée ✓');
  } catch {
    setGasStatus('offline');
    notify('Google Sheets inaccessible — mode local activé', true);
  }
}

// ── SYNC LOCAL → SHEETS ───────────────────────────────────────────────
function _matchPayload(match) {
  return {
    id: match.id, date: match.date, heure: match.heure || '',
    jour: getJour(match.date), type: match.type || 'Big Match',
    statut: match.statut || '', motif: match.motif || '',
    eq1: match.eq1 || '', eq2: match.eq2 || '',
    sc1: match.sc1 ?? 0, sc2: match.sc2 ?? 0,
    but1: match.but1 || '', but2: match.but2 || '',
    annee: match.annee || new Date().getFullYear(),
    scoredBy: match.scoredBy || '', scoredByTeam: match.scoredByTeam || '',
    homeTeam: match.homeTeam || match.eq1 || ''
  };
}

async function pushMatchToSheets(match) {
  if (!GAS_URL) return;
  updateMatchSyncBadge(match.id, 'pending');
  const result = await gasPost('addMatch', _matchPayload(match));
  if (result?.ok) {
    updateMatchSyncBadge(match.id, 'synced');
    setGasStatus('ok');
  } else {
    queueAdd('addMatch', match.id, _matchPayload(match));
    setGasStatus('offline');
    showBanner('Google Sheets temporairement inaccessible. Le match sera synchronisé automatiquement.', 'warn');
  }
}

async function pushDeleteToSheets(matchId) {
  if (!GAS_URL) return;
  const result = await gasPost('deleteMatch', { id: matchId });
  if (result?.ok) { setGasStatus('ok'); }
  else { queueAdd('deleteMatch', matchId, { id: matchId }); }
}

async function pushClearToSheets() {
  if (!GAS_URL) return;
  queueSave([]);
  await gasPost('clearMatches', {});
}

// ── BASE DE DONNÉES ───────────────────────────────────────────────────
function loadDB() {
  try { return JSON.parse(localStorage.getItem(DB_KEY)); }
  catch { return null; }
}

function save() {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function defaultDB() {
  return {
    matches: [],
    users: [
      { id:1, nom:'Contrôleur',      role:'Contrôleur',       password:'Malaga2025!',  type:'admin',  lastLogin:null, createdBy:null, membres:[] },
      { id:2, nom:'Sous-Contrôleur', role:'Sous-Contrôleur',  password:'SousCtrl2025', type:'admin',  lastLogin:null, createdBy:null, membres:[] },
      { id:3, nom:'Rouge',           role:'Rouge',             password:'Rouge2025',    type:'equipe', lastLogin:null, createdBy:null, membres:[] },
      { id:4, nom:'Blanc',           role:'Blanc',             password:'BlancFC@',     type:'equipe', lastLogin:null, createdBy:null, membres:[] },
      { id:5, nom:'Observateur',     role:'Observateur',       password:'',             type:'obs',    lastLogin:null, createdBy:null }
    ],
    activityLog: [], events: [], nextId: 1, nextUserId: 6, nextEventId: 1,
    v106Applied: false, versionHistory: VERSION_HISTORY
  };
}

// ── INIT ──────────────────────────────────────────────────────────────
async function init() {
  db = loadDB();
  if (!db) {
    db = defaultDB();
    save();
  } else {
    let migrated = false;
    // Migration type utilisateur
    db.users.forEach(u => {
      if (!u.type) {
        const m = { 'Contrôleur':'admin', 'Sous-Contrôleur':'admin', 'Observateur':'obs' };
        u.type = m[u.role] || 'equipe'; migrated = true;
      }
      if (u.lastLogin  === undefined) { u.lastLogin  = null; migrated = true; }
      if (u.createdBy  === undefined) { u.createdBy  = null; migrated = true; }
      if (u.type === 'equipe' && u.membres === undefined) { u.membres = []; migrated = true; }
    });
    if (!db.events)      { db.events = [];           migrated = true; }
    if (!db.nextEventId) { db.nextEventId = 1;        migrated = true; }
    if (!db.versionHistory) { db.versionHistory = VERSION_HISTORY; migrated = true; }
    // Migration champs traçabilité matchs
    db.matches.forEach(m => {
      if (m.scoredBy      === undefined) { m.scoredBy      = null; migrated = true; }
      if (m.scoredByTeam  === undefined) { m.scoredByTeam  = null; migrated = true; }
      if (m.tsScore       === undefined) { m.tsScore       = m.ts || null; migrated = true; }
      if (m.tsLastUpdate  === undefined) { m.tsLastUpdate  = m.ts || null; migrated = true; }
      if (m.homeTeam      === undefined) { m.homeTeam      = m.eq1 || null; migrated = true; }
      if (m.gasStatus     === undefined) { m.gasStatus     = 'synced'; migrated = true; }
    });
    // v1.0.6 : réinitialisation des données de test (une seule fois)
    if (!db.v106Applied) {
      db.matches = []; db.activityLog = []; db.nextId = 1;
      db.v106Applied = true; migrated = true;
    }
    if (migrated) save();
  }
  buildLogin();
}

// ── EXPORT ────────────────────────────────────────────────────────────
function exportData() {
  bmmConfirm(
    'Voulez-vous exporter toutes les données en fichier JSON ?',
    () => {
      const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'data.json'; a.click(); URL.revokeObjectURL(a.href);
      notify('Données exportées');
    }, 'info'
  );
}

// ── CONFIRMATION DIALOG (v1.0.6) ─────────────────────────────────────
function bmmConfirm(message, onConfirm, level) {
  const overlay = document.getElementById('confirmOverlay');
  const msg     = document.getElementById('confirmMsg');
  const btnOk   = document.getElementById('confirmOk');
  if (!overlay || !msg || !btnOk) {
    if (window.confirm(message)) onConfirm();
    return;
  }
  msg.textContent = message;
  btnOk.className = 'btn btn-confirm-' + (level || 'primary');
  overlay.style.display = 'flex';
  const fresh = btnOk.cloneNode(true);
  btnOk.parentNode.replaceChild(fresh, btnOk);
  document.getElementById('confirmOk').addEventListener('click', () => {
    overlay.style.display = 'none'; onConfirm();
  });
  document.getElementById('confirmCancel').addEventListener('click', () => {
    overlay.style.display = 'none';
  }, { once: true });
}

// ── TOGGLE MOT DE PASSE (version index.html — indépendante de shared.js) ──
/**
 * NOTE : shared.js N'EST PAS chargé dans index.html.
 * Cette fonction est donc déclarée ici pour l'overlay de connexion interne.
 * Les deux déclarations (shared.js + script.js) sont intentionnelles et nécessaires.
 */
function togglePwVisibility(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.innerHTML = inp.type === 'password'
    ? '<ion-icon name="eye-outline"></ion-icon>'
    : '<ion-icon name="eye-off-outline"></ion-icon>';
}

// ── HELPERS ────────────────────────────────────────────────────────
function getJour(dateStr) {
  if (!dateStr) return '';
  return JOURS[new Date(dateStr + 'T12:00:00').getDay()];
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.getDate() + ' ' + MOIS[d.getMonth()];
}

function getWeekNum(dateStr) {
  const d   = new Date(dateStr + 'T12:00:00');
  const jan = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - jan) / 86400000 + jan.getDay() + 1) / 7);
}

function getYear(dateStr) {
  if (!dateStr) return new Date().getFullYear();
  return new Date(dateStr + 'T12:00:00').getFullYear();
}

function parseScorers(str) {
  if (!str || !str.trim()) return [];
  return str.split(',').map(s => s.trim()).filter(Boolean).map(entry => {
    const m = entry.match(/^(.+?)\s*\((.+?)\)\s*$/);
    return m ? { player: m[1].trim(), passer: m[2].trim() } : { player: entry.trim(), passer: null };
  });
}

function notify(msg, isErr = false) {
  const n = document.getElementById('notif');
  n.textContent = msg;
  n.className   = 'notif' + (isErr ? ' error' : '') + ' show';
  setTimeout(() => n.classList.remove('show'), 3000);
}

function logActivity(action) {
  if (!currentUser) return;
  db.activityLog.unshift({
    ts:     new Date().toLocaleString('fr-FR'),
    user:   currentUser.nom,
    role:   currentUser.role,
    action
  });
  if (db.activityLog.length > 300) db.activityLog.pop();
}

// ── PERIOD FILTER ──────────────────────────────────────────────────
function inPeriod(dateStr, period) {
  if (!dateStr) return false;
  const d   = new Date(dateStr + 'T12:00:00');
  const now = new Date();
  switch (period) {
    case 'semaine': {
      const ago = new Date(now); ago.setDate(ago.getDate() - 7);
      return d >= ago;
    }
    case 'mois':
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    case 'trimestre': {
      const q = Math.floor(now.getMonth() / 3);
      return Math.floor(d.getMonth() / 3) === q && d.getFullYear() === now.getFullYear();
    }
    case 'annee':
      return d.getFullYear() === now.getFullYear();
    default:
      return true;
  }
}

// ── DATA ACCESSORS ─────────────────────────────────────────────────
function getPlayedMatches(yearFilter) {
  return db.matches.filter(m => {
    const ok = m.statut === 'Match joué';
    return yearFilter ? ok && getYear(m.date) === Number(yearFilter) : ok;
  });
}

function getAllYears() {
  const years = new Set(db.matches.map(m => getYear(m.date)));
  years.add(new Date().getFullYear());
  return [...years].sort((a, b) => b - a);
}

function getAllPlayers(matches) {
  const src = matches || getPlayedMatches();
  const players = {};
  src.forEach(m => {
    const acc = (butStr, team) => {
      parseScorers(butStr).forEach(s => {
        if (!players[s.player]) players[s.player] = { name: s.player, goals: 0, assists: 0, team, mvpPoints: 0 };
        players[s.player].goals++;
        players[s.player].mvpPoints += 3;
        if (s.passer) {
          if (!players[s.passer]) players[s.passer] = { name: s.passer, goals: 0, assists: 0, team, mvpPoints: 0 };
          players[s.passer].assists++;
          players[s.passer].mvpPoints += 2;
        }
      });
    };
    acc(m.but1, m.eq1);
    acc(m.but2, m.eq2);
    // victory bonus (+1 per scorer)
    const sc1 = Number(m.sc1 || 0), sc2 = Number(m.sc2 || 0);
    if (sc1 > sc2) parseScorers(m.but1).forEach(s => { if (players[s.player]) players[s.player].mvpPoints++; });
    else if (sc2 > sc1) parseScorers(m.but2).forEach(s => { if (players[s.player]) players[s.player].mvpPoints++; });
  });
  return Object.values(players);
}

function getTeams(matches) {
  const src  = matches || getPlayedMatches();
  const teams = {};
  src.forEach(m => {
    [m.eq1, m.eq2].forEach(t => {
      if (t && !teams[t]) teams[t] = { name: t, scored: 0, conceded: 0, played: 0, wins: 0, draws: 0, losses: 0 };
    });
    const sc1 = Number(m.sc1 || 0), sc2 = Number(m.sc2 || 0);
    if (m.eq1) { teams[m.eq1].scored += sc1; teams[m.eq1].conceded += sc2; teams[m.eq1].played++; if (sc1 > sc2) teams[m.eq1].wins++; else if (sc1 < sc2) teams[m.eq1].losses++; else teams[m.eq1].draws++; }
    if (m.eq2) { teams[m.eq2].scored += sc2; teams[m.eq2].conceded += sc1; teams[m.eq2].played++; if (sc2 > sc1) teams[m.eq2].wins++; else if (sc2 < sc1) teams[m.eq2].losses++; else teams[m.eq2].draws++; }
  });
  return Object.values(teams);
}

function getPeriodStats(period, yearFilter) {
  const ms      = getPlayedMatches(yearFilter).filter(m => inPeriod(m.date, period));
  const players = getAllPlayers(ms);
  const teams   = getTeams(ms);
  return {
    topButeurs:  [...players].sort((a, b) => b.goals      - a.goals).slice(0, 10),
    topPasseurs: [...players].sort((a, b) => b.assists     - a.assists).slice(0, 10),
    mvp:         [...players].sort((a, b) => b.mvpPoints   - a.mvpPoints).slice(0, 5),
    teams:       [...teams].sort((a, b) => b.wins - a.wins),
    matchCount:  ms.length
  };
}

// ── VERROUILLAGE DES MATCHS — v1.0.5 ─────────────────────────────
/**
 * isScoreLocked(match)  — Score verrouillé après LOCK_SCORE_H (24h)
 * isScorersLocked(match) — Buteurs/passeurs verrouillés après LOCK_SCORERS_H (48h)
 * Seul le Contrôleur (super-admin) peut passer outre.
 */
function getMatchTimestamp(match) {
  if (!match.date) return null;
  return new Date(match.date + 'T' + (match.heure || '12:00') + ':00').getTime();
}

function isScoreLocked(match) {
  const ts = getMatchTimestamp(match);
  if (!ts) return false;
  return (Date.now() - ts) / 3600000 > LOCK_SCORE_H;
}

function isScorersLocked(match) {
  const ts = getMatchTimestamp(match);
  if (!ts) return false;
  return (Date.now() - ts) / 3600000 > LOCK_SCORERS_H;
}

// Rétro-compatibilité — vérifie le verrou score (24h)
function isLocked(match) { return isScoreLocked(match); }

// ── LOGIN — 3-PANEL MODULAR SYSTEM ────────────────────────────────

// ── Colour tokens per panel (hex/rgb/name — fully changeable) ──────
const LOGIN_COLORS = {
  admin: { border: '#f5c842', glow: 'rgba(245,200,66,.25)', bg: 'rgba(245,200,66,.08)' },
  team:  { border: '#4fc3f7', glow: 'rgba(79,195,247,.25)', bg: 'rgba(79,195,247,.08)' },
  obs:   { border: '#6b9a78', glow: 'rgba(107,154,120,.2)', bg: 'rgba(107,154,120,.06)' },
  main:  { border: '#1e4a2a', glow: 'transparent',          bg: 'transparent' }
};

/**
 * buildLogin()
 * Initialise the login UI: populate the team dropdown, reset panels.
 */
function buildLogin() {
  populateTeamDropdown();
  showLoginPanel('main');
}

/** Populate #teamSelect with all users of type 'equipe'. */
function populateTeamDropdown() {
  const sel = document.getElementById('teamSelect');
  if (!sel) return;
  const teams = db.users.filter(u => u.type === 'equipe');
  sel.innerHTML = '<option value="">— Choisir une équipe —</option>' +
    teams.map(u => `<option value="${u.id}">${u.nom}</option>`).join('');

  const noTeams = document.getElementById('teamNoTeams');
  if (noTeams) noTeams.style.display = teams.length ? 'none' : 'block';
}

/**
 * showLoginPanel(panel)
 * Switches between: 'main' | 'admin' | 'team'
 * Updates login box border colour dynamically.
 */
function showLoginPanel(panel) {
  ['panelMain','panelAdmin','panelTeam'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  // Reset error
  const err = document.getElementById('loginError');
  if (err) err.style.display = 'none';

  // Reset pw sub-sections
  const aPs = document.getElementById('adminPwSection');
  if (aPs) aPs.style.display = 'none';
  const aSel = document.getElementById('adminRoleSelect');
  if (aSel) aSel.value = '';

  const tPs = document.getElementById('teamPwSection');
  if (tPs) tPs.style.display = 'none';
  const tSel = document.getElementById('teamSelect');
  if (tSel) tSel.value = '';

  // Show target panel
  const targetPanel = { main:'panelMain', admin:'panelAdmin', team:'panelTeam' }[panel] || 'panelMain';
  const el = document.getElementById(targetPanel);
  if (el) el.style.display = 'block';

  // Apply dynamic border colour
  applyLoginColor(panel);
}

/** Apply dynamic border/glow colour to the login box. */
function applyLoginColor(panel) {
  const box = document.getElementById('loginBox');
  if (!box) return;
  const c = LOGIN_COLORS[panel] || LOGIN_COLORS.main;
  box.style.borderColor  = c.border;
  box.style.boxShadow    = `0 20px 60px rgba(0,0,0,.8), 0 0 0 1px ${c.border}, 0 0 40px ${c.glow}`;
}

// ── PANEL: ADMIN ──────────────────────────────────────────────────
function onAdminRoleChange() {
  const sel = document.getElementById('adminRoleSelect');
  const pws = document.getElementById('adminPwSection');
  const ttl = document.getElementById('adminPwTitle');
  const inp = document.getElementById('adminPwInput');
  if (!sel || !pws) return;

  const err = document.getElementById('loginError');
  if (err) err.style.display = 'none';

  if (!sel.value) { pws.style.display = 'none'; return; }

  pws.style.display = 'block';
  if (ttl) ttl.textContent = sel.value === 'Contrôleur'
    ? 'Mot de passe — Contrôleur'
    : 'Mot de passe — Sous-Contrôleur';
  if (inp) { inp.value = ''; inp.focus(); }
}

function checkAdminPassword() {
  const role = document.getElementById('adminRoleSelect')?.value;
  const pw   = document.getElementById('adminPwInput')?.value;
  if (!role) { showLoginError('Sélectionnez un niveau d\'accès'); return; }

  const user = db.users.find(u => u.role === role && u.password === pw);
  if (user) {
    completeLogin(user);
  } else {
    showLoginError('Mot de passe incorrect');
    document.getElementById('adminPwInput').value = '';
    document.getElementById('adminPwInput').focus();
  }
}

// ── PANEL: TEAM ───────────────────────────────────────────────────
function onTeamSelectChange() {
  const sel = document.getElementById('teamSelect');
  const pws = document.getElementById('teamPwSection');
  const ttl = document.getElementById('teamPwTitle');
  const inp = document.getElementById('teamPwInput');
  if (!sel || !pws) return;

  const err = document.getElementById('loginError');
  if (err) err.style.display = 'none';

  if (!sel.value) { pws.style.display = 'none'; return; }

  const team = db.users.find(u => u.id === Number(sel.value));
  pws.style.display = 'block';
  if (ttl) ttl.textContent = `Mot de passe — ${team?.nom || ''}`;
  if (inp) { inp.value = ''; inp.focus(); }
}

function checkTeamPassword() {
  const sel  = document.getElementById('teamSelect');
  const pw   = document.getElementById('teamPwInput')?.value;
  const tid  = Number(sel?.value);
  if (!tid) { showLoginError('Sélectionnez une équipe'); return; }

  // Strict: password must match THIS team exactly — not another team's
  const user = db.users.find(u => u.id === tid && u.type === 'equipe' && u.password === pw);
  if (user) {
    completeLogin(user);
  } else {
    showLoginError('Mot de passe incorrect pour cette équipe');
    document.getElementById('teamPwInput').value = '';
    document.getElementById('teamPwInput').focus();
  }
}

// ── OBSERVER: direct access ───────────────────────────────────────
function loginAsObserver() {
  const obs = db.users.find(u => u.type === 'obs') ||
              { id: 99, nom: 'Observateur', role: 'Observateur', type: 'obs' };
  completeLogin(obs);
}

// ── SHARED LOGIN ERROR ────────────────────────────────────────────
function showLoginError(msg) {
  const err = document.getElementById('loginError');
  if (!err) { notify(msg, true); return; }
  err.textContent = msg;
  err.style.display = 'block';
  setTimeout(() => { err.style.display = 'none'; }, 3500);
}

// ── KEYBOARD: Enter to submit ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('adminPwInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') checkAdminPassword();
  });
  document.getElementById('teamPwInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') checkTeamPassword();
  });
});

// ── LEGACY STUBS — kept so any external references don't break ────
function selectRole(role)  { /* superseded by 3-panel login */ }
function cancelLogin()     { showLoginPanel('main'); }
function checkPassword()   { /* superseded */ }



function completeLogin(user) {
  currentUser = user;

  // v1.0.6 — Enregistrer la dernière connexion
  const userInDB = db.users.find(u => u.id === user.id);
  if (userInDB) {
    userInDB.lastLogin = new Date().toLocaleString('fr-FR');
    // Sync currentUser reference
    currentUser = Object.assign({}, user, { lastLogin: userInDB.lastLogin });
    save();
  }

  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('userName').textContent  = currentUser.nom;
  document.getElementById('userRole').textContent  = currentUser.role;

  // Role dot colour
  const roleClass = {
    'Contrôleur':      'role-ctrl',
    'Sous-Contrôleur': 'role-sub',
    'Observateur':     'role-obs'
  };
  // Teams get role-rouge / role-blanc or generic role-team
  const teamClass = user.type === 'equipe'
    ? (user.role === 'Rouge' ? 'role-rouge' : user.role === 'Blanc' ? 'role-blanc' : 'role-team')
    : null;
  document.getElementById('roleDot').className = 'role-dot ' + (teamClass || roleClass[user.role] || 'role-obs');

  applyPermissions();
  populateYearSelectors();
  refreshPlayerNames();
  renderAll();
  logActivity('Connexion');
  notify('Bienvenue, ' + user.nom + ' !');
  // ── Synchronisation GAS en arrière-plan après connexion ──
  syncFromSheets();
}

/**
 * togglePwVisibility(inputId, btn) — v1.0.6
 * Affiche ou masque un champ mot de passe.
 */
function togglePwVisibility(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  if (btn) {
    btn.innerHTML = inp.type === 'password'
      ? '<ion-icon name="eye-outline"></ion-icon>'
      : '<ion-icon name="eye-off-outline"></ion-icon>';
  }
}

function logout() {
  logActivity('Déconnexion');
  save();
  currentUser = null;
  const ol = document.getElementById('loginOverlay');
  if (ol) ol.style.display = 'flex';
  buildLogin(); // re-initialise 3-panel login
}

function applyPermissions() {
  const role   = currentUser.role;
  const type   = currentUser.type || 'obs';

  // Saisie matchs : admins + équipes (pas observateurs)
  const canAdd     = type === 'admin' || type === 'equipe';
  // Gestion utilisateurs : Contrôleur seulement
  const isSuperAdmin = role === 'Contrôleur';
  // Journal : admins seulement
  const isAnyAdmin   = type === 'admin';

  document.getElementById('navAdd').style.display    = canAdd       ? 'flex' : 'none';
  document.getElementById('navUsers').style.display  = isSuperAdmin ? 'flex' : 'none';
  document.getElementById('navLog').style.display    = isAnyAdmin   ? 'flex' : 'none';

  // Bouton export — visible pour tous les utilisateurs connectés
  const expBtn = document.getElementById('btnExport');
  if (expBtn) expBtn.style.display = 'inline-flex';

  // La page À propos est visible pour tous
  const navAbout = document.getElementById('navAbout');
  if (navAbout) navAbout.style.display = 'flex';

  // Adapter le formulaire de saisie selon le rôle
  const posRow = document.getElementById('positionRow');
  if (posRow) posRow.style.display = (type === 'equipe') ? 'block' : 'none';

  // Avertissement verrouillage : visible pour les équipes et sous-contrôleur
  const lockCard = document.getElementById('lockWarningCard');
  if (lockCard) lockCard.style.display = (type === 'equipe') ? 'block' : 'none';

  // v1.0.6 — Bouton réinitialisation données (Contrôleur uniquement)
  const btnReset = document.getElementById('btnResetData');
  if (btnReset) btnReset.style.display = isSuperAdmin ? 'inline-flex' : 'none';

  // v1.0.6 — Indicateur GAS (visible pour tous les utilisateurs connectés)
  const gasInd = document.getElementById('gasIndicator');
  if (gasInd) gasInd.style.display = 'flex';
  setGasStatus(GAS_URL ? 'idle' : 'idle');
}

// ── NAV ────────────────────────────────────────────────────────────
function showSection(id, btn) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('sec-' + id).classList.add('active');
  if (btn) btn.classList.add('active');
  if (id === 'stats')    renderStats();
  if (id === 'history')  renderHistory();
  if (id === 'users')    renderUsers();
  if (id === 'log')      renderLog();
  if (id === 'palmares') renderPalmares();
  if (id === 'about')    renderVersionHistory();
}

// ── YEAR SELECTORS ─────────────────────────────────────────────────
function populateYearSelectors() {
  const years = getAllYears();
  const opts  = years.map(y => `<option value="${y}">${y}</option>`).join('');
  ['statsYear', 'histYearFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.innerHTML = opts; el.value = years[0]; }
  });
  const yd = document.getElementById('yearDisplay');
  if (yd) yd.textContent = 'Saison ' + years[0];
}

function refreshPlayerNames() {
  const names = new Set();
  db.matches.forEach(m => {
    parseScorers(m.but1).forEach(s => { names.add(s.player); if (s.passer) names.add(s.passer); });
    parseScorers(m.but2).forEach(s => { names.add(s.player); if (s.passer) names.add(s.passer); });
  });
  playerNames = [...names].sort();
}

// ── RENDER ALL ─────────────────────────────────────────────────────
function renderAll() {
  renderDashboard();
}

// ── DASHBOARD ──────────────────────────────────────────────────────
function renderDashboard() {
  renderLastMatch();
  renderWeekHighlights();
  renderQuickStats();
  renderDashCharts();
  updateTeamsList();
}

function renderLastMatch() {
  const played = getPlayedMatches().sort((a, b) =>
    (b.date + b.heure).localeCompare(a.date + a.heure) || b.ts - a.ts
  );
  const cont = document.getElementById('lastMatchSection');
  if (!played.length) {
    cont.innerHTML = `<div class="last-match-hero">
      <div class="empty">
        <div class="e-icon"><ion-icon name="football-outline"></ion-icon></div>
        Aucun match joué pour l'instant — ajoutez votre premier match !
      </div>
    </div>`;
    return;
  }
  const m   = played[0];
  const sc1 = Number(m.sc1), sc2 = Number(m.sc2);
  const winner = sc1 > sc2 ? m.eq1 : sc2 > sc1 ? m.eq2 : 'Match nul';
  const b1 = parseScorers(m.but1), b2 = parseScorers(m.but2);

  // MVP calc
  const pts = {};
  const acc = (arr) => arr.forEach(s => {
    if (!pts[s.player]) pts[s.player] = 0; pts[s.player] += 3;
    if (s.passer) { if (!pts[s.passer]) pts[s.passer] = 0; pts[s.passer] += 2; }
  });
  acc(b1); acc(b2);
  if (sc1 > sc2) b1.forEach(s => { if (pts[s.player] !== undefined) pts[s.player]++; });
  else if (sc2 > sc1) b2.forEach(s => { if (pts[s.player] !== undefined) pts[s.player]++; });
  const mvp = Object.keys(pts).sort((a, b) => pts[b] - pts[a])[0];

  const sh = (arr) => arr.map(s =>
    `<div class="lm-scorer-item"><ion-icon name="football-outline"></ion-icon> ${s.player}${s.passer ? ` <span class="passer">(${s.passer})</span>` : ''}${s.player === mvp ? ' ★' : ''}</div>`
  ).join('');

  cont.innerHTML = `
    <div class="last-match-hero">
      <div class="lm-label"><ion-icon name="flash-outline"></ion-icon> Dernier Match — ${formatDate(m.date)} ${m.heure}</div>
      <div class="lm-teams">
        <div class="lm-team left">${m.eq1}</div>
        <div class="lm-score">${sc1} — ${sc2}</div>
        <div class="lm-team right">${m.eq2}</div>
      </div>
      <div class="lm-winner">
        Gagnant : <strong>${winner}</strong>
        ${mvp ? ` &nbsp;| <ion-icon name="star-outline" style="color:var(--gold)"></ion-icon> MVP : <span class="lm-mvp">${mvp}</span>` : ''}
      </div>
      ${(b1.length || b2.length) ? `
        <div class="lm-scorers">
          <div class="lm-scorer-col"><div class="lm-scorer-title">Buteurs ${m.eq1}</div>${sh(b1) || '<div style="color:var(--text-dim);font-size:12px">—</div>'}</div>
          <div class="lm-scorer-col"><div class="lm-scorer-title">Buteurs ${m.eq2}</div>${sh(b2) || '<div style="color:var(--text-dim);font-size:12px">—</div>'}</div>
        </div>` : ''}
    </div>`;
}

function renderWeekHighlights() {
  const ps = getPeriodStats('semaine');
  document.getElementById('hlTopButSem').textContent  = ps.topButeurs[0]  ? `${ps.topButeurs[0].name} (${ps.topButeurs[0].goals} buts)` : '—';
  document.getElementById('hlTopPassSem').textContent = ps.topPasseurs[0] ? `${ps.topPasseurs[0].name} (${ps.topPasseurs[0].assists} passes)` : '—';
  document.getElementById('hlMvpSem').textContent     = ps.mvp[0]         ? `${ps.mvp[0].name} (${ps.mvp[0].mvpPoints} pts)` : '—';
  document.getElementById('hlTopTeamSem').textContent = ps.teams[0]       ? `${ps.teams[0].name} (${ps.teams[0].wins} V)` : '—';
}

function renderQuickStats() {
  const cm      = getPlayedMatches();
  const players = getAllPlayers(cm);
  const topBut  = [...players].sort((a, b) => b.goals      - a.goals)[0];
  const topPass = [...players].sort((a, b) => b.assists     - a.assists)[0];
  const topMvp  = [...players].sort((a, b) => b.mvpPoints   - a.mvpPoints)[0];
  const maxScore = cm.reduce((acc, m) => Math.max(acc, Number(m.sc1 || 0) + Number(m.sc2 || 0)), 0);

  document.getElementById('quickStats').innerHTML = [
    { val: cm.length,                          lbl: 'Matchs Joués' },
    { val: cm.filter(m=>m.type==='Big Match').length, lbl: 'Big Match' },
    { val: cm.filter(m=>m.type==='Contre').length,    lbl: 'Contres' },
    { val: topBut  ? topBut.goals      : 0,    lbl: topBut  ? topBut.name  : 'Meilleur Buteur',  cls: 'gold' },
    { val: topPass ? topPass.assists   : 0,    lbl: topPass ? topPass.name : 'Meilleur Passeur' },
    { val: topMvp  ? topMvp.mvpPoints  : 0,    lbl: topMvp  ? topMvp.name  : 'MVP',               cls: 'gold' },
    { val: maxScore,                           lbl: 'Buts max/match', cls: 'red' },
  ].map(s => `<div class="stat-box ${s.cls||''}"><div class="stat-val">${s.val}</div><div class="stat-lbl">${s.lbl}</div></div>`).join('');
}

function renderDashCharts() {
  const players = getAllPlayers();
  const teams   = getTeams();
  const byScoal = [...players].sort((a, b) => b.goals   - a.goals).slice(0, 8);
  const byAst   = [...players].sort((a, b) => b.assists  - a.assists).slice(0, 8);
  document.getElementById('chartButeursData').innerHTML  = makeBarChart(byScoal.map(p => ({label:p.name,val:p.goals})),   'bar-green', byScoal[0]?.goals   || 1);
  document.getElementById('chartPasseursData').innerHTML = makeBarChart(byAst.map(p   => ({label:p.name,val:p.assists})), 'bar-gold',  byAst[0]?.assists   || 1);
  document.getElementById('chartEquipes').innerHTML      = makeBarChart([...teams].sort((a,b)=>b.scored-a.scored).map(t=>({label:t.name,val:t.scored})), 'bar-green', teams.sort((a,b)=>b.scored-a.scored)[0]?.scored || 1);
  // Weekly chart
  const weeks = {};
  getPlayedMatches().forEach(m => { const w = getWeekNum(m.date); weeks[w] = (weeks[w]||0)+1; });
  const wData = Object.entries(weeks).sort((a,b)=>a[0]-b[0]).map(([w,c])=>({label:'S'+w,val:c}));
  document.getElementById('chartSemaines').innerHTML = makeBarChart(wData, 'bar-gold', Math.max(...wData.map(d=>d.val), 1));
}

function makeBarChart(data, colorClass, maxVal) {
  if (!data.length) return '<div class="empty" style="padding:20px">Pas de données</div>';
  return `<div class="bar-chart">${data.map(d => `
    <div class="bar-row">
      <div class="bar-label" title="${d.label}">${d.label}</div>
      <div class="bar-track">
        <div class="bar-fill ${colorClass}" style="width:${Math.round((d.val / (maxVal||1)) * 100)}%">
          <span class="bar-val">${d.val}</span>
        </div>
      </div>
    </div>`).join('')}</div>`;
}

// ── HISTORY ────────────────────────────────────────────────────────
function renderHistory() {
  const search  = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const fStat   = document.getElementById('filterStatut')?.value || '';
  const yearF   = document.getElementById('histYearFilter')?.value;
  const canDel  = currentUser?.role === 'Contrôleur';

  let matches = [...db.matches].sort((a, b) =>
    (b.date + b.heure).localeCompare(a.date + a.heure) || (b.ts||0) - (a.ts||0)
  );

  if (yearF)  matches = matches.filter(m => getYear(m.date) === Number(yearF));
  if (search) matches = matches.filter(m => JSON.stringify(m).toLowerCase().includes(search));
  if (fStat)  matches = matches.filter(m => m.statut === fStat);

  const sbc = { 'Match joué':'badge-joue','Pas de match':'badge-pas','Match annulé':'badge-annule','Match arrêté':'badge-arrete' };

  document.getElementById('historyBody').innerHTML = matches.length ? matches.map(m => {
    const hasScore = m.statut === 'Match joué' || m.statut === 'Match arrêté';
    const tb = m.type === 'Big Match' ? 'badge-bm' : 'badge-contre';
    const butInfo = [
      ...parseScorers(m.but1).map(x => `${x.player}${x.passer?' ('+x.passer+')':''}`),
      ...parseScorers(m.but2).map(x => `${x.player}${x.passer?' ('+x.passer+')':''}`)
    ].join(', ');
    // MVP
    const pts = {};
    const ab  = arr => arr.forEach(s => {
      if (!pts[s.player]) pts[s.player] = 0; pts[s.player] += 3;
      if (s.passer) { if (!pts[s.passer]) pts[s.passer] = 0; pts[s.passer] += 2; }
    });
    ab(parseScorers(m.but1)); ab(parseScorers(m.but2));
    const sc1 = Number(m.sc1||0), sc2 = Number(m.sc2||0);
    if (sc1 > sc2) parseScorers(m.but1).forEach(s => { if (pts[s.player] !== undefined) pts[s.player]++; });
    else if (sc2 > sc1) parseScorers(m.but2).forEach(s => { if (pts[s.player] !== undefined) pts[s.player]++; });
    const mvp = Object.keys(pts).sort((a, b) => pts[b] - pts[a])[0];
    const locked = isLocked(m);

    return `<tr>
      <td>${formatDate(m.date)}</td>
      <td>${getJour(m.date)}</td>
      <td>${m.heure}</td>
      <td><span class="badge ${tb}">${m.type}</span></td>
      <td><span class="badge ${sbc[m.statut]||''}">${m.statut}</span></td>
      <td>${m.eq1 || '—'}</td>
      <td>${hasScore && m.eq1 ? `<span class="score-display">${m.sc1}—${m.sc2}</span>` : '—'}</td>
      <td>${m.eq2 || '—'}</td>
      <td style="font-size:11px;color:var(--text-dim);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${butInfo}">${butInfo || '—'}</td>
      <td>${mvp ? `<span class="mvp-badge"><ion-icon name="star-outline"></ion-icon> ${mvp}</span>` : '—'}</td>
      <td>${isScoreLocked(m) ? '<span class="lock-badge" title="Score verrouillé"><ion-icon name="lock-closed-outline"></ion-icon></span>' : '<span class="unlocked-badge"><ion-icon name="checkmark-outline"></ion-icon></span>'} ${isScorersLocked(m) && !isScoreLocked(m) ? '<span class="lock-badge" title="Buteurs verrouillés" style="opacity:.6"><ion-icon name="lock-closed-outline"></ion-icon></span>' : ''}</td>
      <td style="text-align:center">${getMatchGasBadgeHtml(m)}</td>
      <td>${canDel ? `<button class="btn btn-danger btn-sm" onclick="deleteMatch(${m.id})"><ion-icon name="trash-outline"></ion-icon></button>` : '—'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="13" class="empty">Aucun match enregistré pour le moment.</td></tr>';
}

function deleteMatch(id) {
  if (!currentUser || currentUser.role !== 'Contrôleur') {
    notify('Seul le Contrôleur peut supprimer', true); return;
  }
  const m = db.matches.find(x => x.id === id);
  if (!m) return;
  bmmConfirm(
    `Supprimer le match ${m.eq1||'?'} vs ${m.eq2||'?'} du ${m.date} ?
Cette action est irréversible.`,
    () => {
      logActivity(`Suppression match : ${m.eq1||'?'} vs ${m.eq2||'?'} — ${m.date}`);
      db.matches = db.matches.filter(x => x.id !== id);
      save();
      renderHistory();
      renderDashboard();
      notify('Match supprimé');
      // ── Synchronisation GAS (asynchrone, silencieuse) ──
      pushDeleteToSheets(id);
    },
    'danger'
  );
}

// ── STATS ──────────────────────────────────────────────────────────
let currentStatsPeriod = 'semaine';

function renderStats() {
  const yearF   = document.getElementById('statsYear')?.value;
  const cm      = getPlayedMatches(yearF);
  const all     = db.matches.filter(m => !yearF || getYear(m.date) === Number(yearF));
  const maxScore = cm.reduce((acc, m) => Math.max(acc, Number(m.sc1||0) + Number(m.sc2||0)), 0);
  const contre  = cm.filter(m => m.type === 'Contre');
  const cV = contre.filter(m => Number(m.sc1) > Number(m.sc2)).length;
  const cN = contre.filter(m => Number(m.sc1) === Number(m.sc2)).length;
  const cD = contre.filter(m => Number(m.sc1) < Number(m.sc2)).length;

  document.getElementById('allStats').innerHTML = [
    { val: cm.length,                        lbl: 'Total Matchs' },
    { val: cm.filter(m=>m.type==='Big Match').length, lbl: 'Big Matchs' },
    { val: cm.filter(m=>m.type==='Contre').length,    lbl: 'Contres' },
    { val: maxScore,                         lbl: 'Record buts/match', cls: 'red' },
    { val: `${cV}V ${cN}N ${cD}D`,           lbl: 'Bilan Contres',    cls: 'gold' },
    { val: all.filter(m=>m.statut==='Match annulé').length, lbl: 'Annulés' },
    { val: all.filter(m=>m.statut==='Match arrêté').length, lbl: 'Arrêtés' },
  ].map(s => `<div class="stat-box ${s.cls||''}"><div class="stat-val">${s.val}</div><div class="stat-lbl">${s.lbl}</div></div>`).join('');

  document.getElementById('teamStatsBody').innerHTML = getTeams(cm).sort((a,b)=>b.scored-a.scored).map(t =>
    `<tr><td style="font-weight:600">${t.name}</td><td>${t.played}</td><td style="color:var(--lime);font-weight:700">${t.scored}</td><td style="color:var(--red)">${t.conceded}</td><td style="color:var(--lime)">${t.wins}</td><td>${t.draws}</td><td style="color:var(--red)">${t.losses}</td></tr>`
  ).join('') || '<tr><td colspan="7" class="empty">Aucune donnée — enregistrez des matchs pour voir les statistiques par équipe</td></tr>';

  renderPeriodStats(currentStatsPeriod);
}

function switchStatsPeriod(period, btn) {
  currentStatsPeriod = period;
  document.querySelectorAll('#statsPeriodTabs .period-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderPeriodStats(period);
}

function renderPeriodStats(period) {
  const yearF = document.getElementById('statsYear')?.value;
  const ps    = getPeriodStats(period, yearF);
  const noData = '<li style="color:var(--text-dim);padding:16px;text-align:center">Aucune donnée pour cette période</li>';

  const topList = (arr, valKey) => arr.length ? arr.map((p, i) => `
    <li>
      <div class="rank-badge ${i < 3 ? 'rank-' + (i+1) : 'rank-n'}">${i+1}</div>
      <div><div class="player-name">${p.name}</div><div class="player-team">${p.team||''}</div></div>
      <div class="player-stat">${p[valKey]}</div>
    </li>`).join('') : noData;

  document.getElementById('topButeursList').innerHTML  = topList(ps.topButeurs,  'goals');
  document.getElementById('topPasseursList').innerHTML = topList(ps.topPasseurs, 'assists');
  document.getElementById('topMvpList').innerHTML      = ps.mvp.length ? ps.mvp.map((p, i) => `
    <li>
      <div class="rank-badge ${i < 3 ? 'rank-' + (i+1) : 'rank-n'}">${i+1}</div>
      <div><div class="player-name">${p.name} ${i===0?'<ion-icon name="star-outline" style="color:var(--gold);font-size:12px"></ion-icon>':''}</div><div class="player-team">${p.team||''}</div></div>
      <div class="player-stat" style="color:var(--purple)">${p.mvpPoints}</div>
    </li>`).join('') : noData;
}

// ── PALMARÈS ───────────────────────────────────────────────────────
let currentPalmPeriod = 'semaine';

function renderPalmares() {
  renderPalmPeriod(currentPalmPeriod);
}

function switchPalmPeriod(period, btn) {
  currentPalmPeriod = period;
  document.querySelectorAll('#palmPeriodTabs .period-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderPalmPeriod(period);
}

function renderPalmPeriod(period) {
  const labels = { semaine:'Semaine en cours', mois:'Mois en cours', trimestre:'Trimestre en cours', annee:'Année en cours' };
  document.getElementById('palmTitle').textContent = 'Victoires — ' + (labels[period] || period);
  const ps = getPeriodStats(period);

  document.getElementById('palmBody').innerHTML = ps.teams.length ? ps.teams.map(t => `
    <tr>
      <td>${labels[period]||period}</td>
      <td style="font-weight:700">${t.name}</td>
      <td style="color:var(--lime);font-family:'Bebas Neue',sans-serif;font-size:18px">${t.wins}</td>
      <td style="color:var(--text-dim)">${t.played}</td>
    </tr>`).join('') : '<tr><td colspan="4" class="empty">Aucune donnée</td></tr>';

  const rl = (arr, key) => arr.length ? arr.slice(0, 5).map((p, i) => `
    <li>
      <div class="rank-badge ${i<3?'rank-'+(i+1):'rank-n'}">${i+1}</div>
      <div><div class="player-name">${p.name}</div><div class="player-team">${p.team||''}</div></div>
      <div class="player-stat">${p[key]}</div>
    </li>`).join('') : '<li style="color:var(--text-dim);padding:16px;text-align:center">Aucune donnée pour cette période</li>';

  document.getElementById('palmBut').innerHTML  = rl(ps.topButeurs,  'goals');
  document.getElementById('palmPass').innerHTML = rl(ps.topPasseurs, 'assists');
  document.getElementById('palmMvp').innerHTML  = ps.mvp.length ? ps.mvp.slice(0,5).map((p,i)=>`
    <li>
      <div class="rank-badge ${i<3?'rank-'+(i+1):'rank-n'}">${i+1}</div>
      <div><div class="player-name">${p.name} ${i===0?'<ion-icon name="star-outline" style="color:var(--gold);font-size:12px"></ion-icon>':''}</div><div class="player-team">${p.team||''}</div></div>
      <div class="player-stat" style="color:var(--purple)">${p.mvpPoints}</div>
    </li>`).join('') : '<li style="color:var(--text-dim);padding:16px;text-align:center">Aucune donnée pour cette période</li>';
}

// ── ADD MATCH FORM ─────────────────────────────────────────────────
function onStatutChange() {
  const s = document.getElementById('fStatut').value;
  const showScore = s === 'Match joué' || s === 'Match arrêté';
  const showMotif = s === 'Match arrêté' || s === 'Match annulé';
  document.getElementById('scoreSection').style.display    = showScore ? 'block' : 'none';
  document.getElementById('buteursSection').style.display  = showScore ? 'block' : 'none';
  document.getElementById('buteurs2Section').style.display = showScore ? 'block' : 'none';
  document.getElementById('motifRow').classList.toggle('show', showMotif);
  updateScoreEntryRule();
}

function resetForm() {
  document.getElementById('fDate').value   = new Date().toISOString().split('T')[0];
  document.getElementById('fHeure').value  = '14:00';
  document.getElementById('fType').value   = 'Big Match';
  document.getElementById('fStatut').value = 'Match joué';
  document.getElementById('fMotif').value  = '';
  document.getElementById('fScore1').value = '';
  document.getElementById('fScore2').value = '';
  document.getElementById('fBut1').value   = '';
  document.getElementById('fBut2').value   = '';
  ['ac1','ac2'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });

  // Toujours remettre le radio Domicile coché par défaut
  const radioHome = document.getElementById('fPositionDomicile');
  if (radioHome) radioHome.checked = true;

  // v1.0.5 — Pour une équipe connectée : pré-remplir automatiquement son équipe
  if (currentUser && currentUser.type === 'equipe') {
    const posChecked = document.querySelector('[name="fPosition"]:checked');
    const posVal = posChecked ? posChecked.value : 'domicile';
    if (posVal === 'domicile') {
      // Position domicile → eq1
      document.getElementById('fEq1').value = currentUser.role;
      document.getElementById('fEq2').value = '';
    } else {
      // Position extérieur → eq2
      document.getElementById('fEq1').value = '';
      document.getElementById('fEq2').value = currentUser.role;
    }
  } else {
    document.getElementById('fEq1').value = '';
    document.getElementById('fEq2').value = '';
  }
  updateScoreEntryRule();
  onStatutChange();
}

/**
 * updateScoreEntryRule()
 * Désactive la saisie du score pour l'équipe extérieure (Rouge).
 * Seule l'équipe domicile (Blanc) peut saisir le score.
 */
function updateScoreEntryRule() {
  if (!currentUser || currentUser.type === 'admin') return;
  const eq1 = document.getElementById('fEq1').value.trim();
  const eq2 = document.getElementById('fEq2').value.trim();
  const teamRole = currentUser.role;
  // Si l'équipe connectée est en extérieur (eq2), bloquer la saisie du score
  const isAway = (eq2 === teamRole && eq1 !== teamRole);
  const scoreRow = document.getElementById('scoreSection');
  const scoreHint = document.getElementById('scoreHintAway');
  if (scoreRow) {
    scoreRow.style.opacity  = isAway ? '.45' : '1';
    scoreRow.style.pointerEvents = isAway ? 'none' : '';
  }
  if (scoreHint) scoreHint.style.display = isAway ? 'block' : 'none';
}

function saveMatch() {
  if (!currentUser || currentUser.type === 'obs') { notify('Permission refusée', true); return; }

  const isAdmin    = currentUser.type === 'admin';
  const isSuperAdmin = currentUser.role === 'Contrôleur';
  const role       = currentUser.role;
  const date       = document.getElementById('fDate').value;
  const heure      = document.getElementById('fHeure').value;
  const type       = document.getElementById('fType').value;
  const statut     = document.getElementById('fStatut').value;
  const motif      = document.getElementById('fMotif').value;
  const eq1        = document.getElementById('fEq1').value.trim();
  const eq2        = document.getElementById('fEq2').value.trim();
  const sc1Raw     = document.getElementById('fScore1').value;
  const sc2Raw     = document.getElementById('fScore2').value;
  const but1       = document.getElementById('fBut1').value.trim();
  const but2       = document.getElementById('fBut2').value.trim();
  const position   = document.querySelector('[name="fPosition"]:checked')?.value || 'domicile';

  // ── Validation de base ──
  if (!date) { notify('La date est obligatoire', true); return; }
  if (!eq1 || !eq2) { notify('Les deux équipes sont obligatoires', true); return; }

  // ── Règle équipe : l'équipe connectée doit être dans le match ──
  if (!isAdmin) {
    const teamRole = role; // nom de l'équipe
    if (eq1 !== teamRole && eq2 !== teamRole) {
      notify('Votre équipe doit participer au match', true);
      return;
    }
  }

  // ── Règle score : seule l'équipe BLANCHE (domicile) saisit le score ──
  const homeTeam  = eq1; // eq1 = domicile
  const awayTeam  = eq2; // eq2 = extérieur
  const hasScore  = statut === 'Match joué' || statut === 'Match arrêté';
  const sc1       = sc1Raw !== '' ? Number(sc1Raw) : 0;
  const sc2       = sc2Raw !== '' ? Number(sc2Raw) : 0;

  if (!isAdmin && hasScore && sc1Raw !== '') {
    // L'équipe rouge (extérieur) ne peut pas saisir le score
    if (role === awayTeam) {
      notify('Seule l\'équipe domicile (Blanc) peut saisir le score', true);
      return;
    }
  }

  // ── Règle délai pour les non-super-admins ──
  if (!isSuperAdmin) {
    const matchDt  = new Date(date + 'T' + (heure || '12:00') + ':00');
    const heuresEcoulees = (Date.now() - matchDt.getTime()) / 3600000;
    if (heuresEcoulees > LOCK_SCORE_H) {
      notify(`Score verrouillé après ${LOCK_SCORE_H}h. Seul le Contrôleur peut modifier.`, true);
      return;
    }
  }

  // ── Traçabilité de la saisie ──
  const now     = Date.now();
  const nowStr  = new Date().toLocaleString('fr-FR');

  const match = {
    id:            db.nextId++,
    date, heure, type, statut, motif,
    eq1, eq2,
    homeTeam:      eq1,
    sc1, sc2,
    but1, but2,
    annee:         getYear(date),
    ts:            now,
    // Traçabilité v1.0.5
    scoredBy:      currentUser.nom,
    scoredByTeam:  role,
    tsScore:       now,
    tsLastUpdate:  now,
    lastUpdateBy:  currentUser.nom
  };

  // Confirmation avant enregistrement (v1.0.6)
  bmmConfirm(
    `Enregistrer le match ${eq1} vs ${eq2} du ${date} ?`,
    () => {
      db.matches.push(match);
      logActivity(`Ajout match : ${eq1} vs ${eq2} — ${date} (saisi par ${currentUser.nom})`);
      save();
      resetForm();
      populateYearSelectors();
      refreshPlayerNames();
      renderAll();
      notify('Match enregistré !');
      const btn = document.getElementById('btnSaveMatch');
      if (btn) { btn.classList.add('pulse'); setTimeout(() => btn.classList.remove('pulse'), 2100); }
      // ── Synchronisation GAS (asynchrone, silencieuse) ──
      pushMatchToSheets(match);
    }
  );
}

function updateTeamsList() {
  const teams = new Set();
  db.matches.forEach(m => { if (m.eq1) teams.add(m.eq1); if (m.eq2) teams.add(m.eq2); });
  const dl = document.getElementById('teamsList');
  if (dl) dl.innerHTML = [...teams].map(t => `<option value="${t}">`).join('');
}


// ── POSITION CHANGEMENT ───────────────────────────────────────────
function onPositionChange() {
  // Réinitialise les équipes selon la nouvelle position choisie
  if (!currentUser || currentUser.type !== 'equipe') return;
  const pos = document.querySelector('[name="fPosition"]:checked')?.value || 'domicile';
  if (pos === 'domicile') {
    document.getElementById('fEq1').value = currentUser.role;
    document.getElementById('fEq2').value = '';
  } else {
    document.getElementById('fEq1').value = '';
    document.getElementById('fEq2').value = currentUser.role;
  }
  updateScoreEntryRule();
}
// ── AUTOCOMPLETE ───────────────────────────────────────────────────
function autocompleteButeurs(inputId, listId) {
  const ta   = document.getElementById(inputId);
  const list = document.getElementById(listId);
  const val  = ta.value;
  const parts = val.split(',');
  const last  = parts[parts.length - 1].trim().replace(/\([^)]*$/, '').trim();
  if (!last) { list.style.display = 'none'; return; }
  const hits = playerNames.filter(n => n.toLowerCase().startsWith(last.toLowerCase()) && n.toLowerCase() !== last.toLowerCase());
  if (!hits.length) { list.style.display = 'none'; return; }
  list.style.display = 'block';
  list.innerHTML = hits.slice(0, 6).map(n =>
    `<div class="autocomplete-item" onclick="pickPlayer('${inputId}','${listId}','${n.replace(/'/g,"\\'")}')"><ion-icon name="person-outline"></ion-icon> ${n}</div>`
  ).join('');
}

function pickPlayer(inputId, listId, name) {
  const ta    = document.getElementById(inputId);
  const parts = ta.value.split(',');
  parts[parts.length - 1] = ' ' + name;
  ta.value = parts.join(',');
  document.getElementById(listId).style.display = 'none';
  ta.focus();
}

// Close autocomplete on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('.form-group')) {
    document.querySelectorAll('.autocomplete-list').forEach(el => el.style.display = 'none');
  }
});

// ── USERS ──────────────────────────────────────────────────────────
function renderUsers() {
  const isCtrl = currentUser?.role === 'Contrôleur';
  document.getElementById('btnAddUser').style.display = isCtrl ? 'inline-flex' : 'none';
  const roleBadge = {
    'Contrôleur':      'badge-ctrl',
    'Sous-Contrôleur': 'badge-sub',
    'Rouge':           'badge-rouge',
    'Blanc':           'badge-blanc',
    'Observateur':     'badge-obs'
  };
  // v1.0.6 — Hiérarchie : peut voir le pw des comptes sous son autorité
  const canSeePw = (u) => {
    if (!isCtrl && currentUser?.role !== 'Sous-Contrôleur') return false;
    if (u.id === currentUser.id) return false;   // pas son propre pw (déjà connu)
    if (isCtrl) return u.role !== 'Contrôleur'; // Contrôleur voit tout sauf autres Contrôleurs
    return u.type === 'equipe' || u.type === 'obs'; // Sous-Contrôleur voit équipes + obs
  };

  document.getElementById('usersBody').innerHTML = db.users.map(u => {
    const showPw = canSeePw(u);
    const pwId   = 'pw_' + u.id;
    return `
    <tr>
      <td>
        <div style="font-weight:600">${u.nom}</div>
        ${u.createdBy ? `<div style="font-size:10px;color:var(--text-dim)">Créé par : ${u.createdBy}</div>` : ''}
      </td>
      <td><span class="badge ${roleBadge[u.role]||'badge-obs'}">${u.role}</span></td>
      <td><span class="badge" style="background:rgba(107,154,120,.12);color:var(--text-dim);border:1px solid var(--border)">${u.type || 'obs'}</span></td>
      <td>
        ${showPw ? `
          <span id="${pwId}" style="letter-spacing:3px;color:var(--text-dim);font-size:12px">••••••</span>
          <button class="btn btn-xs" onclick="togglePwDisplay('${pwId}','${u.password}')" title="Afficher/masquer" style="margin-left:6px;padding:2px 7px;font-size:11px">
            <ion-icon name="eye-outline"></ion-icon>
          </button>` : `<span style="letter-spacing:4px;color:var(--text-dim)">••••••</span>`}
      </td>
      <td style="font-size:11px;color:var(--text-dim)">
        ${u.lastLogin ? u.lastLogin : '<span style="opacity:.45">Jamais connecté</span>'}
      </td>
      <td>${isCtrl && u.id !== currentUser.id ? `<button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})"><ion-icon name="trash-outline"></ion-icon></button>` : '—'}</td>
    </tr>`;
  }).join('');
}

/**
 * togglePwDisplay(spanId, pw)
 * Affiche ou masque le mot de passe dans la liste des utilisateurs.
 */
function togglePwDisplay(spanId, pw) {
  const el = document.getElementById(spanId);
  if (!el) return;
  if (el.dataset.visible === '1') {
    el.textContent = '••••••';
    el.style.letterSpacing = '3px';
    el.dataset.visible = '0';
    // Update icon
    const btn = el.nextElementSibling;
    if (btn) btn.innerHTML = '<ion-icon name="eye-outline"></ion-icon>';
  } else {
    el.textContent = pw || '(vide)';
    el.style.letterSpacing = '1px';
    el.style.color = 'var(--white)';
    el.dataset.visible = '1';
    const btn = el.nextElementSibling;
    if (btn) btn.innerHTML = '<ion-icon name="eye-off-outline"></ion-icon>';
  }
}

function openAddUser() {
  // Populate existing teams in the role dropdown
  const grp = document.getElementById('existingTeamsGroup');
  if (grp) {
    const teams = db.users.filter(u => u.type === 'equipe');
    grp.innerHTML = teams.map(u =>
      `<option value="${u.role}">${u.nom} (${u.role})</option>`
    ).join('');
    if (!teams.length) grp.style.display = 'none';
    else grp.style.display = '';
  }
  document.getElementById('uRole').value = '';
  document.getElementById('customTeamRow').style.display = 'none';
  document.getElementById('addUserCard').style.display = 'block';
}

function onUserRoleChange() {
  const val = document.getElementById('uRole').value;
  document.getElementById('customTeamRow').style.display =
    val === '__new_team__' ? 'block' : 'none';
}

function cancelAddUser() {
  document.getElementById('addUserCard').style.display = 'none';
  document.getElementById('customTeamRow').style.display = 'none';
}

function saveUser() {
  if (!currentUser || currentUser.role !== 'Contrôleur') { notify('Permission refusée', true); return; }
  const nom    = document.getElementById('uNom').value.trim();
  let   role   = document.getElementById('uRole').value;
  const pw     = document.getElementById('uPin').value;

  if (!role) { notify('Sélectionnez un rôle', true); return; }
  if (!nom)  { notify('Le nom est obligatoire', true); return; }

  // Handle "new team" option — use custom team name as role
  if (role === '__new_team__') {
    const customName = document.getElementById('uTeamName')?.value.trim();
    if (!customName) { notify('Entrez un nom d\'équipe', true); return; }
    role = customName;
  }

  if (!pw && role !== 'Observateur') { notify('Mot de passe requis', true); return; }

  // Determine account type from role
  const typeMap = { 'Contrôleur': 'admin', 'Sous-Contrôleur': 'admin', 'Observateur': 'obs' };
  const type    = typeMap[role] || 'equipe';

  db.users.push({
    id:        db.nextUserId++,
    nom, role, password: pw, type,
    createdBy: currentUser.nom,   // v1.0.6 — traçabilité création
    lastLogin: null,              // v1.0.6 — sera rempli à la première connexion
    membres:   type === 'equipe' ? [] : undefined  // v1.0.6 — structure équipe/responsables
  });
  logActivity(`Ajout utilisateur : ${nom} (${role} / ${type})`);
  save();
  cancelAddUser();
  renderUsers();
  populateTeamDropdown(); // refresh login team dropdown
  notify('Utilisateur ajouté');
}

function deleteUser(id) {
  if (!currentUser || currentUser.role !== 'Contrôleur') { notify('Permission refusée', true); return; }
  const u = db.users.find(x => x.id === id);
  if (!u) return;
  bmmConfirm(
    `Supprimer le compte "${u.nom}" (${u.role}) ?
Cette action est irréversible.`,
    () => {
      logActivity(`Suppression utilisateur : ${u.nom}`);
      db.users = db.users.filter(x => x.id !== id);
      save();
      renderUsers();
      populateTeamDropdown();
      notify('Utilisateur supprimé');
    },
    'danger'
  );
}

// ── RÉINITIALISATION DES DONNÉES — v1.0.6 ─────────────────────────
/**
 * resetAllData()
 * Efface tous les matchs, statistiques et journal d'activité.
 * Les comptes utilisateurs sont conservés.
 * Seul le Contrôleur peut effectuer cette opération.
 * Une double confirmation est requise.
 */
function resetAllData() {
  if (!currentUser || currentUser.role !== 'Contrôleur') {
    notify('Seul le Contrôleur peut réinitialiser les données', true);
    return;
  }
  bmmConfirm(
    'Réinitialiser TOUTES les données ?\n\nCela supprimera tous les matchs, statistiques et le journal.\nLes comptes utilisateurs seront conservés.\n\nCette action est IRRÉVERSIBLE.',
    () => {
      bmmConfirm(
        'Êtes-vous ABSOLUMENT certain ?\nTous les matchs enregistrés seront perdus.',
        () => {
          const nom = currentUser.nom;
          db.matches     = [];
          db.activityLog = [];
          db.nextId      = 1;
          save();
          renderAll();
          notify('Données réinitialisées. Partez sur une base propre !');
          // Réactiver le flag pour que la migration ne re-tourne pas
          db.v106Applied = true;
          save();
          // Log AFTER reinit
          logActivity('RÉINITIALISATION COMPLÈTE DES DONNÉES');
          save();
          // ── Synchronisation GAS : vider aussi Google Sheets ──
          pushClearToSheets();
        },
        'danger'
      );
    },
    'danger'
  );
}

// ── FUTURE-READY ID GENERATORS ─────────────────────────────────────
/**
 * generatePlayerId()
 * Returns a 6-character alphanumeric ID tied to registration date.
 * Format: P + YYMMDD-XX  (e.g. P250307A2)
 * Ready for migration to MongoDB/PostgreSQL.
 */
function generatePlayerId() {
  const now = new Date();
  const yy  = String(now.getFullYear()).slice(2);
  const mm  = String(now.getMonth() + 1).padStart(2, '0');
  const dd  = String(now.getDate()).padStart(2, '0');
  const rnd = Math.random().toString(36).slice(2, 4).toUpperCase();
  return `P${yy}${mm}${dd}${rnd}`;
}

/**
 * generateEventId()
 * Returns a unique event ID.  Format:  EVT-YYYY-NNN
 */
function generateEventId() {
  const year = new Date().getFullYear();
  const seq  = String(db.nextEventId++).padStart(3, '0');
  save();
  return `EVT-${year}-${seq}`;
}

// ── HISTORIQUE DES VERSIONS ───────────────────────────────────────
function renderVersionHistory() {
  const el = document.getElementById('versionHistoryBody');
  if (!el) return;
  const history = db.versionHistory || VERSION_HISTORY;
  el.innerHTML = [...history].reverse().map(v => `
    <tr>
      <td><strong style="color:var(--lime)">${v.version}</strong></td>
      <td><span class="badge badge-bm">${v.codename}</span></td>
      <td style="font-size:11px;color:var(--text-dim)">${v.date}</td>
      <td style="font-size:12px">${v.description}</td>
    </tr>`).join('');
}

// ── JOURNAL ────────────────────────────────────────────────────────
function renderLog() {
  document.getElementById('logBody').innerHTML = db.activityLog.length
    ? db.activityLog.map(h => `
        <tr class="hist-row">
          <td style="white-space:nowrap;font-size:12px">${h.ts}</td>
          <td style="font-weight:600">${h.user}</td>
          <td><span class="badge badge-obs">${h.role}</span></td>
          <td class="hist-action">${h.action}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="empty">Aucune activité enregistrée</td></tr>';
}

// ── JOURNAL ───────────────────────────────────────────────────────────
function renderLog() {
  const el = document.getElementById('logBody');
  if (!el) return;
  const log = (db.activityLog || []).slice().reverse().slice(0, 300);
  el.innerHTML = log.length
    ? log.map(e => {
        const d = new Date(e.ts || 0);
        const ds = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        return `<tr><td>${ds}</td><td>${e.role||'—'}</td><td>${e.action||'—'}</td></tr>`;
      }).join('')
    : '<tr><td colspan="3" class="empty">Journal vide</td></tr>';
}

function logActivity(action) {
  if (!db) return;
  if (!db.activityLog) db.activityLog = [];
  db.activityLog.push({ ts: Date.now(), role: currentUser?.role || '—', action });
  if (db.activityLog.length > 300) db.activityLog.splice(0, db.activityLog.length - 300);
  save();
}

function notify(msg, isError = false) {
  const el = document.getElementById('notif');
  if (!el) return;
  el.textContent = msg;
  el.className = 'notif' + (isError ? ' notif-error' : '');
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 3200);
}

// ── BOOT ──────────────────────────────────────────────────────────────
init().then(() => {
  resetForm();
  if (GAS_URL) startSyncWorker();
});
