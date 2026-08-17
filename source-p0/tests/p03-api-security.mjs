import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  authorizeSite,
  bodyLimitFromEnv,
  countPayloadRecords,
  originDecision,
  parseJsonRequest,
  parseSiteKeys,
  recordLimitFromEnv,
  validateEnvelope
} from "../lib/api-security.mjs";

const ORIGIN="https://preview.example.test";
const SITE_KEY="BR_0123456789abcdef0123456789";
const basePayload={contractVersion:"1.0",siteCode:"BR",revision:1,affectations:[],inventorySessions:[],inventoryCounts:[],preparations:[]};
function envelope(payload=basePayload){return{operationId:"op_test_000001",operation:"checkpoint",payload}}
function req(body,headers={}){return new Request("https://api.example.test/api/aji-sync",{method:"POST",headers:{origin:ORIGIN,"content-type":"application/json","x-aji-contract":"zonage-sync/1.0","x-aji-site":"BR","x-aji-sync-key":SITE_KEY,...headers},body:typeof body==="string"?body:JSON.stringify(body)})}

// Pure security contract.
assert.deepEqual(parseSiteKeys(JSON.stringify({BR:SITE_KEY,GE:"too-short"})),{BR:SITE_KEY});
assert.equal(authorizeSite({siteHeader:"BR",providedKey:SITE_KEY,allowedSitesRaw:"BR,JA",siteKeysRaw:JSON.stringify({BR:SITE_KEY})}).ok,true);
assert.equal(authorizeSite({siteHeader:"JA",providedKey:SITE_KEY,allowedSitesRaw:"BR,JA",siteKeysRaw:JSON.stringify({BR:SITE_KEY})}).code,"SITE_KEY_MISSING");
assert.equal(authorizeSite({siteHeader:"GE",providedKey:SITE_KEY,allowedSitesRaw:"BR,JA",siteKeysRaw:JSON.stringify({BR:SITE_KEY})}).code,"SITE_NOT_ALLOWED");
assert.equal(authorizeSite({siteHeader:"BR",providedKey:"wrong-wrong-wrong",allowedSitesRaw:"BR",siteKeysRaw:JSON.stringify({BR:SITE_KEY})}).code,"UNAUTHORIZED");
assert.equal(originDecision("",ORIGIN,{required:true}).code,"ORIGIN_REQUIRED");
assert.equal(originDecision("https://evil.test",ORIGIN,{required:true}).code,"ORIGIN_NOT_ALLOWED");
assert.equal(originDecision(ORIGIN,ORIGIN,{required:true}).ok,true);
assert.equal(bodyLimitFromEnv("99999999"),4_000_000);
assert.equal(recordLimitFromEnv("999999"),5_000);
assert.equal(countPayloadRecords({...basePayload,affectations:[{}],preparations:[{lines:[{},{}]}]}),4);

let error=validateEnvelope(envelope(),{headerContract:"zonage-sync/1.0",headerSite:"BR",maxRecords:5000});
assert.equal(error,null);
error=validateEnvelope(envelope({...basePayload,siteCode:"JA"}),{headerContract:"zonage-sync/1.0",headerSite:"BR",maxRecords:5000});
assert.match(error,/siteCode différent/);
error=validateEnvelope(envelope({...basePayload,affectations:[{externalKey:"A1",siteCode:"BR",emplacementErp:"01-02-03"}]}),{headerContract:"zonage-sync/1.0",headerSite:"BR",maxRecords:5000});
assert.match(error,/BBCCDD/);
error=validateEnvelope(envelope({...basePayload,affectations:Array.from({length:5001},(_,i)=>({externalKey:`A${i}`,siteCode:"BR",emplacementErp:"010203"}))}),{headerContract:"zonage-sync/1.0",headerSite:"BR",maxRecords:5000});
assert.match(error,/dépasse 5000/);
let parsed=await parseJsonRequest(req(envelope(),{"content-type":"text/plain"}),3_500_000);
assert.equal(parsed.code,"UNSUPPORTED_MEDIA_TYPE");
parsed=await parseJsonRequest(req(envelope(),{"content-length":"4000001"}),3_500_000);
assert.equal(parsed.code,"PAYLOAD_TOO_LARGE");

// Import the actual facade copied to .mjs by CI.
process.env.AIRTABLE_TOKEN="pat_server_only_test";
process.env.AIRTABLE_BASE_ID="appTEST1234567890";
process.env.AIRTABLE_TABLE_AFFECTATIONS="tblAFFECTATIONS123";
process.env.AIRTABLE_TABLE_INVENTORY_SESSIONS="tblSESSIONS123456";
process.env.AIRTABLE_TABLE_INVENTORY_COUNTS="tblCOUNTS12345678";
process.env.AIRTABLE_TABLE_PREPARATIONS="tblPREPARATIONS12";
process.env.AIRTABLE_TABLE_PREPARATION_LINES="tblPREPLINES123456";
process.env.AIRTABLE_TABLE_SYNC_JOURNAL="tblJOURNAL1234567";
process.env.AJI_ALLOWED_ORIGINS=ORIGIN;
process.env.AJI_ALLOWED_SITES="BR,JA";
process.env.AJI_SITE_KEYS_JSON=JSON.stringify({BR:SITE_KEY,JA:"JA_0123456789abcdef0123456789"});
process.env.AJI_MAX_BODY_BYTES="3500000";
process.env.AJI_MAX_RECORDS="5000";

