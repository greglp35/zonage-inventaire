const SITE_RE=/^[A-Z0-9_-]{1,12}$/;
const OP_RE=/^[A-Za-z0-9_-]{6,100}$/;
const BBCCDD_RE=/^[A-Z0-9]{6}$/;
const HARD_MAX_BODY_BYTES=4_000_000;
const HARD_MAX_RECORDS=5_000;
export const EVENT_COLLECTIONS=Object.freeze(["affectations","inventorySessions","inventoryCounts","preparations","preparationLines"]);
const EVENT_COLLECTION_SET=new Set(EVENT_COLLECTIONS);

export function cleanString(value,max=500){return String(value??"").trim().slice(0,max)}
export function normalizeSite(value){return cleanString(value,12).toUpperCase()}
export function validSite(value){return SITE_RE.test(normalizeSite(value))}
export function validOperationId(value){return OP_RE.test(String(value||""))}
export function validBbccdd(value){const s=cleanString(value,32).toUpperCase();return s===""||BBCCDD_RE.test(s)}
export function toBoundedInt(value,fallback,min,max){const n=Number(value);if(!Number.isFinite(n))return fallback;return Math.min(max,Math.max(min,Math.floor(n)))}
export function bodyLimitFromEnv(value){return toBoundedInt(value,3_500_000,32_000,HARD_MAX_BODY_BYTES)}
export function recordLimitFromEnv(value){return toBoundedInt(value,HARD_MAX_RECORDS,1,HARD_MAX_RECORDS)}
export function listFromEnv(value){return String(value||"").split(",").map(x=>x.trim()).filter(Boolean)}
export function parseSiteKeys(raw){
  if(!raw)return{};
  let parsed;
  try{parsed=JSON.parse(String(raw))}catch{return{}};
  if(!parsed||Array.isArray(parsed)||typeof parsed!=="object")return{};
  const out={};
  for(const [site,key] of Object.entries(parsed)){
    const s=normalizeSite(site),k=String(key||"");
    if(validSite(s)&&k.length>=16&&k.length<=512)out[s]=k;
  }
  return out;
}
export function constantTimeEqual(a,b){
  const aa=new TextEncoder().encode(String(a||""));
  const bb=new TextEncoder().encode(String(b||""));
  if(aa.length!==bb.length)return false;
  let diff=0;for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];return diff===0;
}
export function authorizeSite({siteHeader,providedKey,allowedSitesRaw,siteKeysRaw}){
  const site=normalizeSite(siteHeader);
  if(!validSite(site))return{ok:false,status:400,code:"SITE_HEADER_INVALID"};
  const allowed=new Set(listFromEnv(allowedSitesRaw).map(normalizeSite).filter(validSite));
  if(!allowed.size)return{ok:false,status:503,code:"SITE_ALLOWLIST_MISSING"};
  if(!allowed.has(site))return{ok:false,status:403,code:"SITE_NOT_ALLOWED"};
  const keys=parseSiteKeys(siteKeysRaw);
  const expected=keys[site];
  if(!expected)return{ok:false,status:503,code:"SITE_KEY_MISSING"};
  if(!providedKey||!constantTimeEqual(providedKey,expected))return{ok:false,status:401,code:"UNAUTHORIZED"};
  return{ok:true,site};
}
export function originDecision(origin,allowedOriginsRaw,{required=false}={}){
  const value=String(origin||"").trim();
  if(!value)return required?{ok:false,status:403,code:"ORIGIN_REQUIRED"}:{ok:true,origin:""};
  const allowed=new Set(listFromEnv(allowedOriginsRaw));
  if(!allowed.size)return{ok:false,status:503,code:"ORIGIN_ALLOWLIST_MISSING"};
  if(!allowed.has(value))return{ok:false,status:403,code:"ORIGIN_NOT_ALLOWED"};
  return{ok:true,origin:value};
}
export function countPayloadRecords(payload={}){
  const arrays=[payload.affectations,payload.inventorySessions,payload.inventoryCounts,payload.preparations];
  let total=0;
  for(const arr of arrays)if(Array.isArray(arr))total+=arr.length;
  if(Array.isArray(payload.preparations))for(const prep of payload.preparations)if(Array.isArray(prep?.lines))total+=prep.lines.length;
  return total;
}
function isPlainObject(value){if(!value||typeof value!=="object"||Array.isArray(value))return false;const proto=Object.getPrototypeOf(value);return proto===Object.prototype||proto===null}
function validateItemBasics(item,path,site){
  if(!isPlainObject(item))return`${path} doit être un objet`;
  const externalKey=cleanString(item.externalKey,301);
  if(!externalKey||externalKey.length>300)return`${path}.externalKey invalide`;
  if(item.siteCode!=null&&normalizeSite(item.siteCode)!==site)return`${path}.siteCode incohérent`;
  return null;
}
function validateLocation(value,path){return validBbccdd(value)?null:`${path} doit être BBCCDD`}
function validateCheckpoint(body,{headerContract,headerSite,maxRecords}){
  if(headerContract!=="zonage-sync/1.0")return"X-AJI-Contract invalide";
  const p=body.payload;
  if(!isPlainObject(p))return"payload requis";
  if(p.contractVersion!=="1.0")return"contractVersion non supportée";
  const site=normalizeSite(p.siteCode);
  if(!validSite(site))return"siteCode invalide";
  if(site!==normalizeSite(headerSite))return"siteCode différent de X-AJI-Site";
  if(!Number.isInteger(Number(p.revision))||Number(p.revision)<0)return"revision invalide";
  const names=["affectations","inventorySessions","inventoryCounts","preparations"];
  for(const key of names){if(p[key]!=null&&!Array.isArray(p[key]))return`${key} doit être un tableau`}
  if(countPayloadRecords(p)>maxRecords)return`payload dépasse ${maxRecords} enregistrements`;
  for(let i=0;i<(p.affectations||[]).length;i++){const item=p.affectations[i],path=`affectations[${i}]`,e=validateItemBasics(item,path,site);if(e)return e;const le=validateLocation(item.emplacementErp,`${path}.emplacementErp`);if(le)return le}
  for(let i=0;i<(p.inventorySessions||[]).length;i++){const item=p.inventorySessions[i],path=`inventorySessions[${i}]`,e=validateItemBasics(item,path,site);if(e)return e;if(cleanString(item.mode,30).toLowerCase()==="annuel"){const le=validateLocation(item.scope,`${path}.scope`);if(le)return le}}
  for(let i=0;i<(p.inventoryCounts||[]).length;i++){const item=p.inventoryCounts[i],path=`inventoryCounts[${i}]`,e=validateItemBasics(item,path,site);if(e)return e;const le=validateLocation(item.emplacementErp,`${path}.emplacementErp`);if(le)return le}
  for(let i=0;i<(p.preparations||[]).length;i++){const prep=p.preparations[i],path=`preparations[${i}]`,e=validateItemBasics(prep,path,site);if(e)return e;if(prep.lines!=null&&!Array.isArray(prep.lines))return`${path}.lines doit être un tableau`;for(let j=0;j<(prep.lines||[]).length;j++){const line=prep.lines[j],lp=`${path}.lines[${j}]`,le=validateItemBasics(line,lp,site);if(le)return le;const loc=validateLocation(line.emplacementErp,`${lp}.emplacementErp`);if(loc)return loc}}
  return null;
}
function validateEvent(body,{headerContract,headerSite}){
  if(headerContract!=="zonage-sync/1.1")return"X-AJI-Contract invalide";
  const p=body.payload;
  if(!isPlainObject(p))return"payload requis";
  if(p.contractVersion!=="1.1")return"contractVersion non supportée";
  const site=normalizeSite(p.siteCode);
  if(!validSite(site))return"siteCode invalide";
  if(site!==normalizeSite(headerSite))return"siteCode différent de X-AJI-Site";
  if(!validOperationId(p.eventId))return"eventId invalide";
  const collection=cleanString(p.collection,50);
  if(!EVENT_COLLECTION_SET.has(collection))return"collection non supportée";
  const entityId=cleanString(p.entityId,301);
  if(!entityId||entityId.length>300)return"entityId invalide";
  const mutation=cleanString(p.mutation,20).toLowerCase();
  if(!["upsert","delete"].includes(mutation))return"mutation non supportée";
  const revision=Number(p.revision),baseRevision=Number(p.baseRevision);
  if(!Number.isInteger(revision)||revision<0)return"revision invalide";
  if(!Number.isInteger(baseRevision)||baseRevision<0)return"baseRevision invalide";
  if(revision<baseRevision)return"revision inférieure à baseRevision";
  if(p.updatedAt!=null&&!Number.isFinite(Date.parse(p.updatedAt)))return"updatedAt invalide";
  if(mutation==="delete"&&p.data!=null)return"data doit être null pour delete";
  if(mutation==="upsert"){
    if(!isPlainObject(p.data))return"data requise pour upsert";
    if(p.data.siteCode!=null&&normalizeSite(p.data.siteCode)!==site)return"data.siteCode incohérent";
    let error=null;
    if(collection==="affectations"||collection==="inventoryCounts"||collection==="preparationLines")error=validateLocation(p.data.emplacementErp,`data.emplacementErp`);
    if(collection==="inventorySessions"&&cleanString(p.data.mode,30).toLowerCase()==="annuel")error=validateLocation(p.data.scope,`data.scope`);
    if(error)return error;
  }
  return null;
}
export function validateEnvelope(body,{headerContract,headerSite,maxRecords=HARD_MAX_RECORDS}={}){
  if(!isPlainObject(body))return"Corps JSON requis";
  if(!validOperationId(body.operationId))return"operationId invalide";
  if(body.operation==="checkpoint")return validateCheckpoint(body,{headerContract,headerSite,maxRecords});
  if(body.operation==="event")return validateEvent(body,{headerContract,headerSite});
  return"operation non supportée";
}
export async function parseJsonRequest(request,maxBytes){
  const type=String(request.headers.get("content-type")||"").toLowerCase();
  if(!type.startsWith("application/json"))return{ok:false,status:415,code:"UNSUPPORTED_MEDIA_TYPE"};
  const declared=Number(request.headers.get("content-length")||0);
  if(Number.isFinite(declared)&&declared>maxBytes)return{ok:false,status:413,code:"PAYLOAD_TOO_LARGE"};
  let text;
  try{text=await request.text()}catch{return{ok:false,status:400,code:"INVALID_BODY"}};
  const bytes=new TextEncoder().encode(text).byteLength;
  if(bytes>maxBytes)return{ok:false,status:413,code:"PAYLOAD_TOO_LARGE"};
  try{return{ok:true,body:JSON.parse(text),bytes}}catch{return{ok:false,status:400,code:"INVALID_JSON"}};
}
export const LIMITS={HARD_MAX_BODY_BYTES,HARD_MAX_RECORDS};
