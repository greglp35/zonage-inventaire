# P0.4 — Synchronisation événementielle HTTPS

## Principe

P0.4 synchronise **l’outbox P0.2 opération par opération**. Il ne réutilise pas le checkpoint unique historique de `sync.service.js` pour transporter les mutations métier.

Chaîne cible :

`IndexedDB outbox → OutboxSyncService → POST same-origin /api/aji-sync → Airtable → journal eventId → ACK local exact`

## Contrat 1.1

Headers :

- `X-AJI-Contract: zonage-sync/1.1`
- `X-AJI-Site`
- `X-AJI-Sync-Key`
- `Content-Type: application/json`

Envelope :

```json
{
  "operationId": "op_...",
  "operation": "event",
  "payload": {
    "contractVersion": "1.1",
    "siteCode": "BR",
    "eventId": "evt_...",
    "collection": "affectations",
    "entityId": "A1",
    "mutation": "upsert",
    "revision": 4,
    "baseRevision": 3,
    "updatedAt": "2026-08-17T14:00:00Z",
    "data": {}
  }
}
```

Collections autorisées : `affectations`, `inventorySessions`, `inventoryCounts`, `preparations`, `preparationLines`.

## Idempotence

- `opId` identifie l’opération locale ;
- `eventId` est la clé d’idempotence serveur ;
- le journal Airtable utilise `eventId` comme `Cle Operation` pour le contrat 1.1 ;
- un `eventId` déjà `synced` retourne `200 idempotent=true` sans seconde mutation métier ;
- l’ACK local supprime uniquement `opId` après succès HTTP 2xx.

## Révisions et conflits

`baseRevision` est capturée automatiquement par `local-data.service.js` à partir de la révision locale précédente :

- création initiale : `baseRevision=0` ;
- modification après révision 3 : `baseRevision=3` ;
- suppression après révision 4 : `baseRevision=4`.

Avant une mutation distante, la façade lit l’entité Airtable par `Cle Externe`.

- si `remote.Revision > baseRevision` : `409 REVISION_CONFLICT`, aucune mutation métier ;
- si un `upsert` part d’une `baseRevision > 0` mais que le record distant a disparu : conflit, afin d’éviter une résurrection silencieuse ;
- si un `delete` cible un record déjà absent : succès, car l’état désiré est déjà atteint.

La règle générique de résolution P0.2 reste séparée ; P0.4 ne fusionne jamais silencieusement les champs.

## Delete

Le contrat `delete` recherche la ligne distante par `Cle Externe`, puis supprime l’ID Airtable trouvé. Aucun champ `Deleted` supplémentaire n’est requis pour le modèle de recette actuel.

Le tombstone reste la preuve locale jusqu’au traitement de l’événement. La stratégie de purge des tombstones après confirmation distante devra rester explicite au niveau métier ; P0.4 ne doit pas effacer l’historique sans règle.

## Retry / backoff

Classification transport :

- `2xx` → ACK ;
- exception réseau, `408`, `425`, `429`, `5xx` → `pending`, tentative incrémentée et backoff ;
- autres `4xx`, notamment `400`, `401`, `403`, `409`, `413`, `415`, `422` → `blocked`, pas de boucle infinie.

Backoff par défaut : exponentiel borné avec jitter ; `Retry-After` est respecté lorsqu’il est fourni.

Un seul `flush()` est autorisé à la fois. Le retour `online` déclenche une reprise.

## Preuves CI

Workflow : `.github/workflows/p04-sync-gate.yml`.

La gate mockée couvre :

- 20 événements IndexedDB FIFO → 20 ACK exacts ;
- contrat 1.1 ;
- `baseRevision` automatique ;
- `503` conservé pending puis repris ;
- `409` basculé blocked et non rejoué ;
- exception réseau sans ACK ;
- API : upsert, replay `eventId`, conflit distant, update depuis base exacte, delete et replay delete ;
- absence de résurrection silencieuse lorsque le distant a disparu.

## Limite de validation

**La gate mockée ne valide pas P0.4 à elle seule.**

P0.4 ne passe à `Validé` qu’après une Preview HTTPS réelle avec :

1. tables Airtable de recette dédiées et données synthétiques ;
2. variables Vercel correctement configurées ;
3. POST réel 200 ;
4. création puis suppression réelle d’un record de test ;
5. replay du même `eventId` sans doublon ;
6. coupure/reprise réseau sans perte ;
7. aucun PAT Airtable exposé au navigateur.

La réserve WAF P0.3 reste bloquante pour la production même si la recette P0.4 est concluante.
