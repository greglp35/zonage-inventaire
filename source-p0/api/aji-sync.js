import {
  authorizeSite,
  bodyLimitFromEnv,
  cleanString,
  originDecision,
  parseJsonRequest,
  recordLimitFromEnv,
  validateEnvelope
} from "../lib/api-security.mjs";

const SERVICE_VERSION = "1.2.0-p0.3";
const CONTRACT = "zonage-sync/1.0";

function env(name) { return String(process.env[name] || "").trim(); }
function txt(value, max = 500) { return cleanString(value, max); }
function loc(value) { return txt(value, 6).toUpperCase(); }
function num(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function bool(value) { return Boolean(value); }

const BASE_ID = env("AIRTABLE_BASE_ID");
const TABLES = {
  affectations: { id: env("AIRTABLE_TABLE_AFFECTATIONS"), merge: "Cle Externe", map: (x) => ({
    "Cle Externe": txt(x.externalKey, 300), "Code Article": txt(x.articleCode, 80), "Designation": txt(x.designation, 500), "Zone Physique": txt(x.zonePhysique, 120), "Emplacement": loc(x.emplacementErp), "Site Code": txt(x.siteCode, 12).toUpperCase(), "Revision": num(x.revision), "Updated At": x.updatedAt || null, "Sync Status": "synced", "Source": "pwa-v3.3.3-p0.3"
  })},
  inventorySessions: { id: env("AIRTABLE_TABLE_INVENTORY_SESSIONS"), merge: "Cle Externe", map: (x) => ({
    "Cle Externe": txt(x.externalKey, 300), "Site Code": txt(x.siteCode, 12).toUpperCase(), "Mode": normalizeMode(x.mode), "Scope": txt(x.scope, 120), "Statut": normalizeSessionStatus(x.status), "Ouverte Le": x.openedAt || null, "Cloturee Le": x.closedAt || null, "Revision": num(x.revision), "Updated At": x.updatedAt || null, "Sync Status": "synced"
  })},
  inventoryCounts: { id: env("AIRTABLE_TABLE_INVENTORY_COUNTS"), merge: "Cle Externe", map: (x) => ({
    "Cle Externe": txt(x.externalKey, 300), "Session Cle": txt(x.sessionKey, 300), "Site Code": txt(x.siteCode, 12).toUpperCase(), "Code Article": txt(x.articleCode, 80), "Designation": txt(x.designation, 500), "Zone Physique": txt(x.zonePhysique, 120), "Emplacement ERP": loc(x.emplacementErp), "Stock Theorique": num(x.theoretical), "Quantite Comptee": num(x.counted), "Ecart": num(x.gap), "Cause": txt(x.cause, 500), "Statut": txt(x.status, 80), "Observation": txt(x.observation, 2000), "Duplicate Scan": bool(x.duplicateScan), "Compte Le": x.countedAt || x.updatedAt || null, "Revision": num(x.revision), "Sync Status": "synced"
  })},
  preparations: { id: env("AIRTABLE_TABLE_PREPARATIONS"), merge: "Cle Externe", map: (x) => ({
    "Cle Externe": txt(x.externalKey, 300), "Site Code": txt(x.siteCode, 12).toUpperCase(), "Numero Commande": txt(x.orderNumber, 120), "Client": txt(x.customer, 500), "Statut": normalizePreparationStatus(x.status), "Creee Le": x.createdAt || null, "Cloturee Le": x.closedAt || null, "Revision": num(x.revision), "Updated At": x.updatedAt || null, "Sync Status": "synced"
  })},
  preparationLines: { id: env("AIRTABLE_TABLE_PREPARATION_LINES"), merge: "Cle Externe", map: (x) => ({
    "Cle Externe": txt(x.externalKey, 300), "Preparation Cle": txt(x.preparationKey, 300), "Site Code": txt(x.siteCode, 12).toUpperCase(), "Code Article": txt(x.articleCode, 80), "Designation": txt(x.designation, 500), "Quantite Attendue": num(x.expected), "Quantite Preparee": num(x.picked), "Statut": txt(x.status, 80), "Emplacement ERP": loc(x.emplacementErp), "Revision": num(x.revision), "Updated At": x.updatedAt || null, "Sync Status": "synced"
  })},
  syncJournal: { id: env("AIRTABLE_TABLE_SYNC_JOURNAL"), merge: "Cle Operation" }
};

function missingAirtableConfig() {
  const required = {
    AIRTABLE_BASE_ID: BASE_ID,
    AIRTABLE_TABLE_AFFECTATIONS: TABLES.affectations.id,
    AIRTABLE_TABLE_INVENTORY_SESSIONS: TABLES.inventorySessions.id,
    AIRTABLE_TABLE_INVENTORY_COUNTS: TABLES.inventoryCounts.id,
    AIRTABLE_TABLE_PREPARATIONS: TABLES.preparations.id,
    AIRTABLE_TABLE_PREPARATION_LINES: TABLES.preparationLines.id,
    AIRTABLE_TABLE_SYNC_JOURNAL: TABLES.syncJournal.id
  };
  return Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
}

function normalizeMode(v) { return txt(v, 30).toLowerCase() === "annuel" ? "annuel" : "tournant"; }
function normalizeSessionStatus(v) {
  const s = txt(v, 50).toLowerCase();
  if (s.includes("annul")) return "annulee";
  if (s.includes("clot") || s.includes("clôt")) return "cloturee";
  return "ouverte";
}
function normalizePreparationStatus(v) {
  const s = txt(v, 50).toLowerCase();
  if (s.includes("annul")) return "Annulée";
  if (s.includes("prêt") || s.includes("pret") || s.includes("ready")) return "Prête";
  return "En cours";
}
function chunk(items, size = 10) { const out = []; for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safeArray(v, max = 5000) { return Array.isArray(v) ? v.slice(0, max) : []; }
function escapeFormula(v) { return String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }
function requestId(request) {
  const vercelId = txt(request.headers.get("x-vercel-id"), 120);
  if (vercelId) return vercelId;
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch {}
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function securityHeaders(cors = {}) {
  return {"cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer",...cors};
}
function plainJson(data, status = 200, headers = {}) {
  if (status === 204) return new Response(null, { status, headers: securityHeaders(headers) });
  return new Response(JSON.stringify(data), { status, headers: {"content-type":"application/json; charset=utf-8",...securityHeaders(headers)} });
}
function corsFor(origin) {
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "vary": "Origin",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type,X-AJI-Contract,X-AJI-Site,X-AJI-Sync-Key"
  };
}
function logServerError({ requestId: rid, code, operationId = "", siteCode = "", error }) {
  const message = txt(error?.message || error, 1200);
  console.error(JSON.stringify({ event: "aji-sync-error", requestId: rid, code, operationId: txt(operationId, 100), siteCode: txt(siteCode, 12), message }));
}

async function apiFetch(token, tableId, init = {}, query = "") {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}${query}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: {
        "authorization": `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers || {})
      }
    });
    if (res.status !== 429) {
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Airtable ${res.status}: ${text.slice(0, 800)}`);
      }
      return res;
    }
    await sleep(1000 * (attempt + 1));
  }
  throw new Error("Airtable 429 persistant");
}

