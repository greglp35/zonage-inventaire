"use strict";
(function(global){
  const DB_NAME="aji_hub_local_v1";
  const DB_VERSION=1;
  const STORES=Object.freeze({ENTITIES:"entities",OUTBOX:"outbox",TOMBSTONES:"tombstones",META:"meta"});
  const VALID_MUTATIONS=new Set(["upsert","delete"]);
  const VALID_STATUSES=new Set(["pending","blocked"]);

  function now(){return new Date().toISOString()}
  function clone(v){if(v==null)return v;return typeof structuredClone==="function"?structuredClone(v):JSON.parse(JSON.stringify(v))}
  function createOpId(){try{if(global.crypto?.randomUUID)return global.crypto.randomUUID()}catch{}return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`}
  function entityKey(collection,entityId){const c=String(collection||"").trim(),id=String(entityId||"").trim();if(!c||!id)throw new Error("collection et entityId requis");return `${c}:${id}`}
  function asRevision(v){const n=Number(v);return Number.isFinite(n)&&n>=0?Math.floor(n):0}
  function asIso(v){const t=Date.parse(v||"");return Number.isFinite(t)?new Date(t).toISOString():"1970-01-01T00:00:00.000Z"}
  function stableJson(v){if(v==null||typeof v!=="object")return JSON.stringify(v);if(Array.isArray(v))return `[${v.map(stableJson).join(",")}]`;return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stableJson(v[k])}`).join(",")}}`}

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
    const status=String(input.status||"pending").trim().toLowerCase();
    if(!VALID_STATUSES.has(status))throw new Error("status outbox invalide");
    const collection=String(input.collection||"").trim(),entityId=String(input.entityId||"").trim();
    const createdAt=asIso(input.createdAt||now()),opId=String(input.opId||createOpId()).trim();
    if(!opId)throw new Error("opId requis");
    return{opId,eventId:String(input.eventId||opId),entityKey:entityKey(collection,entityId),collection,entityId,mutation,payload:mutation==="delete"?null:clone(input.payload??{}),revision:asRevision(input.revision),baseRevision:asRevision(input.baseRevision),createdAt,updatedAt:asIso(input.updatedAt||createdAt),status,attempts:asRevision(input.attempts),lastAttemptAt:input.lastAttemptAt?asIso(input.lastAttemptAt):null,nextAttemptAt:input.nextAttemptAt?asIso(input.nextAttemptAt):null,lastError:String(input.lastError||"")};
  }

  function openDb(){return new Promise((resolve,reject)=>{if(!global.indexedDB)return reject(new Error("IndexedDB indisponible"));const r=global.indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(STORES.ENTITIES)){const s=db.createObjectStore(STORES.ENTITIES,{keyPath:"entityKey"});s.createIndex("collection","collection",{unique:false});s.createIndex("updatedAt","updatedAt",{unique:false})}if(!db.objectStoreNames.contains(STORES.OUTBOX)){const s=db.createObjectStore(STORES.OUTBOX,{keyPath:"opId"});s.createIndex("status_createdAt",["status","createdAt"],{unique:false});s.createIndex("entityKey","entityKey",{unique:false});s.createIndex("eventId","eventId",{unique:true})}if(!db.objectStoreNames.contains(STORES.TOMBSTONES)){const s=db.createObjectStore(STORES.TOMBSTONES,{keyPath:"entityKey"});s.createIndex("collection","collection",{unique:false});s.createIndex("deletedAt","deletedAt",{unique:false})}if(!db.objectStoreNames.contains(STORES.META))db.createObjectStore(STORES.META,{keyPath:"key"})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error("Ouverture IndexedDB impossible"));r.onblocked=()=>reject(new Error("Migration IndexedDB bloquée par un onglet ouvert"))})}
  function requestResult(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error("Requête IndexedDB en erreur"))})}
  async function withStore(storeNames,mode,worker){const db=await openDb(),names=Array.isArray(storeNames)?storeNames:[storeNames];return new Promise((resolve,reject)=>{let result;const tx=db.transaction(names,mode),stores=Object.fromEntries(names.map(n=>[n,tx.objectStore(n)]));try{result=worker(stores,tx)}catch(err){try{tx.abort()}catch{}db.close();reject(err);return}tx.oncomplete=async()=>{db.close();try{resolve(await result)}catch(err){reject(err)}};tx.onerror=()=>{const err=tx.error||new Error("Transaction IndexedDB en erreur");db.close();reject(err)};tx.onabort=()=>{const err=tx.error||new Error("Transaction IndexedDB annulée");db.close();reject(err)}})}
  async function findDuplicate(store,op){const byOp=await requestResult(store.get(op.opId));if(byOp)return byOp;return requestResult(store.index("eventId").get(op.eventId))}

  async function getOutbox(opId){return withStore(STORES.OUTBOX,"readonly",s=>requestResult(s[STORES.OUTBOX].get(opId)))}
  async function enqueue(input){const op=normalizeOperation(input);return withStore(STORES.OUTBOX,"readwrite",async s=>{const store=s[STORES.OUTBOX],existing=await findDuplicate(store,op);if(existing)return{...clone(existing),duplicate:true};store.add(op);return{...clone(op),duplicate:false}})}
  async function listOutbox(options={}){const status=String(options.status||"pending"),limit=Math.max(1,Math.min(Number(options.limit)||100,1000));return withStore(STORES.OUTBOX,"readonly",s=>new Promise((resolve,reject)=>{const rows=[],store=s[STORES.OUTBOX],source=status?store.index("status_createdAt"):store,range=status&&global.IDBKeyRange?global.IDBKeyRange.bound([status,""],[status,"\uffff"]):null,r=source.openCursor(range,"next");r.onsuccess=()=>{const c=r.result;if(!c||rows.length>=limit){resolve(rows);return}rows.push(clone(c.value));c.continue()};r.onerror=()=>reject(r.error||new Error("Lecture outbox impossible"))}))}
  async function countOutbox(status="pending"){return withStore(STORES.OUTBOX,"readonly",s=>{const store=s[STORES.OUTBOX];if(!status)return requestResult(store.count());const range=global.IDBKeyRange.bound([status,""],[status,"\uffff"]);return requestResult(store.index("status_createdAt").count(range))})}
  async function updateOutbox(opId,patch={}){return withStore(STORES.OUTBOX,"readwrite",async s=>{const store=s[STORES.OUTBOX],item=await requestResult(store.get(opId));if(!item)return null;const next={...item};if(patch.status!=null){const status=String(patch.status).trim().toLowerCase();if(!VALID_STATUSES.has(status))throw new Error("status outbox invalide");next.status=status}if(patch.lastError!=null)next.lastError=String(patch.lastError);if(patch.nextAttemptAt===null)next.nextAttemptAt=null;else if(patch.nextAttemptAt)next.nextAttemptAt=asIso(patch.nextAttemptAt);if(patch.lastAttemptAt)next.lastAttemptAt=asIso(patch.lastAttemptAt);if(patch.attempts!=null)next.attempts=asRevision(patch.attempts);store.put(next);return clone(next)})}
  async function markAttempt(opId,error="",nextAttemptAt=null){return withStore(STORES.OUTBOX,"readwrite",async s=>{const store=s[STORES.OUTBOX],item=await requestResult(store.get(opId));if(!item)return null;item.attempts=asRevision(item.attempts)+1;item.lastAttemptAt=now();item.lastError=String(error||"");item.status="pending";item.nextAttemptAt=nextAttemptAt?asIso(nextAttemptAt):null;store.put(item);return clone(item)})}
  async function block(opId,error=""){return updateOutbox(opId,{status:"blocked",lastError:String(error||""),nextAttemptAt:null})}
  async function retryBlocked(opId){return updateOutbox(opId,{status:"pending",lastError:"",nextAttemptAt:null})}
  async function ack(opId){return withStore(STORES.OUTBOX,"readwrite",async s=>{const store=s[STORES.OUTBOX],item=await requestResult(store.get(opId));if(!item)return{removed:false,opId};store.delete(opId);return{removed:true,opId,eventId:item.eventId}})}

  async function saveEntity(input,options={}){
    const collection=String(input?.collection||"").trim(),entityId=String(input?.entityId||input?.id||"").trim(),key=entityKey(collection,entityId);
    const record={entityKey:key,collection,entityId,revision:asRevision(input.revision),updatedAt:asIso(input.updatedAt||now()),data:clone(input.data??input.payload??input)};
    return withStore([STORES.ENTITIES,STORES.TOMBSTONES,STORES.OUTBOX],"readwrite",async s=>{
      const previous=await requestResult(s[STORES.ENTITIES].get(key));
      const baseRevision=options.baseRevision!=null?asRevision(options.baseRevision):asRevision(previous?.revision);
      const op=options.enqueue===false?null:normalizeOperation({opId:options.opId,eventId:options.eventId,collection,entityId,mutation:"upsert",payload:record.data,revision:record.revision,baseRevision,createdAt:options.createdAt,updatedAt:record.updatedAt});
      if(op){const duplicate=await findDuplicate(s[STORES.OUTBOX],op);if(duplicate){const current=await requestResult(s[STORES.ENTITIES].get(key));return{record:clone(current||null),operation:clone(duplicate),duplicate:true,baseRevision:asRevision(duplicate.baseRevision)}}}
      s[STORES.ENTITIES].put(record);s[STORES.TOMBSTONES].delete(key);if(op)s[STORES.OUTBOX].add(op);
      return{record:clone(record),operation:clone(op),duplicate:false,baseRevision};
    });
  }
  async function getEntity(collection,entityId){return withStore(STORES.ENTITIES,"readonly",s=>requestResult(s[STORES.ENTITIES].get(entityKey(collection,entityId))))}
  async function deleteEntity(collection,entityId,options={}){
    const key=entityKey(collection,entityId),deletedAt=asIso(options.deletedAt||now());
    return withStore([STORES.ENTITIES,STORES.TOMBSTONES,STORES.OUTBOX],"readwrite",async s=>{
      const previous=await requestResult(s[STORES.ENTITIES].get(key));
      const previousTombstone=await requestResult(s[STORES.TOMBSTONES].get(key));
      const baseRevision=options.baseRevision!=null?asRevision(options.baseRevision):asRevision(previous?.revision??previousTombstone?.revision);
      const tombstone={entityKey:key,collection:String(collection),entityId:String(entityId),revision:asRevision(options.revision),baseRevision,deletedAt,updatedAt:deletedAt};
      const op=normalizeOperation({opId:options.opId,eventId:options.eventId,collection,entityId,mutation:"delete",revision:tombstone.revision,baseRevision,createdAt:deletedAt,updatedAt:deletedAt});
      const duplicate=await findDuplicate(s[STORES.OUTBOX],op);if(duplicate){const current=await requestResult(s[STORES.TOMBSTONES].get(key));return{tombstone:clone(current||null),operation:clone(duplicate),duplicate:true,baseRevision:asRevision(duplicate.baseRevision)}}
      s[STORES.ENTITIES].delete(key);s[STORES.TOMBSTONES].put(tombstone);s[STORES.OUTBOX].add(op);
      return{tombstone:clone(tombstone),operation:clone(op),duplicate:false,baseRevision};
    });
  }
  async function getTombstone(collection,entityId){return withStore(STORES.TOMBSTONES,"readonly",s=>requestResult(s[STORES.TOMBSTONES].get(entityKey(collection,entityId))))}
  async function setMeta(key,value){return withStore(STORES.META,"readwrite",s=>{const record={key:String(key),value:clone(value),updatedAt:now()};s[STORES.META].put(record);return record})}
  async function getMeta(key){return withStore(STORES.META,"readonly",s=>requestResult(s[STORES.META].get(String(key))))}
  async function resetForTest(){return withStore([STORES.ENTITIES,STORES.OUTBOX,STORES.TOMBSTONES,STORES.META],"readwrite",s=>{s[STORES.ENTITIES].clear();s[STORES.OUTBOX].clear();s[STORES.TOMBSTONES].clear();s[STORES.META].clear();return true})}

  global.AJILocalDataService={DB_NAME,DB_VERSION,STORES,createOpId,entityKey,normalizeOperation,resolveConflict,enqueue,getOutbox,listOutbox,countOutbox,updateOutbox,markAttempt,block,retryBlocked,ack,saveEntity,getEntity,deleteEntity,getTombstone,setMeta,getMeta,resetForTest};
})(window);
