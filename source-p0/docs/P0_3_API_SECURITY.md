# P0.3 — Façade API sécurisée Vercel → Airtable

## Frontière de confiance

La PWA ne connaît jamais le PAT Airtable. Elle appelle uniquement la façade same-origin `/api/aji-sync`.

La clé `X-AJI-Sync-Key` est un **credential client limité au site**. Elle réduit l’exposition inter-sites et l’abus accidentel, mais **ne constitue pas une authentification utilisateur ni un RBAC**. Une identité utilisateur devra être traitée séparément si le Hub exige des droits individuels.

## Variables Vercel

### Sensibles — Preview / Production

- `AIRTABLE_TOKEN`
- `AJI_SITE_KEYS_JSON` — exemple de forme uniquement : `{ "BR": "<secret-long-et-aleatoire>", "JA": "<autre-secret>" }`

Sur Vercel, créer ces variables avec l’option **Sensitive**. Ne jamais mettre les valeurs dans GitHub, HTML, JSON d’export, localStorage ou IndexedDB.

### Configuration serveur non secrète

- `AIRTABLE_BASE_ID`
- `AIRTABLE_TABLE_AFFECTATIONS`
- `AIRTABLE_TABLE_INVENTORY_SESSIONS`
- `AIRTABLE_TABLE_INVENTORY_COUNTS`
- `AIRTABLE_TABLE_PREPARATIONS`
- `AIRTABLE_TABLE_PREPARATION_LINES`
- `AIRTABLE_TABLE_SYNC_JOURNAL`
- `AJI_ALLOWED_ORIGINS` — liste exacte séparée par virgules ; aucun `*`
- `AJI_ALLOWED_SITES` — ex. `BR,JA,GE`
- `AJI_MAX_BODY_BYTES` — défaut applicatif 3 500 000, plafond dur 4 000 000
- `AJI_MAX_RECORDS` — défaut/plafond 5 000 éléments par checkpoint, lignes de préparation incluses

Les modifications d’environnement Vercel nécessitent un nouveau déploiement pour prendre effet.

## Airtable

Le PAT doit être limité aux scopes et ressources réellement nécessaires à cette façade. Pour une simple synchronisation métier, ne pas lui donner de droits de schéma/admin inutiles. Lorsque l’organisation dispose d’Enterprise Scale, une intégration portée par un service account permet de découpler l’intégration du compte d’un collaborateur.

## Contrat HTTP

Mutation : `POST /api/aji-sync`

Headers obligatoires :

- `Origin` présent et exact dans `AJI_ALLOWED_ORIGINS`
- `Content-Type: application/json`
- `X-AJI-Contract: zonage-sync/1.0`
- `X-AJI-Site: <site>`
- `X-AJI-Sync-Key: <credential-du-site>`

Le `payload.siteCode` doit être identique à `X-AJI-Site`.

Le client `sync.service.js` refuse les endpoints cross-origin : le credential et le contenu métier ne doivent pas pouvoir être expédiés vers une URL arbitraire à partir d’une simple configuration locale.

## Validation serveur

La façade refuse avant Airtable :

- origin absente/non autorisée ;
- site absent/non autorisé ;
- credential incorrect ;
- content-type incorrect ;
- corps JSON invalide ou supérieur au plafond ;
- nombre total d’enregistrements supérieur au plafond ;
- contrat/version incorrects ;
- divergence header site / payload site ;
- `externalKey` absent ;
- emplacement ERP non vide qui n’est pas strictement `BBCCDD` ;
- méthode HTTP non supportée.

Les mappings Airtable sélectionnent explicitement les propriétés autorisées. Une propriété client inattendue ne doit pas être transmise à Airtable.

## Erreurs et journalisation

Le navigateur reçoit un `code` stable et un `requestId`. Les messages bruts Airtable ne sont jamais renvoyés au client.

Le log serveur peut contenir le code, le requestId, l’operationId, le site et un message technique tronqué. Il ne doit jamais logger le PAT, le credential client ou le payload métier complet.

## Rate limiting Vercel

Avant mise en production, ajouter une règle WAF ciblant `/api/aji-sync` avec action **Rate Limit**. Commencer en mode observation/log sur la Preview, mesurer le trafic normal des agences, puis choisir une fenêtre et un seuil compatibles avec le NAT partagé des sites. Ne pas inventer un seuil arbitraire qui pourrait bloquer plusieurs terminaux derrière la même IP.

Le rate limiting est une couche complémentaire : il ne remplace ni la validation du payload, ni l’autorisation par site, ni l’idempotence.

## Gate P0.3

P0.3 est validable lorsque :

1. les tests API négatifs refusent origin/site/clé/type/taille/volume/BBCCDD invalides ;
2. un appel valide mocké n’écrit que les champs autorisés ;
3. une erreur fournisseur simulée reste opaque côté navigateur ;
4. le client refuse un endpoint cross-origin et ne persiste pas son credential dans localStorage ;
5. aucune valeur de secret réelle n’est présente dans le dépôt ;
6. le runbook Vercel/Airtable est documenté.

La configuration WAF réelle reste une gate de déploiement avant production si elle n’est pas encore appliquée à la Preview.
