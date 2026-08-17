# P0 — Canonisation BBCCDD et durcissement synchronisation

## Décisions

1. **Source de vérité emplacement TFI** : valeur persistée et synchronisée strictement en `BBCCDD` (6 caractères alphanumériques).
2. **Affichage terrain** : l’UI peut afficher `BB-CC-DD`, mais ce format n’est jamais la valeur ERP persistée.
3. **Compatibilité legacy** : les anciennes valeurs `01-02-03` sont migrées en mémoire vers `010203` lors du chargement.
4. **Secret terminal** : `AJI_SYNC_KEY` n’est plus persistée dans `localStorage`; la valeur saisie est conservée en `sessionStorage` et disparaît à la fermeture du navigateur.
5. **CORS** : aucune origine wildcard en production. Les origines autorisées proviennent de `AJI_ALLOWED_ORIGINS`.
6. **Airtable** : base et IDs de tables sont fournis uniquement par variables d’environnement Vercel.

## Variables Vercel attendues

- `AJI_SYNC_KEY`
- `AJI_ALLOWED_ORIGINS`
- `AIRTABLE_TOKEN`
- `AIRTABLE_BASE_ID`
- `AIRTABLE_TABLE_AFFECTATIONS`
- `AIRTABLE_TABLE_INVENTORY_SESSIONS`
- `AIRTABLE_TABLE_INVENTORY_COUNTS`
- `AIRTABLE_TABLE_PREPARATIONS`
- `AIRTABLE_TABLE_PREPARATION_LINES`
- `AIRTABLE_TABLE_SYNC_JOURNAL`

## Gate

La branche P0 n’est pas considérée production tant que le scan Android Chrome HTTPS réel, le cache offline et la reprise de l’outbox n’ont pas été testés sur appareil physique.
