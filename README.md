# Big Match Manager v1.0.4

**Plateforme de gestion de matchs, scores et statistiques de championnat de quartier.**

> Developed by **Joy ZOGO ABAGA** — joyzogo.pro@gmail.com · +241 77866740

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Roles & Permissions](#roles--permissions)
3. [Key Features](#key-features)
4. [Local Setup](#local-setup)
5. [Google Apps Script Integration](#google-apps-script-integration)
6. [API Reference](#api-reference)
7. [ID System](#id-system)
8. [Roadmap](#roadmap)

---

## Project Structure

```
bigmatch-manager/
├── index.html                  ← Main application (dashboard, stats, history)
├── login.html                  ← Main login page (3 access choices)
├── login-equipe.html           ← Team login (dropdown + password)
├── data.json                   ← Initial data structure (empty)
│
├── admin/
│   ├── admin-login.html        ← Administrator login (Contrôleur / Sous-Contrôleur)
│   └── Code.gs                 ← Google Apps Script backend
│
├── assets/
│   ├── css/
│   │   ├── style.css           ← Main app styles (dark football theme)
│   │   └── login.css           ← Login pages shared styles
│   ├── js/
│   │   ├── script.js           ← Main app logic (all CRUD, stats, charts)
│   │   └── shared.js           ← Shared login utilities
│   └── icons/
│       └── (place Ionicons local fallback here)
```

---

## Roles & Permissions

| Role | Access Level | Can Add Matches | Can Delete | Manage Users | View Log |
|---|---|---|---|---|---|
| **Contrôleur** | Super Admin | Yes — all | Yes | Yes | Yes |
| **Sous-Contrôleur** | Admin (limited) | Yes — recent only (< 24h) | No | No | Yes |
| **Équipe** | Team | Yes — own matches (< 24h) | No | No | No |
| **Observateur** | Read only | No | No | No | No |

**Notes:**
- Matches older than 24 hours are automatically locked for non-Contrôleur users
- Each team can only access and modify their own match data
- The Contrôleur has override access to all locked matches

---

## Key Features

- **3-panel login system** — dedicated pages for admin, teams, and public access
- **Dynamic border colours** — accent colours change by role using CSS hex/RGB variables
- **Match management** — add, edit, delete matches with score and scorer tracking
- **Statistics** — per-period stats (week/month/quarter/year), MVP ranking, top scorers, top assisters
- **History** — searchable, filterable match history with lock indicators
- **Palmarès** — leaderboards by period
- **User management** — add/remove users with dynamic team creation
- **Activity journal** — full audit log of all actions
- **Data export** — download full DB as `data.json`
- **Ionicons integration** — professional icon set via CDN (no emojis in UI)
- **Responsive design** — works on mobile, tablet, and desktop
- **Future-ready IDs** — alphanumeric IDs with date embedding for MongoDB/PostgreSQL migration

---

## Local Setup

### Requirements
- A modern browser (Chrome, Firefox, Edge, Safari)
- A local HTTP server (required because `localStorage` works over HTTP but not file://)

### Quick Start

**Option A — Python (recommended):**
```bash
cd bigmatch-manager
python3 -m http.server 8080
```
Then open: **http://localhost:8080/login.html**

**Option B — Node.js:**
```bash
npx serve .
```

**Option C — VS Code:**
Install the **Live Server** extension, right-click `login.html` → *Open with Live Server*.

### First Run
On first load, the app initialises with clean empty data. The Contrôleur account is pre-created with a default password set during setup. Use the Contrôleur account to create teams, add users, and begin entering matches.

---

## Google Apps Script Integration

This guide explains how to connect Big Match Manager to a **Google Sheet** as a real-time database using Google Apps Script as a REST API.

### Why Google Apps Script?

- Free hosting with a Google account
- Automatic HTTPS endpoint
- Direct read/write to Google Sheets
- No server infrastructure required

### Step-by-Step Deployment

#### Step 1 — Create a Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com)
2. Create a new spreadsheet
3. Name it: **BigMatch Manager Data**
4. Note the spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

#### Step 2 — Open Apps Script

1. In the spreadsheet, click **Extensions → Apps Script**
2. The script editor opens with a default `Code.gs` file

#### Step 3 — Add the Backend Code

1. Delete all content in `Code.gs`
2. Copy the entire contents of `admin/Code.gs` from this repository
3. Paste it into the editor
4. Click **Save** (Ctrl+S / Cmd+S)

#### Step 4 — Initialise the Spreadsheet

1. In the top toolbar, select the function `initSpreadsheet` from the function dropdown
2. Click **Run** (play button)
3. When prompted, click **Review permissions → Allow**
4. You should see an alert: *"Feuilles initialisées avec succès !"*
5. Go back to your Google Sheet — you'll see 6 new sheets created:
   - MATCHS, JOUEURS, EQUIPES, EVENTS, UTILISATEURS, JOURNAL

#### Step 5 — Deploy as Web App

1. Click **Deploy → New deployment**
2. Click the gear icon next to "Type" and select **Web app**
3. Set the following options:
   - **Description:** Big Match Manager API v1.0.4
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy**
5. Click **Authorize access** and log in with your Google account
6. Copy the **Web App URL** — it looks like:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```

#### Step 6 — Configure the Frontend

Open `assets/js/script.js` and add this constant near the top (after the DB_KEY line):

```javascript
const GAS_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
```

Then use it in the sync functions (see API Reference below).

#### Step 7 — Test the Connection

Open your browser and visit:
```
https://script.google.com/macros/s/YOUR_ID/exec?action=matches
```

You should receive:
```json
{ "ok": true, "count": 0, "matches": [] }
```

#### Step 8 — Updating the Deployment

When you modify `Code.gs`:
1. Click **Deploy → Manage deployments**
2. Click the pencil icon on your deployment
3. Set version to **"New version"**
4. Click **Deploy**

> **Important:** Every time you modify and redeploy, the URL stays the same — no frontend changes needed.

---

## API Reference

### Base URL
```
https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec
```

### GET Endpoints

| Action | URL | Description |
|---|---|---|
| Get matches | `?action=matches` | All matches |
| Filter by year | `?action=matches&annee=2025` | Matches in 2025 |
| Filter by team | `?action=matches&equipe=Rouge` | Matches for Rouge |
| Get players | `?action=joueurs` | All players |
| Get teams | `?action=equipes` | All teams |
| Get events | `?action=events` | All events |
| Get statistics | `?action=stats` | Computed stats (scorers, teams, MVP) |
| Get log | `?action=log&limit=50` | Activity journal (last 50 entries) |

### POST Endpoints

All POST requests use JSON body:

```javascript
// Example: Add a match
const response = await fetch(GAS_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'addMatch',
    role:   'Contrôleur',   // required for permission check
    data: {
      date:   '2025-03-07',
      heure:  '15:00',
      type:   'Big Match',
      statut: 'Match joué',
      eq1:    'Rouge',
      eq2:    'Blanc',
      sc1:    3,
      sc2:    1,
      but1:   'Dibala (Ngoma), Mboyo',
      but2:   'Kanda',
      annee:  2025
    }
  })
});
const result = await response.json();
// { ok: true, id: "M260307AB12" }
```

| Action | Required fields | Who can use |
|---|---|---|
| `addMatch` | date, eq1, eq2, statut | Contrôleur, Sous-Contrôleur, Équipe |
| `addJoueur` | nom, equipe | Contrôleur, Sous-Contrôleur |
| `addEquipe` | nom | Contrôleur only |
| `addEvent` | nom, saison | Contrôleur, Sous-Contrôleur |
| `deleteMatch` | id | Contrôleur only |

### Error Responses

```json
{ "error": "Permission refusée pour ce rôle", "code": 403 }
{ "error": "Match verrouillé (>24h)", "code": 403 }
{ "error": "Match introuvable", "code": 404 }
```

---

## ID System

All entities use alphanumeric IDs with the registration date embedded for traceability and future database migration.

| Entity | Format | Example |
|---|---|---|
| Match | `M` + YYMMDD + 4 random chars | `M260307AB12` |
| Player | `P` + YYMMDD + 4 random chars | `P260307C4F9` |
| Team | `EQ` + YYMMDD + 4 random chars | `EQ260307D2` |
| Event | `EVT` + YYMMDD + 4 random chars | `EVT260307E7` |

These IDs are:
- Unique across sessions
- Traceable to creation date
- Compatible with MongoDB, PostgreSQL, and MySQL primary keys
- Ready for UUID migration if needed

---

## Roadmap

### v1.0.4 (current)
- 3-panel modular login (Admin / Team / Observer)
- Professional icons via Ionicons CDN
- Dynamic accent border colours
- Session-based auth across pages
- Google Apps Script backend

### v1.1.0 (planned)
- Real-time sync with Google Sheets via GAS API
- Push notification for disputed match edits
- Player photo upload

### v1.4.0 (planned)
- Multi-event support (separate championships, tournaments)
- Neighbourhood / stadium / city metadata
- Player profiles with statistics history
- Internal social network (player comments, match reactions)
- Geolocation for match venues

### Future migrations
- MongoDB or PostgreSQL backend
- PHP/REST API or Node.js backend
- Mobile app (React Native or Flutter)

---

## Contact

**Joy ZOGO ABAGA**
- Email: [joyzogo.pro@gmail.com](mailto:joyzogo.pro@gmail.com)
- Phone: +241 77866740
- WhatsApp: [wa.me/24177866740](https://wa.me/24177866740)
- Facebook: [facebook.com](https://www.facebook.com)
- LinkedIn: [linkedin.com](https://www.linkedin.com)
- GitHub: [github.com](https://github.com)
