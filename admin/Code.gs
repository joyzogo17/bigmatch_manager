// ================================================================
//  BIG MATCH MANAGER v1.0.4 — Google Apps Script Backend
//  File: Code.gs
//  Author: Joy ZOGO ABAGA — joyzogo.pro@gmail.com
//
//  HOW TO DEPLOY:
//  1. Open Google Sheets → Extensions → Apps Script
//  2. Paste this entire file into Code.gs
//  3. Run initSpreadsheet() once to create all sheets
//  4. Deploy → New deployment → Web App
//     - Execute as: Me
//     - Who has access: Anyone
//  5. Copy the Web App URL into your frontend config
// ================================================================

// ── SHEET NAMES (do not change once data exists) ──────────────────
const SH_MATCHS   = 'MATCHS';
const SH_JOUEURS  = 'JOUEURS';
const SH_EQUIPES  = 'EQUIPES';
const SH_EVENTS   = 'EVENTS';
const SH_USERS    = 'UTILISATEURS';
const SH_LOG      = 'JOURNAL';

// ── CORS HEADERS ─────────────────────────────────────────────────
function corsOutput(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  // Note: Apps Script Web Apps don't support custom CORS headers directly.
  // Access-Control-Allow-Origin is controlled by the deployment settings.
  // Set access to "Anyone" when deploying to enable cross-origin requests.
}

// ── GET ───────────────────────────────────────────────────────────
/**
 * Handle GET requests.
 * URL params:
 *   action = matches | joueurs | equipes | events | stats | log
 *   annee  = 2025  (optional filter)
 *   equipe = "Rouge"  (optional filter)
 *   limit  = 100  (optional, for log)
 */
function doGet(e) {
  const p      = e.parameter || {};
  const action = p.action || 'matches';

  try {
    let result;
    switch (action) {
      case 'matches':  result = apiGetMatches(p);  break;
      case 'joueurs':  result = apiGetJoueurs(p);  break;
      case 'equipes':  result = apiGetEquipes();   break;
      case 'events':   result = apiGetEvents();    break;
      case 'stats':    result = apiGetStats(p);    break;
      case 'log':      result = apiGetLog(p);      break;
      default:         result = { error: 'Action inconnue', code: 400 };
    }
    return corsOutput(result);
  } catch (err) {
    return corsOutput({ error: err.message, code: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────
/**
 * Handle POST requests.
 * Body JSON: { action, role, data }
 * Actions: addMatch | addJoueur | addEquipe | addEvent | deleteMatch
 */
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action || '';
    const role   = body.role   || 'Observateur';
    const data   = body.data   || {};

    if (!hasWritePermission(role, action)) {
      return corsOutput({ error: 'Permission refusée pour ce rôle', code: 403 });
    }

    let result;
    switch (action) {
      case 'addMatch':    result = apiAddMatch(data, role);    break;
      case 'addJoueur':   result = apiAddJoueur(data, role);   break;
      case 'addEquipe':   result = apiAddEquipe(data, role);   break;
      case 'addEvent':    result = apiAddEvent(data, role);    break;
      case 'deleteMatch': result = apiDeleteMatch(data, role); break;
      default:            result = { error: 'Action inconnue', code: 400 };
    }
    return corsOutput(result);
  } catch (err) {
    return corsOutput({ error: err.message, code: 500 });
  }
}

// ── PERMISSIONS ───────────────────────────────────────────────────
function hasWritePermission(role, action) {
  if (role === 'Observateur') return false;

  // Only Contrôleur can delete matches or manage teams/users
  if (['deleteMatch', 'addEquipe', 'addUser'].includes(action)) {
    return role === 'Contrôleur';
  }

  // Admins and team roles can add/update match data
  const writeRoles = ['Contrôleur', 'Sous-Contrôleur'];
  if (writeRoles.includes(role)) return true;

  // Teams can add match data (e.g. score entry)
  // type === 'equipe' roles are whatever team name is stored in the sheet
  return true; // allow - server-side will apply 24h lock on addMatch
}

// ── HELPERS ───────────────────────────────────────────────────────
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function sheetRows(sheet, headerRow) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = headerRow || data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
    return obj;
  });
}

/**
 * generateId(prefix)
 * Returns a unique ID with date embedded.
 * Format: PREFIX + YYMMDD + random 4 chars
 * Examples: P260307AB12, EVT260307F9, EQ260307C3
 */
