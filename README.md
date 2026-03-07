# ⚽ Big Match Manager

Gestionnaire de championnat de quartier — application web 100% front-end (HTML + CSS + JS).

---

## 📁 Structure du projet

```
bigmatch-manager-github/
│
├── index.html   → Structure HTML de l'application
├── style.css    → Tous les styles (dark theme football)
├── script.js    → Logique complète (auth, matchs, stats, MVP…)
├── data.json    → Données initiales chargées au premier lancement
└── README.md    → Ce fichier
```

---

## 🚀 Lancement

Ouvrir `index.html` dans un navigateur moderne.

> ⚠️ Pour que `data.json` soit chargé correctement, l'application doit être servie via un serveur local (pas en `file://`).

```bash
# Option 1 — Python
python3 -m http.server 8080

# Option 2 — Node.js
npx serve .

# Option 3 — VS Code
# Installer l'extension "Live Server" puis cliquer sur "Go Live"
```

Ouvrir ensuite `http://localhost:8080` dans le navigateur.

---

## 🔐 Rôles et accès

| Rôle        | Mot de passe | Permissions |
|-------------|-------------|-------------|
| Contrôleur  | `Malaga2025!` | Accès complet, suppression, journal, gestion comptes |
| Rouge       | `Rouge2025`   | Ajouter matchs, saisir buteurs/passeurs |
| Blanc       | `BlancFC@`    | Ajouter matchs, saisir buteurs/passeurs |
| Observateur | *(aucun)*     | Consultation uniquement |

**Règles de sécurité :**
- Rouge et Blanc ne peuvent **pas** supprimer un match.
- Les matchs de **plus de 24 heures** sont verrouillés pour Rouge/Blanc.
- Seul le Contrôleur peut supprimer ou modifier des matchs verrouillés.

---

## ✨ Fonctionnalités

### Tableau de bord
- Dernier match avec score, buteurs, passeurs et **Homme du Match** 👑
- Highlights de la semaine : meilleur buteur, passeur, MVP, équipe dominante
- Statistiques rapides globales
- Graphiques : top buteurs, passeurs, buts par équipe, matchs par semaine

### Saisie des matchs
- Formulaire complet : date, heure, type (Big Match / Contre), statut, score, buteurs, passeurs
- **Autocomplétion** des noms de joueurs existants
- Format buteurs : `Joueur (Passeur), Joueur2 (Passeur2)`

### Historique
- Tableau complet avec filtre par année, recherche libre et filtre par statut
- Affichage MVP par match
- Indicateur de verrouillage 🔒

### Statistiques
- Filtres par période : **semaine / mois / trimestre / année**
- Classement buteurs, passeurs, MVP
- Bilan par équipe (V/N/D, buts marqués/encaissés)

### Palmarès
- Historique des victoires par équipe selon la période
- Top buteurs, passeurs et MVP de la période

### Gestion des comptes *(Contrôleur uniquement)*
- Créer / supprimer des utilisateurs
- Rôles : Contrôleur, Rouge, Blanc, Observateur

### Journal *(Contrôleur uniquement)*
- Toutes les actions enregistrées : connexions, ajouts, suppressions

---

## 💾 Données

Les données sont stockées dans `localStorage` du navigateur.  
Au premier lancement, `data.json` est chargé comme données initiales.

Pour réinitialiser : effacer le `localStorage` dans les outils développeur (`Application > Storage > Clear`).

---

## 🎨 Stack technique

- HTML5 sémantique
- CSS3 custom properties (dark theme vert terrain)
- JavaScript vanilla ES6+
- Police : [Outfit](https://fonts.google.com/specimen/Outfit) + [Bebas Neue](https://fonts.google.com/specimen/Bebas+Neue)
- Pas de framework, pas de dépendance externe

---

## 📱 Responsive

Interface adaptée pour smartphone, tablette et desktop.

---

*by Joy Zogo*
