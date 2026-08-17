# P0.4 — Environnement de recette réel

## Statut

La cible Airtable de recette est provisionnée **dans la base `AJI Inventaire Zonage`**, mais dans six tables dédiées préfixées `P04_RECETTE_`. Elles sont réservées aux données synthétiques P0.4 et ne doivent jamais être utilisées comme tables métier.

La création d'une base Airtable séparée a été tentée puis refusée en 403 par le connecteur ; l'isolation a donc été réalisée par tables dédiées dans la base existante, sans modifier les tables métier.

## Configuration Airtable non secrète

```text
AIRTABLE_BASE_ID=appBt75qjLfNoe1Z4
AIRTABLE_TABLE_AFFECTATIONS=tblQ0rROMlqYOSKvT
AIRTABLE_TABLE_INVENTORY_SESSIONS=tblj2kJZemkkunlbm
AIRTABLE_TABLE_INVENTORY_COUNTS=tblQJgW92Txdhc1Wi
AIRTABLE_TABLE_PREPARATIONS=tblkr91HhMoA1vQzb
AIRTABLE_TABLE_PREPARATION_LINES=tbl0HJdtS2FNMkbsa
AIRTABLE_TABLE_SYNC_JOURNAL=tbl5YK5yLm7Oazx5d
AJI_ALLOWED_SITES=P04
AJI_MAX_BODY_BYTES=3500000
AJI_MAX_RECORDS=5000
```

Ces identifiants ne sont pas des secrets. Ils peuvent être versionnés pour rendre la recette reproductible.

## Variables qui ne doivent JAMAIS être versionnées

```text
AIRTABLE_TOKEN=<PAT recette limité à la base et aux scopes nécessaires>
AJI_SITE_KEYS_JSON={"P04":"<secret long aléatoire>"}
AJI_ALLOWED_ORIGINS=<URL exacte de la Preview Vercel>
```

`AIRTABLE_TOKEN` et `AJI_SITE_KEYS_JSON` doivent être configurés comme variables **Sensitive** dans Vercel.

Le PAT doit être limité à la base `appBt75qjLfNoe1Z4` et aux permissions de données nécessaires à la recette. Aucun droit de création/suppression de schéma n'est requis par la fonction `/api/aji-sync`.

## Tables de recette

- `P04_RECETTE_Affectations`
- `P04_RECETTE_Inventaire_Sessions`
- `P04_RECETTE_Inventaire_Comptages`
- `P04_RECETTE_Preparations`
- `P04_RECETTE_Preparation_Lignes`
- `P04_RECETTE_Sync_Journal`

Chaque table porte une description indiquant explicitement qu'elle est réservée à la recette P0.4 et aux données synthétiques.

## Données canari

Utiliser uniquement des identifiants qui ne peuvent pas être confondus avec des données réelles :

```text
siteCode=P04
entityId=P04-CANARY-001
articleCode=P04-TEST-001
emplacementErp=010203
client=P04 RECETTE SYNTHETIQUE
```

Aucune donnée client, article ou stock réelle ne doit être injectée dans cette gate.

## Séquence de gate réelle

1. Créer/lier une Preview Vercel sur la branche `p0/source-bbccdd-security-v3.3.3`, racine `source-p0`.
2. Configurer les variables non secrètes ci-dessus.
3. Ajouter `AIRTABLE_TOKEN` et `AJI_SITE_KEYS_JSON` comme Sensitive.
4. Déployer la Preview et définir `AJI_ALLOWED_ORIGINS` sur son origine HTTPS exacte, puis redéployer si nécessaire.
5. GET `/api/aji-sync` : 200, health minimal.
6. POST event 1.1 synthétique `P04-CANARY-001` : 200 et ligne créée dans `P04_RECETTE_Affectations`.
7. Rejouer le même `eventId` : 200 `idempotent=true`, aucune deuxième ligne.
8. Envoyer une mise à jour avec `baseRevision` exacte : la révision augmente.
9. Envoyer un événement obsolète : 409 `REVISION_CONFLICT`, aucune mutation métier.
10. Envoyer le delete valide : ligne supprimée et journal `synced`.
11. Rejouer le même delete : succès idempotent sans deuxième suppression.
12. Tester une coupure/reprise depuis l'outbox P0.2 : le 5xx/réseau reste pending, puis l'ACK 2xx retire uniquement l'opération correspondante.
13. Vérifier qu'aucun PAT, credential de site ou payload complet sensible n'apparaît dans le client, GitHub ou les réponses publiques.
14. Nettoyer les données canari de recette après conservation des preuves nécessaires.

## Blocage restant dans cette session

Le connecteur Vercel disponible permet de lire les projets/déploiements et de déployer un **projet courant déjà lié**, mais n'expose pas :

- la création d'un nouveau projet ;
- la liaison d'un dépôt/branche à un projet ;
- la création ou modification de variables d'environnement.

Le projet historique `aji-zonage-inventaire-v3-2` ne doit pas être utilisé comme fausse preuve de P0.4 : il correspond à un ancien déploiement et n'est pas relié à la branche P0 actuelle.

Par conséquent, `P0.4.9` et la gate `G-P04-04` restent ouvertes jusqu'au provisionnement d'une Preview correcte et de ses variables serveur.
