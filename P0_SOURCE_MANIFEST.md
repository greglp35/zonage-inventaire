# P0 Source Promotion — AJI Zonage Inventaire

Branche de travail : `p0/source-bbccdd-security-v3.3.3`

Objectif : rendre les patterns critiques auditable avant toute promotion sur `main`, sans casser le GitHub Pages V3.2 actuellement publié.

## Gates validées localement

- package : PASS
- services stockage/scanner : PASS
- sync service : PASS
- E2E : PASS
- 2 320 articles fixture synthétique
- 0 erreur JavaScript
- export XLSX : PASS
- restauration état : PASS
- inventaire annuel multi-emplacement : PASS
- préparation client : PASS

## Décisions P0

1. `BBCCDD` est la valeur TFI canonique persistée et synchronisée.
2. `BB-CC-DD` n'est qu'un format d'affichage terrain.
3. Les anciennes valeurs `01-02-03` sont normalisées vers `010203` à la lecture.
4. La clé terminal de synchronisation ne doit plus être persistée dans `localStorage` ; elle reste en `sessionStorage`.
5. CORS wildcard interdit en production ; allowlist via `AJI_ALLOWED_ORIGINS`.
6. Les IDs Airtable et la base Airtable sortent du code et passent en variables d'environnement Vercel.
7. Aucun merge vers `main` avant gate Android Chrome HTTPS réel.

## Sources ajoutées dans cette branche

- `source-p0/assets/js/services/tfi-location.service.js`
- `source-p0/assets/js/services/sync.service.js`
- `source-p0/api/aji-sync.js`
- `source-p0/docs/P0_BBCCDD_SECURITY.md`

Le reste de la V3.3.2 reste dans le package de travail tant que la promotion source complète (UI, scanner vendorisé, tests/fixtures binaires et icônes) n'est pas terminée.