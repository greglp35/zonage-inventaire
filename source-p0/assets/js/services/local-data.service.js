"use strict";
(function(global){
  const DB_NAME = "aji_hub_local_v1";
  const DB_VERSION = 1;
  const STORES = Object.freeze({ENTITIES:"entities",OUTBOX:"outbox",TOMBSTONES:"tombstones",META:"meta"});
  const VALID_MUTATIONS = new Set(["upsert","delete"]);

  function now(){return new Date().toISOString()}
  function clone(value){if(value==null)return value;try{return typeof structuredClone==="function"?structuredClone(value):JSON.parse(JSON.stringify(value))}catch{return JSON.parse(JSON.stringify(value))}}
  function randomPart(){return Math.random().toString(36).slice(2,10)}
  function createOpId(){try{if(global.crypto?.randomUUID)return global.crypto.randomUUID()}catch{}return `op_${Date.now().toString(36)}_${randomPart()}`}
  function entityKey(collection,entityId){const c=String(collection||"").trim(),id=String(entityId||"").trim();if(!c||!id)throw new Error("collection et entityId requis");return `${c}:${id}`}
  function asRevision(value){const n=Number(value);return Number.isFinite(n)&&n>=0?Math.floor(n):0}
  function asIso(value){const t=Date.parse(value||"");return Number.isFinite(t)?new Date(t).toISOString():"1970-01-01T00:00:00.000Z"}
  function stableJson(value){if(value==null||typeof value!=="object")return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(stableJson).join(",")}]`;return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`}

  function resolveConflict(localRecord,remoteRecord){
    if(!localRecord&&!remoteRecord)return{winner:null,source:"none",reason:"empty"};
    if(!localRecord)return{winner:clone(remoteRecord),source:"remote",reason:"local_missing"};
    if(!remoteRecord)return{winner:clone(localRecord),source:"local",reason:"remote_missing"};
    const lr=asRevision(localRecord.revision),rr=asRevision(remoteRecord.revision);
    if(lr!==rr)return lr>rr?{winner:clone(localRecord),source:"local",reason:"higher_revision"}:{winner:clone(remoteRecord),source:"remote",reason:"higher_revision"};
    const lt=Date.parse(asIso(localRecord.updatedAt)),rt=Date.parse(asIso(remoteRecord.updatedAt));
    if(lt!==rt)return lt>rt?{winner:clone(localRecord),source:"local",reason:"newer_updatedAt"}:{winner:clone(remoteRecord),source:"remote",reason:"newer_updatedAt"};
    return stableJson(localRecord)>=stableJson(remoteRecord)?{winner:clone(localRecord),source:"local",reason:"stable_tiebreak"}:{winner:clone(remoteRecord),source:"remote",reason:"stable_tiebreak"};
  }

  function normalizeOperation(input={}){
    const mutation=String(input.mutation||"upsert").trim().toLowerCase();
    if(!VALID_MUTATIONS.has(mutation))throw new Error("mutation invalide");
    const collection=String(input.collection||"").trim(),entityId=String(input.entityId||"").trim();
    const key=entityKey(collection,entityId),createdAt=asIso(input.createdAt||now()),opId=String(input.opId||createOpId()).trim();
    if(!opId)throw new Error("opId requis");
    return{opId,eventId:String(input.eventId||opId),entityKey:key,collection,entityId,mutation,payload:mutation==="delete"?null:clone(input.payload??{}),revision:asRevision(input.revision),baseRevision:asRevision(input.baseRevision),createdAt,updatedAt:asIso(input.updatedAt||createdAt),status:String(input.status||"pending"),attempts:asRevision(input.attempts),lastAttemptAt:input.lastAttemptAt?asIso(input.lastAttemptAt):null,lastError:String(input.lastError||"")};
  }

  function openDb(){return new Promise((resolve,reject)=>{if(!global.indexedDB)return reject(new Error("IndexedDB indisponible"));const request=global.indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(STORES.ENTITIES)){const s=db.createObjectStore(STORES.ENTITIES,{keyPath:"entityKey"});s.createIndex("collection","collection",{unique:false});s.createIndex("updatedAt","updatedAt",{unique:false})}if(!db.objectStoreNames.contains(STORES.OUTBOX)){const s=db.createObjectStore(STORES.OUTBOX,{keyPath:"opId"});s.createIndex("status_createdAt",["status","createdAt"],{unique:false});s.createIndex("entityKey","entityKey",{unique:false});s.createIndex("eventId","eventId",{unique:true})}if(!db.objectStoreNames.contains(STORES.TOMBSTONES)){const s=db.createObjectStore(STORES.TOMBSTONES,{keyPath:"entityKey"});s.createIndex("collection","collection",{unique:false});s.createIndex("deletedAt","deletedAt",{unique:false})}if(!db.objectStoreNames.contains(STORES.META))db.createObjectStore(STORES.META,{keyPath:"key"})};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error("Ouverture IndexedDB impossible"));request.onblocked=()=>reject(new Error("Migration IndexedDB bloquée par un onglet ouvert"))})}
  function requestResult(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error("Requête IndexedDB en erreur"))})}
  async function withStore(storeNames,mode,worker){const db=await openDb();const names=Array.isArray(storeNames)?storeNames:[storeNames];return new Promise((resolve,reject)=>{let result;const tx=db.transaction(names,mode),stores=Object.fromEntries(names.map(name=>[name,tx.objectStore(name)]));try{result=worker(stores,tx)}catch(err){try{tx.abort()}catch{}db.close();reject(err);return}tx.oncomplete=async()=>{db.close();try{resolve(await result)}catch(err){reject(err)}};tx.onerror=()=>{const err=tx.error||new Error("Transaction IndexedDB en erreur");db.close();reject(err)};tx.onabort=()=>{const err=tx.error||new Error("Transaction IndexedDB annulée");db.close();reject(err)}})}

  async function getOutbox(opId){return withStore(STORES.OUTBOX,"readonly",s=>requestResult(s[STORES.OUTBOX].get(opId)))}
  async function enqueue(input){const operation=normalizeOperation(input);return withStore(STORES.OUTBOX,"readwrite",async s=>{const store=s[STORES.OUTBOX],existing=await requestResult(store.get(operation.opId));if(existing)return existing;const existingEvent=await requestResult(store.index("eventId").get(operation.eventId));if(existingEvent)return existingEvent;store.add(operation);return operation})}
  async function listOutbox(options={}){const status=String(options.status||"pending"),limit=Math.max(1,Math.min(Number(options.limit)||100,1000));return withStore(STORES.OUTBOX,"readonly",s=>new Promise((resolve,reject)=>{const rows=[],store=s[STORES.OUTBOX],source=status?store.index("status_createdAt"):store,range=status&&global.IDBKeyRange?global.IDBKeyRange.bound([status,""],[status,"\uffff"]):null,request=source.openCursor(range,"next");request.onsuccess=()=>{const cursor=request.result;if(!cursor||rows.length>=limit){resolve(rows);return}rows.push(clone(cursor.value));cursor.continue()};request.onerror=()=>reject(request.error||new Error("Lecture outbox impossible"))}))}
  async function countOutbox(status="pending"){return withStore(STORES.OUTBOX,"readonly",s=>{const store=s[STORES.OUTBOX];if(!status)return requestResult(store.count());const idx=store.index("status_createdAt"),range=global.IDBKeyRange.bound([status,""],[status,"\uffff"]);return requestResult(idx.count(range))})}
  async function markAttempt(opId,error=""){return withStore(STORES.OUTBOX,"readwrite",async s=>{const store=s[STORES.OUTBOX],item=await requestResult(store.get(opId));if(!item)return null;item.attempts=asRevision(item.attempts)+1;item.lastAttemptAt=now();item.lastError=String(error||"");store.put(item);return clone(item)})}
  async function ack(opId){return withStore(STORES.OUTBOX,"readwrite",async s=>{const store=s[STORES.OUTBOX],item=await requestResult(store.get(opId));if(!item)return{removed:false,opId};store.delete(opId);return{removed:true,opId,eventId:item.eventId}})}

  async function saveEntity(input,options={}){const collection=String(input?.collection||"").trim(),entityId=String(input?.entityId||input?.id||"").trim(),key=entityKey(collection,entityId),record={entityKey:key,collection,entityId,revision:asRevision(input.revision),updatedAt:asIso(input.updatedAt||now()),data:clone(input.data??input.payload??input)},op=options.enqueue===false?null:normalizeOperation({opId:options.opId,eventId:options.eventId,collection,entityId,mutation:"upsert",payload:record.data,revision:record.revision,baseRevision:options.baseRevision,createdAt:options.createdAt,updatedAt:record.updatedAt});return withStore([STORES.ENTITIES,STORES.TOMBSTONES,STORES.OUTBOX],"readwrite",async s=>{s[STORES.ENTITIES].put(record);s[STORES.TOMBSTONES].delete(key);if(op){const existing=await requestResult(s[STORES.OUTBOX].get(op.opId));if(!existing)s[STORES.OUTBOX].add(op)}return{record:clone(record),operation:clone(op)}})}
  async function getEntity(collection,entityId){return withStore(STORES.ENTITIES,"readonly",s=>requestResult(s[STORES.ENTITIES].get(entityKey(collection,entityId))))}
  async function deleteEntity(collection,entityId,options={}){const key=entityKey(collection,entityId),deletedAt=asIso(options.deletedAt||now()),tombstone={entityKey:key,collection:String(collection),entityId:String(entityId),revision:asRevision(options.revision),deletedAt,updatedAt:deletedAt},op=normalizeOperation({opId:options.opId,eventId:options.eventId,collection,entityId,mutation:"delete",revision:tombstone.revision,baseRevision:options.baseRevision,createdAt:deletedAt,updatedAt:deletedAt});return withStore([STORES.ENTITIES,STORES.TOMBSTONES,STORES.OUTBOX],"readwrite",async s=>{s[STORES.ENTITIES].delete(key);s[STORES.TOMBSTONES].put(tombstone);const existing=await requestResult(s[STORES.OUTBOX].get(op.opId));if(!existing)s[STORES.OUTBOX].add(op);return{tombstone:clone(tombstone),operation:clone(op)}})}
  async function getTombstone(collection,entityId){return withStore(STORES.TOMBSTONES,"readonly",s=>requestResult(s[STORES.TOMBSTONES].get(entityKey(collection,entityId))))}
  async function setMeta(key,value){return withStore(STORES.META,"readwrite",s=>{const record={key:String(key),value:clone(value),updatedAt:now()};s[STORES.META].put(record);return record})}
  async function getMeta(key){return withStore(STORES.META,"readonly",s=>requestResult(s[STORES.META].get(String(key))))}
  async function resetForTest(){const db=await openDb();db.close();return new Promise((resolve,reject)=>{const request=global.indexedDB.deleteDatabase(DB_NAME);request.onsuccess=()=>resolve(true);request.onerror=()=>reject(request.error||new Error("Suppression DB impossible"));request.onblocked=()=>reject(new Error("Suppression DB bloquée"))})}

  global.AJILocalDataService={DB_NAME,DB_VERSION,STORES,createOpId,entityKey,normalizeOperation,resolveConflict,enqueue,getOutbox,listOutbox,countOutbox,markAttempt,ack,saveEntity,getEntity,deleteEntity,getTombstone,setMeta,getMeta,resetForTest};
})(window);
