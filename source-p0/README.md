# AJI Zonage Inventaire — Source P0 réutilisable

Ce dossier n'est pas une copie brute de l'application V3.3.2. Il contient uniquement les briques que l'audit Spec-Kit considère suffisamment autonomes pour devenir des patterns AJI Hub.

## Services promus

| Service | Rôle | Dépendance runtime |
|---|---|---|
| `tfi-location.service.js` | Contrat canonique emplacement TFI BBCCDD | Aucune |
| `storage.service.js` | localStorage versionné + miroir IndexedDB + sélection de la copie la plus récente | APIs navigateur natives |
| `scanner.service.js` | Scanner EAN/UPC/Code128/Code39/ITF : BarcodeDetector natif puis fallback local | `html5-qrcode` vendorisé localement pour le fallback |
| `pwa.service.js` | Enregistrement Service Worker et état online/offline | APIs PWA natives |
| `sync.service.js` | Outbox IndexedDB, checkpoint, retry réseau, configuration session | `fetch`, IndexedDB, HTTPS |
| `api/aji-sync.js` | Façade Vercel → Airtable, idempotence et contrôle de révision | Vercel + Airtable optionnels |

## Ce qui n'est volontairement pas promu tel quel

- `assets/js/app.js` : monolithe métier/UI d'environ 96 Ko. Il doit être découpé avant d'être considéré comme source réutilisable.
- `index.html` et `app.css` : spécifiques à l'application terrain actuelle ; à extraire seulement par patterns UI éprouvés.
- `html5-qrcode.min.js` : dépendance tierce volumineuse ; elle doit être ajoutée avec sa licence dans le package déployable, mais elle n'est pas du code AJI à réutiliser ou modifier.
- icônes et fixture XLSX : artefacts binaires de distribution/test, non nécessaires à l'audit des patterns.

## Invariants P0

1. `BBCCDD` (6 caractères) est la valeur ERP canonique.
2. Une représentation `BB-CC-DD` est uniquement visuelle.
3. Aucun secret durable dans `localStorage`, GitHub ou le JavaScript client.
4. Le fonctionnement local/offline ne dépend pas d'Airtable.
5. La synchronisation distante reste optionnelle et passe par une façade serveur HTTPS.
6. Le scanner doit rester utilisable sans CDN après première installation PWA.
7. Aucun merge de cette branche vers `main` avant recette Android Chrome HTTPS réelle.

## Étape suivante

Découpler du monolithe les contrats métier minimaux nécessaires à l'application complète (état, inventaire, préparation client, orchestration UI), construire un shell de recette sous `source-p0/`, ajouter le vendor scanner local avec sa licence, puis exécuter la gate physique Android.
