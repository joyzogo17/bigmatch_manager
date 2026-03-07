/* ================================================================
   BIG MATCH MANAGER — script.js
   ================================================================ */

'use strict';

// ── CONSTANTS ──────────────────────────────────────────────────────
const JOURS = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
const MOIS  = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
const DB_KEY = 'bigMatchDB';

// ── STATE ──────────────────────────────────────────────────────────
let db          = null;
let currentUser = null;
let loginTarget = null;
let playerNames = [];

// ── INIT ───────────────────────────────────────────────────────────
async function init() {
  db = loadDB();
  if (!db) {
    // Load from data.json on first run
    try {
      const res  = await fetch('data.json');
      const json = await res.json();
      db = json;
      save();
    } catch {
      db = defaultDB();
      save();
    }
  }
  buildLogin();
}

function defaultDB() {
  return {
    matches: [], users: [
      { id:1, nom:'Contrôleur', role:'Contrôleur', password:'Malaga2025!' },
      { id:2, nom:'Rouge',      role:'Rouge',       password:'Rouge2025'   },
      { id:3, nom:'Blanc',      role:'Blanc',       password:'BlancFC@'    },
      { id:4, nom:'Observateur',role:'Observateur', password:''             }
    ],
    activityLog: [], nextId: 1, nextUserId: 5
  };
}

function loadDB() {
  try { return JSON.parse(localStorage.getItem(DB_KEY)); } catch { return null; }
}

function save() {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
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

// ── MATCH LOCK ─────────────────────────────────────────────────────
function isLocked(match) {
  if (!match.date) return false;
  const d = new Date(match.date + 'T' + (match.heure || '12:00') + ':00');
  return (Date.now() - d.getTime()) / 3600000 > 24;
}

// ── LOGIN ──────────────────────────────────────────────────────────
function buildLogin() {
  // role buttons are static HTML, nothing to build dynamically
}

function selectRole(role) {
  if (role === 'Observateur') {
    completeLogin({ id: 4, nom: 'Observateur', role: 'Observateur' });
    return;
  }
  loginTarget = db.users.find(u => u.role === role) || { nom: role, role };
  document.getElementById('roleSelectionDiv').style.display = 'none';
  document.getElementById('pwSection').style.display        = 'block';
  document.getElementById('pwTitle').textContent            = 'Mot de passe — ' + role;
  document.getElementById('pwInput').value                  = '';
  setTimeout(() => document.getElementById('pwInput').focus(), 80);
}

function cancelLogin() {
  document.getElementById('roleSelectionDiv').style.display = 'block';
  document.getElementById('pwSection').style.display        = 'none';
}

function checkPassword() {
  const pw = document.getElementById('pwInput').value;
  const user = db.users.find(u => u.role === loginTarget.role && u.password === pw);
  if (user) {
    completeLogin(user);
  } else {
    notify('Mot de passe incorrect', true);
    document.getElementById('pwInput').value = '';
    document.getElementById('pwInput').focus();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pwInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') checkPassword();
  });
});

function completeLogin(user) {
  currentUser = user;
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('userName').textContent  = user.nom;
  document.getElementById('userRole').textContent  = user.role;
  const roleClass = { 'Contrôleur': 'role-ctrl', 'Rouge': 'role-rouge', 'Blanc': 'role-blanc', 'Observateur': 'role-obs' };
  document.getElementById('roleDot').className     = 'role-dot ' + (roleClass[user.role] || 'role-obs');
  applyPermissions();
  populateYearSelectors();
  refreshPlayerNames();
  renderAll();
  logActivity('Connexion');
  notify('Bienvenue, ' + user.nom + ' !');
}

function logout() {
  logActivity('Déconnexion');
  save();
  currentUser = null;
  document.getElementById('loginOverlay').style.display  = 'flex';
  document.getElementById('pwSection').style.display     = 'none';
  document.getElementById('roleSelectionDiv').style.display = 'block';
}