const facadePath=pathToFileURL(new URL("../api/aji-sync.test.mjs",import.meta.url).pathname).href+`?t=${Date.now()}`;
const facade=(await import(facadePath)).default;
async function bodyOf(response){return JSON.parse(await response.text())}

let response=await facade.fetch(new Request("https://api.example.test/api/aji-sync",{method:"GET"}));
assert.equal(response.status,200);
let body=await bodyOf(response);
assert.equal(body.ok,true);
assert.equal("airtableConfigured" in body,false);
assert.equal("syncKeyConfigured" in body,false);
assert.equal(JSON.stringify(body).includes("pat_server_only_test"),false);

response=await facade.fetch(new Request("https://api.example.test/api/aji-sync",{method:"POST",headers:{"content-type":"application/json","x-aji-site":"BR","x-aji-sync-key":SITE_KEY,"x-aji-contract":"zonage-sync/1.0"},body:JSON.stringify(envelope())}));
assert.equal(response.status,403);assert.equal((await bodyOf(response)).code,"ORIGIN_REQUIRED");
response=await facade.fetch(req(envelope(),{origin:"https://evil.test"}));
assert.equal(response.status,403);assert.equal((await bodyOf(response)).code,"ORIGIN_NOT_ALLOWED");
response=await facade.fetch(new Request("https://api.example.test/api/aji-sync",{method:"OPTIONS",headers:{origin:ORIGIN}}));
assert.equal(response.status,204);assert.equal(response.headers.get("access-control-allow-origin"),ORIGIN);assert.notEqual(response.headers.get("access-control-allow-origin"),"*");
response=await facade.fetch(req(envelope(),{"x-aji-site":"GE"}));
assert.equal(response.status,403);assert.equal((await bodyOf(response)).code,"SITE_NOT_ALLOWED");
response=await facade.fetch(req(envelope(),{"x-aji-sync-key":"wrong-wrong-wrong"}));
assert.equal(response.status,401);assert.equal((await bodyOf(response)).code,"UNAUTHORIZED");
response=await facade.fetch(req(envelope(),{"content-type":"text/plain"}));
assert.equal(response.status,415);assert.equal((await bodyOf(response)).code,"UNSUPPORTED_MEDIA_TYPE");
response=await facade.fetch(req(envelope(),{"content-length":"4000001"}));
assert.equal(response.status,413);assert.equal((await bodyOf(response)).code,"PAYLOAD_TOO_LARGE");
response=await facade.fetch(req(envelope({...basePayload,siteCode:"JA"})));
assert.equal(response.status,400);assert.equal((await bodyOf(response)).code,"INVALID_PAYLOAD");
response=await facade.fetch(req(envelope({...basePayload,affectations:[{externalKey:"A1",siteCode:"BR",emplacementErp:"01-02-03"}]})));
assert.equal(response.status,400);assert.equal((await bodyOf(response)).code,"INVALID_PAYLOAD");
response=await facade.fetch(new Request("https://api.example.test/api/aji-sync",{method:"DELETE",headers:{origin:ORIGIN}}));
assert.equal(response.status,405);

// Successful call: mock Airtable and assert server-only bearer usage.
const calls=[];
globalThis.fetch=async(url,init={})=>{
  calls.push({url:String(url),method:init.method||"GET",authorization:init.headers?.authorization||"",body:init.body||""});
  assert.equal(String(url).includes("api.airtable.com"),true);
  assert.equal(init.headers?.authorization,"Bearer pat_server_only_test");
  if((init.method||"GET")==="GET")return new Response(JSON.stringify({records:[]}),{status:200,headers:{"content-type":"application/json"}});
  return new Response(JSON.stringify({records:[],createdRecords:[],updatedRecords:[]}),{status:200,headers:{"content-type":"application/json"}});
};
const valid=envelope({...basePayload,affectations:[{externalKey:"A1",siteCode:"BR",articleCode:"ART1",designation:"Produit",zonePhysique:"Z1",emplacementErp:"010203",revision:1,updatedAt:"2026-08-17T14:00:00Z",unexpectedAdmin:true}]});
response=await facade.fetch(req(valid));
assert.equal(response.status,200);body=await bodyOf(response);assert.equal(body.ok,true);assert.equal(JSON.stringify(body).includes("pat_server_only_test"),false);
const written=JSON.stringify(calls.map(c=>c.body));
assert.equal(written.includes("unexpectedAdmin"),false,"une propriété non autorisée ne doit jamais être écrite dans Airtable");

// Provider failure must be opaque to the client.
const oldError=console.error;const errorLogs=[];console.error=(...args)=>errorLogs.push(args.join(" "));
globalThis.fetch=async()=>new Response("SECRET_INTERNAL_TABLE appABC patXYZ",{status:500});
response=await facade.fetch(req({...valid,operationId:"op_test_000002"}));
console.error=oldError;
assert.equal(response.status,502);body=await bodyOf(response);assert.equal(body.code,"AIRTABLE_WRITE_FAILED");
const publicBody=JSON.stringify(body);
assert.equal(publicBody.includes("SECRET_INTERNAL_TABLE"),false);assert.equal(publicBody.includes("appABC"),false);assert.equal(publicBody.includes("patXYZ"),false);assert.ok(body.requestId);
assert.ok(errorLogs.length>=1,"l’erreur technique doit être journalisée côté serveur");

console.log("P0.3_API_SECURITY_GATE=PASS");
