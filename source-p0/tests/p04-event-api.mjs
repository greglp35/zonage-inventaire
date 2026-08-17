import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { validateEnvelope } from "../lib/api-security.mjs";

const ORIGIN="https://preview.example.test";
const SITE_KEY="BR_0123456789abcdef0123456789";
const IDS={
  affectations:"tblAFFECTATIONS123",
  sessions:"tblSESSIONS123456",
  counts:"tblCOUNTS12345678",
  preparations:"tblPREPARATIONS12",
  lines:"tblPREPLINES123456",
  journal:"tblJOURNAL1234567"
};
process.env.AIRTABLE_TOKEN="pat_server_only_test";
process.env.AIRTABLE_BASE_ID="appTEST1234567890";
process.env.AIRTABLE_TABLE_AFFECTATIONS=IDS.affectations;
process.env.AIRTABLE_TABLE_INVENTORY_SESSIONS=IDS.sessions;
process.env.AIRTABLE_TABLE_INVENTORY_COUNTS=IDS.counts;
process.env.AIRTABLE_TABLE_PREPARATIONS=IDS.preparations;
process.env.AIRTABLE_TABLE_PREPARATION_LINES=IDS.lines;
process.env.AIRTABLE_TABLE_SYNC_JOURNAL=IDS.journal;
process.env.AJI_ALLOWED_ORIGINS=ORIGIN;
process.env.AJI_ALLOWED_SITES="BR";
process.env.AJI_SITE_KEYS_JSON=JSON.stringify({BR:SITE_KEY});
process.env.AJI_MAX_BODY_BYTES="3500000";
process.env.AJI_MAX_RECORDS="5000";

function eventEnvelope({operationId="op_event_0001",eventId="evt_event_0001",collection="affectations",entityId="A1",mutation="upsert",revision=1,baseRevision=0,data={articleCode:"ART1",designation:"Produit",zonePhysique:"Z1",emplacementErp:"010203"}}={}){
  return {operationId,operation:"event",payload:{contractVersion:"1.1",siteCode:"BR",eventId,collection,entityId,mutation,revision,baseRevision,updatedAt:"2026-08-17T14:00:00Z",data:mutation==="delete"?null:data}};
}
function request(body){return new Request("https://preview.example.test/api/aji-sync",{method:"POST",headers:{origin:ORIGIN,"content-type":"application/json","x-aji-contract":"zonage-sync/1.1","x-aji-site":"BR","x-aji-sync-key":SITE_KEY},body:JSON.stringify(body)})}
async function json(response){return JSON.parse(await response.text())}

assert.equal(validateEnvelope(eventEnvelope(),{headerContract:"zonage-sync/1.1",headerSite:"BR"}),null);
assert.match(validateEnvelope(eventEnvelope({eventId:"bad",operationId:"op_event_0002"}),{headerContract:"zonage-sync/1.1",headerSite:"BR"}),/eventId invalide/);
assert.match(validateEnvelope(eventEnvelope({collection:"unknown",operationId:"op_event_0003",eventId:"evt_event_0003"}),{headerContract:"zonage-sync/1.1",headerSite:"BR"}),/collection non supportée/);
assert.match(validateEnvelope(eventEnvelope({operationId:"op_event_0004",eventId:"evt_event_0004",data:{emplacementErp:"01-02-03"}}),{headerContract:"zonage-sync/1.1",headerSite:"BR"}),/BBCCDD/);
assert.match(validateEnvelope(eventEnvelope({operationId:"op_event_0005",eventId:"evt_event_0005",revision:2,baseRevision:3}),{headerContract:"zonage-sync/1.1",headerSite:"BR"}),/inférieure/);

const facadePath=pathToFileURL(new URL("../api/aji-sync.test.mjs",import.meta.url).pathname).href+`?t=${Date.now()}`;
const facade=(await import(facadePath)).default;

