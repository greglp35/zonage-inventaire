# P0.2 — Données locales / Outbox

## Objectif

Garantir qu’une action métier critique reste disponible hors connexion, survive au redémarrage et puisse être rejouée sans perte ni doublon.

P0.2 est **strictement local**. Il ne réalise aucune écriture Airtable et ne dépend d’aucun backend. La synchronisation HTTP appartient à P0.4.

## Stores IndexedDB

Base : `aji_hub_local_v1`

- `entities` : état local courant par `entityKey = collection:entityId` ;
- `outbox` : opérations métier pending, clé `opId` ;
- `tombstones` : suppressions à propager ;
- `meta` : checkpoints et métadonnées locales non sensibles.

Index outbox :

- `status_createdAt` pour replay FIFO ;
- `entityKey` pour diagnostic ;
- `eventId` unique pour déduplication.

## Cycle d’une opération

1. une action locale produit un `opId` et un `eventId` stables ;
2. l’état métier et l’opération sont écrits dans une même transaction lorsque c’est possible ;
3. l’opération reste `pending` tant qu’aucun ACK explicite n’a été reçu ;
4. un échec met à jour `attempts`, `lastAttemptAt` et `lastError` sans supprimer le payload ;
5. `ack(opId)` supprime uniquement l’opération confirmée.

## Idempotence locale

- `opId` est la clé primaire de l’outbox ;
- `eventId` possède un index unique ;
- réinsérer un `opId` ou `eventId` existant retourne l’opération déjà présente ;
- le payload original n’est pas remplacé silencieusement par un retry.

## Suppression / tombstone

Une suppression :

- retire l’entité de `entities` ;
- écrit un tombstone versionné ;
- ajoute une opération `delete` à l’outbox.

L’absence d’une entité n’est donc jamais utilisée seule comme preuve de suppression.

## Conflits

Politique générique P0 :

1. `revision` la plus haute gagne ;
2. à révision égale, `updatedAt` le plus récent gagne ;
3. à égalité parfaite, tie-break stable ;
4. aucun merge champ par champ implicite.

La fonction `resolveConflict()` retourne `winner`, `source` et `reason`.

## Recette minimale

`source-p0/p0-outbox-smoke.html` doit démontrer :

- 20 opérations offline persistées ;
- ordre FIFO stable ;
- zéro doublon `opId` / `eventId` ;
- erreur de tentative conservée ;
- ACK exact ;
- tombstone persistant ;
- résolution déterministe des conflits.

La validation finale exige une exécution sur une Preview HTTPS et un redémarrage réel du navigateur/PWA. Le simple fait que le code existe ne vaut pas PASS.
