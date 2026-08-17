const SERVICE_VERSION = "1.1.0-p0";

function env(name) { return String(process.env[name] || "").trim(); }
const BASE_ID = env("AIRTABLE_BASE_ID");
const TABLES = {
  affectations: { id: env("AIRTABLE_TABLE_AFFECTATIONS"), merge: "Cle Externe", map: (x) => ({
    "Cle Externe": x.externalKey, "Code Article": x.articleCode || "", "Designation": x.designation || "", "Zone Physique": x.zonePhysique || "", "Emplacement": x.emplacementErp || "", "Site Code": x.siteCode || "", "Revision": toNumber(x.revision), "Updated At": x.updatedAt || null, "Sync Status": "synced", "Source": "pwa-v3.3.3-p0"
  })},
  inventorySessions: { id: env("AIRTABLE_TABLE_INVENTORY_SESSIONS"), merge: "Cle Externe", map: (x) => ({
    "Cle Externe": x.externalKey, "Site Code": x.siteCode || "", "Mode": normalizeMode(x.mode), "Scope": x.scope || "", "Statut": normalizeSessionStatus(x.status), "Ouverte Le": x.openedAt || null, "Cloturee Le": x.closedAt || null, "Revision": toNumber(x.revision), "Updated At": x.updatedAt || null, "Sync Status": "synced"
  })},
  inventoryCounts: { id: env("AIRTABLE_TABLE_INVENTORY_COUNTS"), merge: "Cle Externe", map: (x) => ({
    "Cle Externe": x.externalKey, "Session Cle": x.sessionKey || "", "Site Code": x.siteCode || "", "Code Article": x.articleCode || "", "Designation": x.designation || "", "Zone Physique": x.zonePhysique || "", "Emplacement ERP": x.emplacementErp || "", "Stock Theorique": toNumber(x.theoretical), "Quantite Comptee": toNumber(x.counted), "Ecart": toNumber(x.gap), "Cause": x.cause || "", "Statut": x.status || "", "Observation": x.observation || "", "Duplicate Scan": Boolean(x.duplicateScan), "Compte Le": x.countedAt || x.updatedAt || null, "Revision": toNumber(x.revision), "Sync Status": "synced"
  })},
  preparations: { id: env("AIRTABLE_TABLE_PREPARATIONS"), merge: "Cle Externe", map: (x) => ({
    "Cle Externe": x.externalKey, "Site Code": x.siteCode || "", "Numero Commande": x.orderNumber || "", "Client": x.customer || "", "Statut": normalizePreparationStatus(x.status), "Creee Le": x.createdAt || null, "Cloturee Le": x.closedAt || null, "Revision": toNumber(x.revision), "Updated At": x.updatedAt || null, "Sync Status": "synced"
  })},
  preparationLines: { id: env("AIRTABLE_TABLE_PREPARATION_LINES"), merge: "Cle Externe", map: (x) => ({
    "Cle Externe": x.externalKey, "Preparation Cle": x.preparationKey || "", "Site Code": x.siteCode || "", "Code Article": x.articleCode || "", "Designation": x.designation || "", "Quantite Attendue": toNumber(x.expected), "Quantite Preparee": toNumber(x.picked), "Statut": x.status || "", "Emplacement ERP": x.emplacementErp || "", "Revision": toNumber(x.revision), "Updated At": x.updatedAt || null, "Sync Status": "synced"
  })},
  syncJournal: { id: env("AIRTABLE_TABLE_SYNC_JOURNAL"), merge: "Cle Operation" }
};

function missingAirtableConfig() {
  const missing=[];
  if(!BASE_ID) missing.push("AIRTABLE_BASE_ID");
  for (const [key,spec] of Object.entries(TABLES)) if(!spec.id) missing.push(`AIRTABLE_TABLE_${key.replace(/([A-Z])/g,"_$1").toUpperCase()}`);
  return missing;
}

