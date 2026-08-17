"use strict";
(function(global){
  const DB_NAME="aji_terrain_sync_v1";
  const STORE="outbox";
  const CONFIG_KEY="aji_sync_config_v2";
  const LEGACY_CONFIG_KEY="aji_sync_config_v1";
  const SESSION_SECRET_KEY="aji_sync_session_key_v1";
  const OUTBOX_KEY="checkpoint";
  let flushing=false;

  function now(){return new Date().toISOString()}
  function uid(){return "sync_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,8)}
  function normalizeTfiLocation(v){const raw=String(v??"").toUpperCase().replace(/[^A-Z0-9]/g,"");return raw.length===6?raw:""}
  function readSessionSecret(){try{return String(global.sessionStorage?.getItem(SESSION_SECRET_KEY)||"")}catch{return""}}
  function writeSessionSecret(value){try{if(value)global.sessionStorage?.setItem(SESSION_SECRET_KEY,value);else global.sessionStorage?.removeItem(SESSION_SECRET_KEY)}catch{}}
  function readPersistent(){
    let c={};
    try{const raw=global.localStorage?.getItem(CONFIG_KEY);c=raw?JSON.parse(raw):{}}catch{}
    if(!c.endpoint&&!c.siteCode){
      try{const raw=global.localStorage?.getItem(LEGACY_CONFIG_KEY);const legacy=raw?JSON.parse(raw):{};c={endpoint:legacy.endpoint||"",siteCode:legacy.siteCode||"BR"};global.localStorage?.setItem(CONFIG_KEY,JSON.stringify(c));global.localStorage?.removeItem(LEGACY_CONFIG_KEY)}catch{}
    }
    return c;
  }
  function readConfig(){const c=readPersistent();return{endpoint:String(c.endpoint||((global.location?.protocol==="https:")?"/api/aji-sync":"")),siteCode:String(c.siteCode||"BR").trim().toUpperCase()||"BR",syncKey:readSessionSecret()}}
  function configure(config={}){
    const current=readConfig();
    const next={endpoint:String(config.endpoint??current.endpoint).trim(),siteCode:String(config.siteCode??current.siteCode).trim().toUpperCase()||"BR",syncKey:String(config.syncKey??current.syncKey).trim()};
    if(next.endpoint&&!(/^https:\/\//i.test(next.endpoint)||next.endpoint.startsWith("/")))throw new Error("L'endpoint de synchronisation doit être en HTTPS ou relatif au site.");
    global.localStorage?.setItem(CONFIG_KEY,JSON.stringify({endpoint:next.endpoint,siteCode:next.siteCode}));
    writeSessionSecret(next.syncKey);
    return next;
  }
  function openDb(){return new Promise((resolve,reject)=>{if(!global.indexedDB)return reject(new Error("IndexedDB indisponible"));const r=global.indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:"key"})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error("Ouverture outbox impossible"))})}
  async function put(item){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(item);tx.oncomplete=()=>{db.close();resolve(item)};tx.onerror=()=>{const e=tx.error;db.close();reject(e)}})}
  async function get(key=OUTBOX_KEY){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readonly");const r=tx.objectStore(STORE).get(key);r.onsuccess=()=>{db.close();resolve(r.result||null)};r.onerror=()=>{const e=r.error;db.close();reject(e)}})}
  async function remove(key=OUTBOX_KEY){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(key);tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>{const e=tx.error;db.close();reject(e)}})}
  function normalizeState(state,siteCode){
    const updatedAt=state.lastChange||now(),revision=Number(state.revision)||0;
    const loc=v=>normalizeTfiLocation(v);
    return{
      contractVersion:"1.0",siteCode,revision,updatedAt,
      affectations:(state.zonage||[]).map(z=>({externalKey:z.id||`${siteCode}:${z.code}:${loc(z.loc)||z.zone||""}`,siteCode,articleCode:z.code||"",designation:z.libelle||"",zonePhysique:z.zone||"",emplacementErp:loc(z.loc),revision,updatedAt})),
      inventorySessions:(state.inventaireSessions||[]).map(s=>({externalKey:s.id,siteCode,mode:s.mode||"tournant",scope:(s.mode||"tournant")==="annuel"?loc(s.scope||s.location||s.zone||""):(s.scope||s.zone||""),status:s.status||"ouverte",openedAt:s.startedAt||s.createdAt||null,closedAt:s.closedAt||null,revision,updatedAt})),
      inventoryCounts:(state.inventaire||[]).map(c=>({externalKey:c.id||`${siteCode}:${c.sessionId||""}:${c.code||""}:${c.date||c.countedAt||updatedAt}`,sessionKey:c.sessionId||"",siteCode,articleCode:c.code||"",designation:c.libelle||"",zonePhysique:c.zone||"",emplacementErp:loc(c.emplacement||c.location||c.loc||""),theoretical:Number(c.stockTheo??c.theorique??c.theo??0),counted:Number(c.stockCompte??c.compte??c.count??0),gap:Number(c.ecart??0),cause:c.cause||"",status:c.statut||c.status||"",observation:c.obs||c.observation||"",duplicateScan:!!c.duplicateScan,countedAt:c.date||c.countedAt||updatedAt,revision,updatedAt})),
      preparations:(state.preparations||[]).map(p=>({externalKey:p.id,siteCode,orderNumber:p.number||p.numero||"",customer:p.customer||p.client||"",status:p.status||"En cours",createdAt:p.createdAt||null,closedAt:p.closedAt||null,revision,updatedAt,lines:(p.lines||[]).map(l=>({externalKey:l.id||`${p.id}:${l.code}`,preparationKey:p.id,siteCode,articleCode:l.code||"",designation:l.libelle||"",expected:Number(l.expected??l.qtyExpected??l.qty??0),picked:Number(l.picked??0),status:l.status||"",emplacementErp:loc(l.emplacementErp||l.location||l.loc||(Array.isArray(l.locations)?l.locations[0]:"")),revision,updatedAt}))}))
    }
  }
  async function enqueueCheckpoint(state){const config=readConfig(),payload=normalizeState(state,config.siteCode);const previous=await get().catch(()=>null);const item={key:OUTBOX_KEY,operationId:previous?.operationId||uid(),operation:"checkpoint",createdAt:previous?.createdAt||now(),updatedAt:now(),attempts:previous?.attempts||0,lastError:"",payload};await put(item);if(global.navigator?.onLine)flush().catch(()=>{});return item}
  async function flush(){
    if(flushing)return{ok:false,reason:"busy"};flushing=true;
    try{
      const config=readConfig();if(!config.endpoint)return{ok:false,reason:"not_configured"};let endpoint;try{endpoint=new URL(config.endpoint,global.location?.origin||undefined)}catch{return{ok:false,reason:"invalid_endpoint"}}if(endpoint.protocol!=="https:")return{ok:false,reason:"insecure_endpoint"};if(!config.syncKey)return{ok:false,reason:"missing_sync_key"};
      const item=await get();if(!item)return{ok:true,reason:"empty"};item.attempts=(item.attempts||0)+1;item.lastAttemptAt=now();await put(item);
      let response;try{response=await fetch(endpoint.href,{method:"POST",headers:{"Content-Type":"application/json","X-AJI-Contract":"zonage-sync/1.0","X-AJI-Sync-Key":config.syncKey},body:JSON.stringify({operationId:item.operationId,operation:item.operation,payload:item.payload})})}catch(err){item.lastError=String(err?.message||err);await put(item);return{ok:false,reason:"network",error:item.lastError}}
      if(!response.ok){item.lastError=`HTTP ${response.status}`;await put(item);return{ok:false,reason:"http",status:response.status}}await remove();return{ok:true,reason:"synced",status:response.status}
    }finally{flushing=false}
  }
  async function status(){const config=readConfig(),item=await get().catch(()=>null);return{configured:!!config.endpoint&&!!config.syncKey,endpoint:config.endpoint,siteCode:config.siteCode,protected:!!config.syncKey,pending:!!item,attempts:item?.attempts||0,lastError:item?.lastError||"",revision:item?.payload?.revision??null}}
  global.addEventListener?.("online",()=>flush().catch(()=>{}));
  global.AJISyncService={configure,readConfig,normalizeTfiLocation,normalizeState,enqueueCheckpoint,flush,status};
})(window);