function applyPermissions() {
  const role   = currentUser.role;
  const canAdd = role === 'Contrôleur' || role === 'Rouge' || role === 'Blanc';
  const isCtrl = role === 'Contrôleur';
  document.getElementById('navAdd').style.display   = canAdd ? 'block' : 'none';
  document.getElementById('navUsers').style.display = isCtrl ? 'block' : 'none';
  document.getElementById('navLog').style.display   = isCtrl ? 'block' : 'none';
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
  if (yd) yd.textContent = '📅 ' + years[0];
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
    cont.innerHTML = '<div class="last-match-hero"><div class="empty"><div class="e-icon">⚽</div>Aucun match joué</div></div>';
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
    `<div class="lm-scorer-item">⚽ ${s.player}${s.passer ? ` <span class="passer">(${s.passer})</span>` : ''}${s.player === mvp ? ' 👑' : ''}</div>`
  ).join('');

  cont.innerHTML = `
    <div class="last-match-hero">
      <div class="lm-label">⚡ Dernier Match — ${formatDate(m.date)} ${m.heure}</div>
      <div class="lm-teams">
        <div class="lm-team left">${m.eq1}</div>
        <div class="lm-score">${sc1} — ${sc2}</div>
        <div class="lm-team right">${m.eq2}</div>
      </div>
      <div class="lm-winner">
        🏆 Gagnant : <strong>${winner}</strong>
        ${mvp ? ` &nbsp;| 👑 Homme du Match : <span class="lm-mvp">${mvp}</span>` : ''}
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
  document.getElementById('hlTopButSem').textContent  = ps.topButeurs[0]  ? `${ps.topButeurs[0].name} (${ps.topButeurs[0].goals} ⚽)` : '—';
  document.getElementById('hlTopPassSem').textContent = ps.topPasseurs[0] ? `${ps.topPasseurs[0].name} (${ps.topPasseurs[0].assists} 🎯)` : '—';
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
    { val: topBut  ? topBut.goals      : 0,    lbl: topBut  ? '⭐ ' + topBut.name  : 'Meilleur Buteur',  cls: 'gold' },
    { val: topPass ? topPass.assists   : 0,    lbl: topPass ? '🎯 ' + topPass.name : 'Meilleur Passeur' },
    { val: topMvp  ? topMvp.mvpPoints  : 0,    lbl: topMvp  ? '👑 ' + topMvp.name  : 'MVP',               cls: 'gold' },
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
      <td>${mvp ? `<span class="mvp-badge">👑 ${mvp}</span>` : '—'}</td>
      <td>${locked ? '<span class="lock-badge">🔒</span>' : '<span style="color:var(--lime);font-size:10px">✓</span>'}</td>
      <td>${canDel ? `<button class="btn btn-danger btn-sm" onclick="deleteMatch(${m.id})">🗑</button>` : '—'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="12" class="empty">Aucun match trouvé</td></tr>';
}

function deleteMatch(id) {
  if (!currentUser || currentUser.role !== 'Contrôleur') { notify('Seul le Contrôleur peut supprimer', true); return; }
  const m = db.matches.find(x => x.id === id);
  if (!m || !confirm('Supprimer ce match ?')) return;
  logActivity(`Suppression match : ${m.eq1||'?'} vs ${m.eq2||'?'} — ${m.date}`);
  db.matches = db.matches.filter(x => x.id !== id);
  save();
  renderHistory();
  renderDashboard();
  notify('Match supprimé');
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
  ).join('') || '<tr><td colspan="7" class="empty">—</td></tr>';

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

  const topList = (arr, valKey) => arr.map((p, i) => `
    <li>
      <div class="rank-badge ${i < 3 ? 'rank-' + (i+1) : 'rank-n'}">${i+1}</div>
      <div><div class="player-name">${p.name}</div><div class="player-team">${p.team||''}</div></div>
      <div class="player-stat">${p[valKey]}</div>
    </li>`).join('') || '<li style="color:var(--text-dim);padding:12px">Pas de données</li>';

  document.getElementById('topButeursList').innerHTML  = topList(ps.topButeurs,  'goals');
  document.getElementById('topPasseursList').innerHTML = topList(ps.topPasseurs, 'assists');
  document.getElementById('topMvpList').innerHTML      = ps.mvp.map((p, i) => `
    <li>
      <div class="rank-badge ${i < 3 ? 'rank-' + (i+1) : 'rank-n'}">${i+1}</div>
      <div><div class="player-name">${p.name} ${i===0?'👑':''}</div><div class="player-team">${p.team||''}</div></div>
      <div class="player-stat" style="color:var(--purple)">${p.mvpPoints}</div>
    </li>`).join('') || '<li style="color:var(--text-dim);padding:12px">Pas de données</li>';
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

  const rl = (arr, key) => arr.slice(0, 5).map((p, i) => `
    <li>
      <div class="rank-badge ${i<3?'rank-'+(i+1):'rank-n'}">${i+1}</div>
      <div><div class="player-name">${p.name}</div><div class="player-team">${p.team||''}</div></div>
      <div class="player-stat">${p[key]}</div>
    </li>`).join('') || '<li style="color:var(--text-dim);padding:12px">Aucune donnée</li>';

  document.getElementById('palmBut').innerHTML  = rl(ps.topButeurs,  'goals');
  document.getElementById('palmPass').innerHTML = rl(ps.topPasseurs, 'assists');
  document.getElementById('palmMvp').innerHTML  = ps.mvp.slice(0,5).map((p,i)=>`
    <li>
      <div class="rank-badge ${i<3?'rank-'+(i+1):'rank-n'}">${i+1}</div>
      <div><div class="player-name">${p.name} ${i===0?'👑':''}</div><div class="player-team">${p.team||''}</div></div>
      <div class="player-stat" style="color:var(--purple)">${p.mvpPoints}</div>
    </li>`).join('') || '<li style="color:var(--text-dim);padding:12px">Aucune donnée</li>';
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
}

function resetForm() {
  document.getElementById('fDate').value   = new Date().toISOString().split('T')[0];
  document.getElementById('fHeure').value  = '14:00';
  document.getElementById('fType').value   = 'Big Match';
  document.getElementById('fStatut').value = 'Match joué';
  document.getElementById('fMotif').value  = '';
  document.getElementById('fEq1').value    = '';
  document.getElementById('fEq2').value    = '';
  document.getElementById('fScore1').value = '';
  document.getElementById('fScore2').value = '';
  document.getElementById('fBut1').value   = '';
  document.getElementById('fBut2').value   = '';
  ['ac1','ac2'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  onStatutChange();
}

function saveMatch() {
  if (!currentUser || currentUser.role === 'Observateur') { notify('Permission refusée', true); return; }

  const role   = currentUser.role;
  const date   = document.getElementById('fDate').value;
  const heure  = document.getElementById('fHeure').value;
  const type   = document.getElementById('fType').value;
  const statut = document.getElementById('fStatut').value;
  const motif  = document.getElementById('fMotif').value;
  const eq1    = document.getElementById('fEq1').value.trim();
  const eq2    = document.getElementById('fEq2').value.trim();
  const sc1    = document.getElementById('fScore1').value;
  const sc2    = document.getElementById('fScore2').value;
  const but1   = document.getElementById('fBut1').value.trim();
  const but2   = document.getElementById('fBut2').value.trim();

  if (!date) { notify('La date est obligatoire', true); return; }

  // Rouge/Blanc : check the match date isn't older than 24h
  if (role !== 'Contrôleur') {
    const matchDt = new Date(date + 'T' + (heure || '12:00') + ':00');
    if ((Date.now() - matchDt.getTime()) / 3600000 > 24) {
      notify('Match verrouillé (>24h). Seul le Contrôleur peut modifier.', true);
      return;
    }
  }

  const match = {
    id: db.nextId++, date, heure, type, statut, motif, eq1, eq2,
    sc1: sc1 !== '' ? Number(sc1) : 0,
    sc2: sc2 !== '' ? Number(sc2) : 0,
    but1, but2, annee: getYear(date), ts: Date.now()
  };

  db.matches.push(match);
  logActivity(`Ajout match : ${eq1 || '?'} vs ${eq2 || '?'} — ${date}`);
  save();
  resetForm();
  populateYearSelectors();
  refreshPlayerNames();
  renderAll();
  notify('✅ Match enregistré !');
  const btn = document.getElementById('btnSaveMatch');
  btn.classList.add('pulse');
  setTimeout(() => btn.classList.remove('pulse'), 2100);
}

function updateTeamsList() {
  const teams = new Set();
  db.matches.forEach(m => { if (m.eq1) teams.add(m.eq1); if (m.eq2) teams.add(m.eq2); });
  const dl = document.getElementById('teamsList');
  if (dl) dl.innerHTML = [...teams].map(t => `<option value="${t}">`).join('');
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
    `<div class="autocomplete-item" onclick="pickPlayer('${inputId}','${listId}','${n.replace(/'/g,"\\'")}')">👤 ${n}</div>`
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
  const roleBadge = { 'Contrôleur':'badge-ctrl','Rouge':'badge-rouge','Blanc':'badge-blanc','Observateur':'badge-obs' };
  document.getElementById('usersBody').innerHTML = db.users.map(u => `
    <tr>
      <td style="font-weight:600">${u.nom}</td>
      <td><span class="badge ${roleBadge[u.role]||'badge-obs'}">${u.role}</span></td>
      <td style="letter-spacing:4px;color:var(--text-dim)">••••••</td>
      <td>${isCtrl && u.id !== currentUser.id ? `<button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})">🗑</button>` : '—'}</td>
    </tr>`).join('');
}

function openAddUser()   { document.getElementById('addUserCard').style.display = 'block'; }
function cancelAddUser() { document.getElementById('addUserCard').style.display = 'none'; }

function saveUser() {
  if (!currentUser || currentUser.role !== 'Contrôleur') { notify('Permission refusée', true); return; }
  const nom  = document.getElementById('uNom').value.trim();
  const role = document.getElementById('uRole').value;
  const pw   = document.getElementById('uPin').value;
  if (!nom || !pw) { notify('Nom et mot de passe requis', true); return; }
  db.users.push({ id: db.nextUserId++, nom, role, password: pw });
  logActivity(`Ajout utilisateur : ${nom} (${role})`);
  save();
  cancelAddUser();
  renderUsers();
  notify('Utilisateur ajouté');
}

function deleteUser(id) {
  if (!currentUser || currentUser.role !== 'Contrôleur') { notify('Permission refusée', true); return; }
  const u = db.users.find(x => x.id === id);
  if (!u || !confirm('Supprimer cet utilisateur ?')) return;
  logActivity(`Suppression utilisateur : ${u.nom}`);
  db.users = db.users.filter(x => x.id !== id);
  save();
  renderUsers();
  notify('Utilisateur supprimé');
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

// ── BOOT ───────────────────────────────────────────────────────────
init().then(() => resetForm());
