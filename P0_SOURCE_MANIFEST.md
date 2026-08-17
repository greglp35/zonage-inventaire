# P0 Source Promotion — AJI Zonage Inventaire

Branche de travail : `p0/source-bbccdd-security-v3.3.3`

Objectif : rendre les patterns critiques auditables avant toute promotion sur `main`, sans casser le GitHub Pages V3.2 actuellement publié.

## Gates déjà validées localement

- package : PASS
- services stockage/scanner : PASS
- sync service historique : PASS technique
- E2E métier : PASS
- 2 320 articles fixture synthétique
- 0 erreur JavaScript
- export XLSX : PASS
- restauration état : PASS
- inventaire annuel multi-emplacement : PASS
- préparation client : PASS

Ces résultats ne valent pas validation du nouveau P0.2 tant que sa gate navigateur dédiée n'est pas PASS.

## Décisions P0

1. `BBCCDD` est la valeur TFI canonique persistée et synchronisée.
2. `BB-CC-DD` n'est qu'un format d'affichage terrain.
3. Les anciennes valeurs `01-02-03` sont normalisées vers `010203` à la lecture.
4. La clé terminal de synchronisation ne doit plus être persistée dans `localStorage` ; elle reste en `sessionStorage`.
5. CORS wildcard interdit en production ; allowlist via `AJI_ALLOWED_ORIGINS`.
6. Les IDs Airtable et la base Airtable sortent du code et passent en variables d'environnement Vercel.
7. P0.2 sépare `entities`, `outbox`, `tombstones` et `meta` dans IndexedDB.
8. Une opération reste dans l'outbox jusqu'à ACK explicite ; `opId` et `eventId` sont idempotents.
9. Une suppression hors ligne produit un tombstone versionné et une opération `delete`.
10. La résolution générique de conflit est déterministe : `revision` > `updatedAt` > tie-break stable ; aucun merge champ par champ implicite.
11. Aucun merge vers `main` avant fermeture des gates P0 pertinentes, dont la recette Android/HTTPS finale.

## Sources ajoutées dans cette branche

- `source-p0/assets/js/services/tfi-location.service.js`
- `source-p0/assets/js/services/storage.service.js`
- `source-p0/assets/js/services/scanner.service.js`
- `source-p0/assets/js/services/pwa.service.js`
- `source-p0/assets/js/services/sync.service.js`
- `source-p0/assets/js/services/local-data.service.js`
- `source-p0/api/aji-sync.js`
- `source-p0/p0-smoke.html`
- `source-p0/p0-outbox-smoke.html`
- `source-p0/p0-outbox-restart.html`
- `source-p0/docs/P0_BBCCDD_SECURITY.md`
- `source-p0/docs/P0_2_LOCAL_DATA_OUTBOX.md`
- `.github/workflows/p02-browser-gate.yml`

## Statut P0.2 — Données locales / Outbox

**En recette.**

La gate CI utilise Chrome headless sans dépendance npm dans le runtime de l'application. Elle vérifie : syntaxe JS, smoke test zéro-build, 20 opérations persistées, déduplication opId/eventId, mutation locale idempotente, tombstones, conflits déterministes, puis fermeture/réouverture du navigateur avec le même profil pour prouver la persistance IndexedDB.

Le service historique `sync.service.js` conserve encore son mécanisme de checkpoint séparé. Il ne doit pas être considéré comme l'outbox métier P0.2 ; le raccord réseau de l'outbox locale appartient à P0.4.