const business=new Map();
for(const id of [IDS.affectations,IDS.sessions,IDS.counts,IDS.preparations,IDS.lines])business.set(id,new Map());
const journal=new Map();
const calls=[];
let seq=1;
function unescapeFormulaValue(value){return String(value||"").replace(/\\'/g,"'").replace(/\\\\/g,"\\")}
function formulaValue(formula,field){const re=new RegExp(`\\{${field.replace(/[.*+?^${}()|[\\]\\]/g,"\\$&")}\\}='((?:\\\\.|[^'])*)'`);const m=String(formula||"").match(re);return m?unescapeFormulaValue(m[1]):""}
function airtableRecord(fields,id=`recMOCK${String(seq++).padStart(10,"0")}`){return{id,fields:{...fields}}}

globalThis.fetch=async(url,init={})=>{
  const u=new URL(String(url));
  const parts=u.pathname.split("/").filter(Boolean); // v0/base/table[/record]
  const tableId=parts[2],recordId=parts[3]||"",method=String(init.method||"GET").toUpperCase();
  calls.push({tableId,recordId,method,url:String(url),body:init.body||""});
  assert.equal(init.headers?.authorization,"Bearer pat_server_only_test");

  if(method==="GET"){
    const formula=u.searchParams.get("filterByFormula")||"";
    if(tableId===IDS.journal){
      const key=formulaValue(formula,"Cle Operation");
      const rec=key?journal.get(key):null;
      return new Response(JSON.stringify({records:rec?[rec]:[]}),{status:200,headers:{"content-type":"application/json"}});
    }
    const key=formulaValue(formula,"Cle Externe");
    const rec=business.get(tableId)?.get(key)||null;
    return new Response(JSON.stringify({records:rec?[rec]:[]}),{status:200,headers:{"content-type":"application/json"}});
  }
  if(method==="PATCH"){
    const body=JSON.parse(init.body||"{}");
    if(tableId===IDS.journal){
      const fields=body.records?.[0]?.fields||{};
      const key=fields["Cle Operation"];
      const existing=journal.get(key);
      const rec=existing?{...existing,fields:{...existing.fields,...fields}}:airtableRecord(fields);
      journal.set(key,rec);
      return new Response(JSON.stringify({records:[rec],createdRecords:existing?[]:[rec.id],updatedRecords:existing?[rec.id]:[]}),{status:200,headers:{"content-type":"application/json"}});
    }
    const store=business.get(tableId);assert.ok(store,"table métier mock inconnue");
    const records=[];const createdRecords=[];const updatedRecords=[];
    for(const input of body.records||[]){
      const fields=input.fields||{},key=fields["Cle Externe"],existing=store.get(key);
      const rec=existing?{...existing,fields:{...existing.fields,...fields}}:airtableRecord(fields);
      store.set(key,rec);records.push(rec);(existing?updatedRecords:createdRecords).push(rec.id);
    }
    return new Response(JSON.stringify({records,createdRecords,updatedRecords}),{status:200,headers:{"content-type":"application/json"}});
  }
  if(method==="DELETE"){
    const store=business.get(tableId);assert.ok(store,"table métier mock inconnue");
    let foundKey="";
    for(const [key,rec] of store.entries())if(rec.id===recordId){foundKey=key;break}
    if(foundKey)store.delete(foundKey);
    return new Response(JSON.stringify({id:recordId,deleted:!!foundKey}),{status:200,headers:{"content-type":"application/json"}});
  }
  throw new Error(`Méthode mock non supportée ${method}`);
};

// Create + idempotent replay.
let response=await facade.fetch(request(eventEnvelope()));
assert.equal(response.status,200);let body=await json(response);assert.equal(body.ok,true);
assert.equal(business.get(IDS.affectations).get("A1")?.fields?.Revision,1);
const patchAfterCreate=calls.filter(c=>c.tableId===IDS.affectations&&c.method==="PATCH").length;
response=await facade.fetch(request(eventEnvelope()));
assert.equal(response.status,200);body=await json(response);assert.equal(body.idempotent,true);
assert.equal(calls.filter(c=>c.tableId===IDS.affectations&&c.method==="PATCH").length,patchAfterCreate,"replay eventId ne doit pas réécrire le métier");

// Remote newer than base => conflict, no mutation.
business.get(IDS.affectations).set("A2",airtableRecord({"Cle Externe":"A2","Revision":5,"Site Code":"BR"}));
const conflict=eventEnvelope({operationId:"op_event_0010",eventId:"evt_event_0010",entityId:"A2",revision:6,baseRevision:3,data:{articleCode:"A2",emplacementErp:"010203"}});
const patchesBeforeConflict=calls.filter(c=>c.tableId===IDS.affectations&&c.method==="PATCH").length;
response=await facade.fetch(request(conflict));
assert.equal(response.status,409);body=await json(response);assert.equal(body.code,"REVISION_CONFLICT");assert.equal(body.remoteRevision,5);
assert.equal(calls.filter(c=>c.tableId===IDS.affectations&&c.method==="PATCH").length,patchesBeforeConflict,"conflit ne doit pas muter la table métier");
assert.equal(business.get(IDS.affectations).get("A2").fields.Revision,5);

// Valid update from exact base.
const update=eventEnvelope({operationId:"op_event_0011",eventId:"evt_event_0011",entityId:"A2",revision:6,baseRevision:5,data:{articleCode:"A2",emplacementErp:"010204"}});
response=await facade.fetch(request(update));assert.equal(response.status,200);
assert.equal(business.get(IDS.affectations).get("A2").fields.Revision,6);
assert.equal(business.get(IDS.affectations).get("A2").fields.Emplacement,"010204");

// Delete + replay idempotence.
const del=eventEnvelope({operationId:"op_event_0012",eventId:"evt_event_0012",entityId:"A2",mutation:"delete",revision:7,baseRevision:6,data:null});
response=await facade.fetch(request(del));assert.equal(response.status,200);assert.equal(business.get(IDS.affectations).has("A2"),false);
const deletesAfterFirst=calls.filter(c=>c.tableId===IDS.affectations&&c.method==="DELETE").length;
response=await facade.fetch(request(del));assert.equal(response.status,200);body=await json(response);assert.equal(body.idempotent,true);
assert.equal(calls.filter(c=>c.tableId===IDS.affectations&&c.method==="DELETE").length,deletesAfterFirst,"replay delete ne doit pas supprimer deux fois");

// New delete of an already absent record is a successful desired-state operation.
const absentDelete=eventEnvelope({operationId:"op_event_0013",eventId:"evt_event_0013",entityId:"ABSENT",mutation:"delete",revision:2,baseRevision:1,data:null});
response=await facade.fetch(request(absentDelete));assert.equal(response.status,200);body=await json(response);assert.equal(body.ok,true);

// Upsert with baseRevision > 0 while remote is missing must not resurrect silently.
const resurrection=eventEnvelope({operationId:"op_event_0014",eventId:"evt_event_0014",entityId:"MISSING",revision:4,baseRevision:3,data:{articleCode:"M",emplacementErp:"010203"}});
response=await facade.fetch(request(resurrection));assert.equal(response.status,409);body=await json(response);assert.equal(body.code,"REVISION_CONFLICT");assert.equal(body.remoteRevision,null);
assert.equal(business.get(IDS.affectations).has("MISSING"),false);

console.log("P0.4_EVENT_API_GATE=PASS");