const encoder = new TextEncoder();
function allowedOrigins() { return env("AJI_ALLOWED_ORIGINS").split(",").map(x=>x.trim()).filter(Boolean); }
function corsHeaders(request) {
  const origin=request?.headers?.get?.("origin")||"";
  if(!origin) return {};
  const allowed=allowedOrigins();
  if(!allowed.includes(origin)) return null;
  return {"access-control-allow-origin":origin,"vary":"Origin","access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"Content-Type,X-AJI-Contract,X-AJI-Sync-Key"};
}
function json(data, status = 200, extra = {}, request = null) {
  const cors=corsHeaders(request);
  if(cors===null) return new Response(JSON.stringify({ok:false,code:"ORIGIN_NOT_ALLOWED"}),{status:403,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
  return new Response(JSON.stringify(data), {status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...(cors||{}),...extra}});
}
function toNumber(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function cleanString(v, max = 500) { return String(v ?? "").trim().slice(0, max); }
function normalizeMode(v) { return cleanString(v, 30).toLowerCase() === "annuel" ? "annuel" : "tournant"; }
function normalizeSessionStatus(v) {
  const s = cleanString(v, 50).toLowerCase();
  if (s.includes("annul")) return "annulee";
  if (s.includes("clot") || s.includes("clôt")) return "cloturee";
  return "ouverte";
}
function normalizePreparationStatus(v) {
  const s = cleanString(v, 50).toLowerCase();
  if (s.includes("annul")) return "Annulée";
  if (s.includes("prêt") || s.includes("pret") || s.includes("ready")) return "Prête";
  return "En cours";
}
function chunk(items, size = 10) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safeArray(v, max = 5000) { return Array.isArray(v) ? v.slice(0, max) : []; }
function validOperationId(v) { return /^[A-Za-z0-9_-]{6,100}$/.test(String(v || "")); }
function validSite(v) { return /^[A-Z0-9_-]{1,12}$/.test(String(v || "")); }
function escapeFormula(v) { return String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }

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
        throw new Error(`Airtable ${res.status}: ${text.slice(0, 500)}`);
      }
      return res;
    }
    await sleep(1000 * (attempt + 1));
  }
  throw new Error("Airtable 429 persistant");
}

async function findJournalByOperation(token, operationId) {
  const formula = encodeURIComponent(`{Cle Operation}='${escapeFormula(operationId)}'`);
  const q = `?maxRecords=1&filterByFormula=${formula}`;
  const res = await apiFetch(token, TABLES.syncJournal.id, { method: "GET" }, q);
  const body = await res.json();
  return body.records?.[0] || null;
}

async function highestRevisionForSite(token, siteCode) {
  const formula = encodeURIComponent(`AND({Site Code}='${escapeFormula(siteCode)}',{Statut}='synced')`);
  const q = `?maxRecords=1&filterByFormula=${formula}&sort%5B0%5D%5Bfield%5D=Revision&sort%5B0%5D%5Bdirection%5D=desc`;
  const res = await apiFetch(token, TABLES.syncJournal.id, { method: "GET" }, q);
  const body = await res.json();
  const rec = body.records?.[0];
  return rec ? { revision: toNumber(rec.fields?.Revision), operationId: rec.fields?.["Cle Operation"] || "" } : null;
}