async function findJournalByOperation(token, operationId) {
  const formula = encodeURIComponent(`{Cle Operation}='${escapeFormula(operationId)}'`);
  const res = await apiFetch(token, TABLES.syncJournal.id, { method: "GET" }, `?maxRecords=1&filterByFormula=${formula}`);
  const body = await res.json();
  return body.records?.[0] || null;
}
async function highestRevisionForSite(token, siteCode) {
  const formula = encodeURIComponent(`AND({Site Code}='${escapeFormula(siteCode)}',{Statut}='synced')`);
  const q = `?maxRecords=1&filterByFormula=${formula}&sort%5B0%5D%5Bfield%5D=Revision&sort%5B0%5D%5Bdirection%5D=desc`;
  const res = await apiFetch(token, TABLES.syncJournal.id, { method: "GET" }, q);
  const body = await res.json();
  const rec = body.records?.[0];
  return rec ? { revision: num(rec.fields?.Revision), operationId: rec.fields?.["Cle Operation"] || "" } : null;
}
async function upsertMany(token, spec, items) {
  const records = items.map((x) => ({ fields: spec.map(x) }));
  let created = 0, updated = 0;
  for (const group of chunk(records, 10)) {
    const res = await apiFetch(token, spec.id, {
      method: "PATCH",
      body: JSON.stringify({ performUpsert: { fieldsToMergeOn: [spec.merge] }, typecast: true, records: group })
    });
    const body = await res.json();
    created += body.createdRecords?.length || 0;
    updated += body.updatedRecords?.length || 0;
    await sleep(225);
  }
  return { total: records.length, created, updated };
}
async function writeJournal(token, entry) {
  const res = await apiFetch(token, TABLES.syncJournal.id, {
    method: "PATCH",
    body: JSON.stringify({ performUpsert: { fieldsToMergeOn: [TABLES.syncJournal.merge] }, typecast: true, records: [{ fields: entry }] })
  });
  return res.json();
}