function generateId(prefix) {
  const now = new Date();
  const yy  = String(now.getFullYear()).slice(2);
  const mm  = String(now.getMonth() + 1).padStart(2, '0');
  const dd  = String(now.getDate()).padStart(2, '0');
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix || 'ID'}${yy}${mm}${dd}${rnd}`;
}

// ── GET: MATCHES ──────────────────────────────────────────────────
function apiGetMatches(p) {
  const sheet   = getSheet(SH_MATCHS);
  const headers = ['id','date','jour','heure','type','statut','motif',
                   'eq1','eq2','sc1','sc2','but1','but2','annee','verrouille','eventId'];
  let rows = sheetRows(sheet, headers);

  // Optional filters
  if (p.annee)   rows = rows.filter(m => String(m.annee)  === String(p.annee));
  if (p.equipe)  rows = rows.filter(m => m.eq1 === p.equipe || m.eq2 === p.equipe);
  if (p.statut)  rows = rows.filter(m => m.statut === p.statut);
  if (p.eventId) rows = rows.filter(m => m.eventId === p.eventId);

  return { ok: true, count: rows.length, matches: rows };
}

// ── GET: JOUEURS ──────────────────────────────────────────────────
function apiGetJoueurs(p) {
  const sheet   = getSheet(SH_JOUEURS);
  const headers = ['id','nom','equipe','dateNaissance','dateInscription','statut'];
  let rows = sheetRows(sheet, headers);
  if (p.equipe) rows = rows.filter(j => j.equipe === p.equipe);
  return { ok: true, count: rows.length, joueurs: rows };
}

// ── GET: EQUIPES ──────────────────────────────────────────────────
function apiGetEquipes() {
  const headers = ['id','nom','couleur','dateCreation','statut'];
  const rows    = sheetRows(getSheet(SH_EQUIPES), headers);
  return { ok: true, count: rows.length, equipes: rows };
}

// ── GET: EVENTS ───────────────────────────────────────────────────
function apiGetEvents() {
  const headers = ['id','nom','lieu','dateDebut','dateFin','saison','statut'];
  const rows    = sheetRows(getSheet(SH_EVENTS), headers);
  return { ok: true, count: rows.length, events: rows };
}

// ── GET: STATS ────────────────────────────────────────────────────
function apiGetStats(p) {
  const matchResult = apiGetMatches(p);
  const played = matchResult.matches.filter(m => m.statut === 'Match joué');

  const players = {}, teams = {};

  function parseScorers(str) {
    if (!str) return [];
    return String(str).split(',').map(s => {
      const m = s.trim().match(/^(.+?)\s*\((.+?)\)$/);
      return m ? { player: m[1].trim(), passer: m[2].trim() } : { player: s.trim(), passer: null };
    }).filter(x => x.player);
  }

  played.forEach(m => {
    // Teams
    [[m.eq1, Number(m.sc1||0), Number(m.sc2||0)],
     [m.eq2, Number(m.sc2||0), Number(m.sc1||0)]].forEach(([name, scored, conceded]) => {
      if (!name) return;
      if (!teams[name]) teams[name] = { name, played:0, wins:0, draws:0, losses:0, scored:0, conceded:0 };
      teams[name].played++; teams[name].scored += scored; teams[name].conceded += conceded;
      if (scored > conceded) teams[name].wins++;
      else if (scored < conceded) teams[name].losses++;
      else teams[name].draws++;
    });

    // Players
    const accPlayers = (butStr) => {
      parseScorers(butStr).forEach(s => {
        if (!players[s.player]) players[s.player] = { name:s.player, goals:0, assists:0, mvp:0 };
        players[s.player].goals++;  players[s.player].mvp += 3;
        if (s.passer) {
          if (!players[s.passer]) players[s.passer] = { name:s.passer, goals:0, assists:0, mvp:0 };
          players[s.passer].assists++; players[s.passer].mvp += 2;
        }
      });
    };
    accPlayers(m.but1); accPlayers(m.but2);
  });

  const pl = Object.values(players);
  return {
    ok: true,
    matchCount:  played.length,
    topButeurs:  [...pl].sort((a,b) => b.goals   - a.goals).slice(0,10),
    topPasseurs: [...pl].sort((a,b) => b.assists  - a.assists).slice(0,10),
    topMvp:      [...pl].sort((a,b) => b.mvp      - a.mvp).slice(0,10),
    teams:       Object.values(teams).sort((a,b) => b.wins - a.wins)
  };
}

// ── GET: LOG ──────────────────────────────────────────────────────
function apiGetLog(p) {
  const headers = ['timestamp','utilisateur','role','action','detail'];
  let rows = sheetRows(getSheet(SH_LOG), headers).reverse();
  const limit = Number(p.limit) || 100;
  return { ok: true, total: rows.length, log: rows.slice(0, limit) };
}

// ── POST: ADD MATCH ───────────────────────────────────────────────
function apiAddMatch(data, role) {
  // 24-hour lock for non-Contrôleur
  if (role !== 'Contrôleur' && data.date) {
    const dt = new Date(`${data.date}T${data.heure || '12:00'}:00`);
    if ((Date.now() - dt.getTime()) / 3600000 > 24) {
      return { error: 'Match verrouillé (>24h). Seul le Contrôleur peut modifier.', code: 403 };
    }
  }

  const id = data.id || generateId('M');
  getSheet(SH_MATCHS).appendRow([
    id, data.date || '', data.jour || '', data.heure || '',
    data.type || 'Big Match', data.statut || '', data.motif || '',
    data.eq1 || '', data.eq2 || '',
    data.sc1 !== undefined ? Number(data.sc1) : 0,
    data.sc2 !== undefined ? Number(data.sc2) : 0,
    data.but1 || '', data.but2 || '',
    data.annee || new Date().getFullYear(),
    false,
    data.eventId || ''
  ]);
  addLog(role, 'addMatch', `${data.eq1||'?'} vs ${data.eq2||'?'} — ${data.date||'?'}`);
  return { ok: true, id };
}

// ── POST: ADD JOUEUR ──────────────────────────────────────────────
function apiAddJoueur(data, role) {
  const id = data.id || generateId('P');
  getSheet(SH_JOUEURS).appendRow([
    id, data.nom || '', data.equipe || '',
    data.dateNaissance || '',
    new Date().toISOString().split('T')[0],
    data.statut || 'Actif'
  ]);
  addLog(role, 'addJoueur', `${data.nom} (${data.equipe || '?'})`);
  return { ok: true, id };
}

// ── POST: ADD EQUIPE ──────────────────────────────────────────────
function apiAddEquipe(data, role) {
  const id = data.id || generateId('EQ');
  getSheet(SH_EQUIPES).appendRow([
    id, data.nom || '', data.couleur || '',
    new Date().toISOString().split('T')[0],
    data.statut || 'Active'
  ]);
  addLog(role, 'addEquipe', data.nom || '?');
  return { ok: true, id };
}

// ── POST: ADD EVENT ───────────────────────────────────────────────
function apiAddEvent(data, role) {
  const id = data.id || generateId('EVT');
  getSheet(SH_EVENTS).appendRow([
    id, data.nom || '', data.lieu || '',
    data.dateDebut || '', data.dateFin || '',
    data.saison || new Date().getFullYear(),
    data.statut || 'Actif'
  ]);
  addLog(role, 'addEvent', `${data.nom} (${data.saison || '?'})`);
  return { ok: true, id };
}

// ── POST: DELETE MATCH ────────────────────────────────────────────
function apiDeleteMatch(data, role) {
  if (role !== 'Contrôleur') {
    return { error: 'Seul le Contrôleur peut supprimer des matchs', code: 403 };
  }
  const sheet = getSheet(SH_MATCHS);
  const rows  = sheet.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === String(data.id)) {
      sheet.deleteRow(i + 1);
      addLog(role, 'deleteMatch', `ID ${data.id}`);
      return { ok: true };
    }
  }
  return { error: 'Match introuvable', code: 404 };
}

// ── INTERNAL: LOG ─────────────────────────────────────────────────
function addLog(role, action, detail) {
  getSheet(SH_LOG).appendRow([
    new Date().toLocaleString('fr-FR'),
    role, action, detail || ''
  ]);
}

// ── INIT SPREADSHEET ──────────────────────────────────────────────
/**
 * Run this ONCE manually from the Apps Script editor:
 * Tools > Run function > initSpreadsheet
 * Creates all sheets with header rows.
 */
function initSpreadsheet() {
  const sheetDefs = [
    { name: SH_MATCHS,  headers: ['ID','Date','Jour','Heure','Type','Statut','Motif','Equipe1','Equipe2','Score1','Score2','Buteurs1','Buteurs2','Annee','Verrouille','EventID'] },
    { name: SH_JOUEURS, headers: ['ID','Nom','Equipe','DateNaissance','DateInscription','Statut'] },
    { name: SH_EQUIPES, headers: ['ID','Nom','Couleur','DateCreation','Statut'] },
    { name: SH_EVENTS,  headers: ['ID','Nom','Lieu','DateDebut','DateFin','Saison','Statut'] },
    { name: SH_USERS,   headers: ['ID','Nom','Role','Type','DateCreation'] },
    { name: SH_LOG,     headers: ['Timestamp','Role','Action','Detail'] }
  ];

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  sheetDefs.forEach(def => {
    let ws = ss.getSheetByName(def.name);
    if (!ws) ws = ss.insertSheet(def.name);

    // Only write headers if sheet is empty
    const firstCell = ws.getRange(1, 1).getValue();
    if (!firstCell) {
      ws.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
      ws.getRange(1, 1, 1, def.headers.length)
        .setBackground('#0A5C2E')
        .setFontColor('#F8FAF5')
        .setFontWeight('bold')
        .setFontSize(11);
      ws.setFrozenRows(1);
      ws.setColumnWidth(1, 140);
    }
  });

  SpreadsheetApp.getUi().alert('Big Match Manager — Feuilles initialisees avec succes !');
}