async function upsertMany(token, spec, items) {
  const records = items.filter((x) => x && cleanString(x.externalKey, 300)).map((x) => ({ fields: spec.map(x) }));
  let created = 0, updated = 0;
  for (const group of chunk(records, 10)) {
    const res = await apiFetch(token, spec.id, {
      method: "PATCH",
      body: JSON.stringify({
        performUpsert: { fieldsToMergeOn: [spec.merge] },
        typecast: true,
        records: group
      })
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
    body: JSON.stringify({
      performUpsert: { fieldsToMergeOn: [TABLES.syncJournal.merge] },
      typecast: true,
      records: [{ fields: entry }]
    })
  });
  return res.json();
}

function validateEnvelope(body, headerContract) {
  if (!body || typeof body !== "object") return "Corps JSON requis";
  if (!validOperationId(body.operationId)) return "operationId invalide";
  if (body.operation !== "checkpoint") return "operation non supportée";
  const p = body.payload;
  if (!p || typeof p !== "object") return "payload requis";
  if (headerContract !== "zonage-sync/1.0") return "X-AJI-Contract invalide";
  if (p.contractVersion !== "1.0") return "contractVersion non supportée";
  if (!validSite(p.siteCode)) return "siteCode invalide";
  if (!Number.isInteger(Number(p.revision)) || Number(p.revision) < 0) return "revision invalide";
  for (const key of ["affectations", "inventorySessions", "inventoryCounts", "preparations"]) {
    if (p[key] != null && !Array.isArray(p[key])) return `${key} doit être un tableau`;
    if (Array.isArray(p[key]) && p[key].length > 5000) return `${key} dépasse 5000 éléments`;
  }
  return null;
}

async function handlePost(request) {
  const providedKey = request.headers.get("x-aji-sync-key") || "";
  const expectedKey = process.env.AJI_SYNC_KEY || "";
  if (!expectedKey) return json({ ok: false, code: "AJI_SYNC_KEY_MISSING", message: "Configurer AJI_SYNC_KEY dans Vercel." }, 503, {}, request);
  if (!providedKey || !timingSafeEqual(providedKey, expectedKey)) return json({ ok: false, code: "UNAUTHORIZED" }, 401, {}, request);
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) return json({ ok: false, code: "AIRTABLE_TOKEN_MISSING", message: "Configurer AIRTABLE_TOKEN dans Vercel." }, 503, {}, request);
  const missingConfig=missingAirtableConfig();
  if(missingConfig.length) return json({ok:false,code:"AIRTABLE_CONFIG_MISSING",missing:missingConfig},503,{},request);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, code: "INVALID_JSON" }, 400, {}, request); }
  const error = validateEnvelope(body, request.headers.get("x-aji-contract"));
  if (error) return json({ ok: false, code: "INVALID_PAYLOAD", message: error }, 400, {}, request);

  const { operationId, payload } = body;
  const siteCode = payload.siteCode;
  const revision = Number(payload.revision);
  const already = await findJournalByOperation(token, operationId);
  if (already?.fields?.Statut === "synced") return json({ ok: true, idempotent: true, operationId, revision, results: {} }, 200, {}, request);

  const last = await highestRevisionForSite(token, siteCode);
  if (last && (last.revision > revision || (last.revision === revision && last.operationId !== operationId))) {
    await writeJournal(token, {
      "Cle Operation": operationId, "Site Code": siteCode, "Entite": "checkpoint", "Cle Externe": operationId,
      "Operation": "checkpoint", "Revision": revision, "Statut": "conflict", "Tentatives": 1,
      "Derniere Erreur": `Révision distante ${last.revision} (${last.operationId}) >= révision reçue ${revision}`,
      "Cree Le": new Date().toISOString(), "Traite Le": new Date().toISOString()
    });
    return json({ ok: false, code: "REVISION_CONFLICT", remoteRevision: last.revision }, 409, {}, request);
  }

  const startedAt = new Date().toISOString();
  try {
    const preparations = safeArray(payload.preparations);
    const lines = preparations.flatMap((p) => safeArray(p.lines, 5000).map((l) => ({ ...l, preparationKey: l.preparationKey || p.externalKey })));
    const results = {};
    results.affectations = await upsertMany(token, TABLES.affectations, safeArray(payload.affectations));
    results.inventorySessions = await upsertMany(token, TABLES.inventorySessions, safeArray(payload.inventorySessions));
    results.inventoryCounts = await upsertMany(token, TABLES.inventoryCounts, safeArray(payload.inventoryCounts));
    results.preparations = await upsertMany(token, TABLES.preparations, preparations);
    results.preparationLines = await upsertMany(token, TABLES.preparationLines, lines);
    await writeJournal(token, {
      "Cle Operation": operationId, "Site Code": siteCode, "Entite": "checkpoint", "Cle Externe": operationId,
      "Operation": "checkpoint", "Revision": revision, "Statut": "synced", "Tentatives": 1, "Derniere Erreur": "",
      "Cree Le": startedAt, "Traite Le": new Date().toISOString()
    });
    return json({ ok: true, operationId, revision, results }, 200, {}, request);
  } catch (err) {
    const message = cleanString(err?.message || err, 4000);
    try {
      await writeJournal(token, {
        "Cle Operation": operationId, "Site Code": siteCode, "Entite": "checkpoint", "Cle Externe": operationId,
        "Operation": "checkpoint", "Revision": revision, "Statut": "error", "Tentatives": 1,
        "Derniere Erreur": message, "Cree Le": startedAt, "Traite Le": new Date().toISOString()
      });
    } catch {}
    return json({ ok: false, code: "AIRTABLE_WRITE_FAILED", message }, 502, {}, request);
  }
}

function timingSafeEqual(a, b) {
  const aa = encoder.encode(String(a));
  const bb = encoder.encode(String(b));
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

export default {
  async fetch(request) {
    const cors=corsHeaders(request);
    if(cors===null) return json({ok:false,code:"ORIGIN_NOT_ALLOWED"},403,{},request);
    if (request.method === "OPTIONS") return json({ ok: true }, 204, {}, request);
    if (request.method === "GET") {
      return json({
        ok: true, service: "aji-zonage-sync", version: SERVICE_VERSION,
        airtableConfigured: Boolean(process.env.AIRTABLE_TOKEN) && missingAirtableConfig().length===0,
        syncKeyConfigured: Boolean(process.env.AJI_SYNC_KEY), contract: "zonage-sync/1.0"
      },200,{},request);
    }
    if (request.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, { allow: "GET,POST,OPTIONS" }, request);
    return handlePost(request);
  }
};