async function handlePost(request, cors, rid) {
  const auth = authorizeSite({
    siteHeader: request.headers.get("x-aji-site"),
    providedKey: request.headers.get("x-aji-sync-key") || "",
    allowedSitesRaw: env("AJI_ALLOWED_SITES"),
    siteKeysRaw: env("AJI_SITE_KEYS_JSON")
  });
  if (!auth.ok) return plainJson({ ok:false, code:auth.code, requestId:rid }, auth.status, cors);

  const token = env("AIRTABLE_TOKEN");
  if (!token) return plainJson({ ok:false, code:"AIRTABLE_TOKEN_MISSING", requestId:rid }, 503, cors);
  const missingConfig = missingAirtableConfig();
  if (missingConfig.length) return plainJson({ ok:false, code:"AIRTABLE_CONFIG_MISSING", requestId:rid }, 503, cors);

  const parsed = await parseJsonRequest(request, bodyLimitFromEnv(env("AJI_MAX_BODY_BYTES")));
  if (!parsed.ok) return plainJson({ ok:false, code:parsed.code, requestId:rid }, parsed.status, cors);
  const error = validateEnvelope(parsed.body, {
    headerContract: request.headers.get("x-aji-contract"),
    headerSite: auth.site,
    maxRecords: recordLimitFromEnv(env("AJI_MAX_RECORDS"))
  });
  if (error) return plainJson({ ok:false, code:"INVALID_PAYLOAD", message:error, requestId:rid }, 400, cors);

  const { operationId, payload } = parsed.body;
  const siteCode = auth.site;
  const revision = Number(payload.revision);
  try {
    const already = await findJournalByOperation(token, operationId);
    if (already?.fields?.Statut === "synced") {
      return plainJson({ ok:true, idempotent:true, operationId, revision, results:{}, requestId:rid }, 200, cors);
    }

    const last = await highestRevisionForSite(token, siteCode);
    if (last && (last.revision > revision || (last.revision === revision && last.operationId !== operationId))) {
      await writeJournal(token, {
        "Cle Operation": operationId, "Site Code": siteCode, "Entite": "checkpoint", "Cle Externe": operationId,
        "Operation": "checkpoint", "Revision": revision, "Statut": "conflict", "Tentatives": 1,
        "Derniere Erreur": `REVISION_CONFLICT remote=${last.revision}`,
        "Cree Le": new Date().toISOString(), "Traite Le": new Date().toISOString()
      });
      return plainJson({ ok:false, code:"REVISION_CONFLICT", remoteRevision:last.revision, requestId:rid }, 409, cors);
    }

    const startedAt = new Date().toISOString();
    const preparations = safeArray(payload.preparations);
    const lines = preparations.flatMap((p) => safeArray(p.lines).map((l) => ({ ...l, preparationKey: l.preparationKey || p.externalKey })));
    const results = {};
    results.affectations = await upsertMany(token, TABLES.affectations, safeArray(payload.affectations));
    results.inventorySessions = await upsertMany(token, TABLES.inventorySessions, safeArray(payload.inventorySessions));
    results.inventoryCounts = await upsertMany(token, TABLES.inventoryCounts, safeArray(payload.inventoryCounts));
    results.preparations = await upsertMany(token, TABLES.preparations, preparations);
    results.preparationLines = await upsertMany(token, TABLES.preparationLines, lines);

    await writeJournal(token, {
      "Cle Operation": operationId, "Site Code": siteCode, "Entite": "checkpoint", "Cle Externe": operationId,
      "Operation": "checkpoint", "Revision": revision, "Statut": "synced", "Tentatives": 1,
      "Derniere Erreur": "", "Cree Le": startedAt, "Traite Le": new Date().toISOString()
    });
    return plainJson({ ok:true, operationId, revision, results, requestId:rid }, 200, cors);
  } catch (error) {
    logServerError({ requestId:rid, code:"AIRTABLE_WRITE_FAILED", operationId, siteCode, error });
    try {
      await writeJournal(token, {
        "Cle Operation": operationId, "Site Code": siteCode, "Entite": "checkpoint", "Cle Externe": operationId,
        "Operation": "checkpoint", "Revision": revision, "Statut": "error", "Tentatives": 1,
        "Derniere Erreur": "AIRTABLE_WRITE_FAILED", "Cree Le": new Date().toISOString(), "Traite Le": new Date().toISOString()
      });
    } catch (journalError) {
      logServerError({ requestId:rid, code:"SYNC_JOURNAL_WRITE_FAILED", operationId, siteCode, error:journalError });
    }
    return plainJson({ ok:false, code:"AIRTABLE_WRITE_FAILED", requestId:rid }, 502, cors);
  }
}

export default {
  async fetch(request) {
    const method = String(request.method || "GET").toUpperCase();
    const mutation = method === "POST" || method === "OPTIONS";
    const origin = originDecision(request.headers.get("origin"), env("AJI_ALLOWED_ORIGINS"), { required: mutation });
    if (!origin.ok) return plainJson({ ok:false, code:origin.code }, origin.status);
    const cors = corsFor(origin.origin);
    if (method === "OPTIONS") return plainJson(null, 204, cors);
    if (method === "GET") return plainJson({ ok:true, service:"aji-zonage-sync", version:SERVICE_VERSION, contract:CONTRACT }, 200, cors);
    if (method !== "POST") return plainJson({ ok:false, code:"METHOD_NOT_ALLOWED" }, 405, { ...cors, allow:"GET,POST,OPTIONS" });
    return handlePost(request, cors, requestId(request));
  }
};
