"use strict";
(function(global){
  const DB_NAME="aji_terrain_v31";
  const DB_STORE="snapshots";
  const DB_KEY="state";
  let primaryTimer=null;
  let pendingPrimary=null;
  let pendingKey=null;
  let pendingErrorHandler=null;
  let backupQueue=Promise.resolve();

  function clone(value){
    if(value==null)return value;
    try{return typeof structuredClone==="function"?structuredClone(value):JSON.parse(JSON.stringify(value))}
    catch{return JSON.parse(JSON.stringify(value))}
  }
  function fnv1a(text){
    let h=0x811c9dc5;
    for(let i=0;i<text.length;i++){
      h^=text.charCodeAt(i);
      h=Math.imul(h,0x01000193)>>>0;
    }
    return h.toString(16).padStart(8,"0");
  }
  function prepareSnapshot(state){
    const snap=clone(state)||{};
    delete snap._integrity;
    const basis=JSON.stringify(snap);
    snap._integrity={alg:"fnv1a32",hash:fnv1a(basis)};
    return snap;
  }
  function verifySnapshot(snapshot){
    if(!snapshot||typeof snapshot!=="object")return{ok:false,reason:"snapshot absent"};
    if(!snapshot._integrity?.hash)return{ok:true,legacy:true};
    const copy=clone(snapshot);
    const expected=copy._integrity.hash;
    delete copy._integrity;
    const actual=fnv1a(JSON.stringify(copy));
    return{ok:actual===expected,legacy:false,expected,actual,reason:actual===expected?"":"checksum incohérent"};
  }
  function openDb(){
    return new Promise((resolve,reject)=>{
      if(!global.indexedDB)return reject(new Error("IndexedDB indisponible"));
      const r=global.indexedDB.open(DB_NAME,1);
      r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(DB_STORE))db.createObjectStore(DB_STORE)};
      r.onsuccess=()=>resolve(r.result);
      r.onerror=()=>reject(r.error||new Error("Ouverture IndexedDB impossible"));
    });
  }
  async function saveBackupNow(snapshot){
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(DB_STORE,"readwrite");
      tx.objectStore(DB_STORE).put(snapshot,DB_KEY);
      tx.oncomplete=()=>{db.close();resolve(true)};
      tx.onerror=()=>{const err=tx.error;db.close();reject(err)};
      tx.onabort=()=>{const err=tx.error;db.close();reject(err)};
    });
  }
  function saveBackup(snapshot){
    const copy=clone(snapshot);
    backupQueue=backupQueue.catch(()=>{}).then(()=>saveBackupNow(copy));
    return backupQueue;
  }
  async function readBackup(){
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(DB_STORE,"readonly");
      const r=tx.objectStore(DB_STORE).get(DB_KEY);
      r.onsuccess=()=>{db.close();resolve(r.result||null)};
      r.onerror=()=>{const err=r.error;db.close();reject(err)};
    });
  }
  async function clearBackup(){
    try{
      const db=await openDb();
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(DB_STORE,"readwrite");
        tx.objectStore(DB_STORE).delete(DB_KEY);
        tx.oncomplete=()=>{db.close();resolve(true)};
        tx.onerror=()=>{const err=tx.error;db.close();reject(err)};
      });
    }catch{return false}
  }
  function readPrimary(key){
    try{
      const raw=global.localStorage?.getItem(key);
      return raw?JSON.parse(raw):null;
    }catch{return null}
  }
  function writePrimaryNow(key,snapshot){
    global.localStorage.setItem(key,JSON.stringify(snapshot));
    return true;
  }
  function cancelPending(){
    if(primaryTimer){clearTimeout(primaryTimer);primaryTimer=null}
    pendingPrimary=null;pendingKey=null;pendingErrorHandler=null;
  }
  function flushPrimary(){
    if(primaryTimer){clearTimeout(primaryTimer);primaryTimer=null}
    if(!pendingPrimary||!pendingKey)return true;
    const snapshot=pendingPrimary,key=pendingKey,onError=pendingErrorHandler;
    pendingPrimary=null;pendingKey=null;pendingErrorHandler=null;
    try{return writePrimaryNow(key,snapshot)}catch(err){try{onError?.(err)}catch{}return false}
  }
  function schedulePrimary(key,snapshot,onError,delay=120){
    pendingKey=key;pendingPrimary=snapshot;pendingErrorHandler=onError||null;
    if(primaryTimer)clearTimeout(primaryTimer);
    primaryTimer=setTimeout(flushPrimary,delay);
  }
  function rank(snapshot){
    if(!snapshot)return[-1,0];
    const rev=Number(snapshot.revision)||0;
    const t=Date.parse(snapshot.lastChange||snapshot.lastSave||0)||0;
    return[rev,t];
  }
  function chooseLatest(local,backup){
    const candidates=[];
    for(const [source,snap] of [["localStorage",local],["IndexedDB",backup]]){
      if(!snap)continue;
      const integrity=verifySnapshot(snap);
      if(integrity.ok)candidates.push({source,snapshot:snap,integrity,rank:rank(snap)});
    }
    if(!candidates.length)return{source:null,snapshot:null,warning:(local||backup)?"Aucune sauvegarde locale intègre n'a pu être validée.":""};
    candidates.sort((a,b)=>b.rank[0]-a.rank[0]||b.rank[1]-a.rank[1]||(a.source==="IndexedDB"?-1:1));
    const selected=candidates[0];
    const invalid=[];
    if(local&&!verifySnapshot(local).ok)invalid.push("localStorage");
    if(backup&&!verifySnapshot(backup).ok)invalid.push("IndexedDB");
    return{source:selected.source,snapshot:selected.snapshot,warning:invalid.length?`Copie ignorée (intégrité) : ${invalid.join(", ")}.`:""};
  }
  async function loadLatest(key){
    const local=readPrimary(key);
    let backup=null;
    try{backup=await readBackup()}catch{}
    return chooseLatest(local,backup);
  }
  async function clearAll(key){
    cancelPending();
    try{global.localStorage?.removeItem(key)}catch{}
    await clearBackup();
  }
  async function requestPersistence(){
    if(!global.navigator?.storage?.persist)return{supported:false,persisted:false};
    try{return{supported:true,persisted:await global.navigator.storage.persist()}}catch{return{supported:true,persisted:false}}
  }
  async function estimate(){
    if(!global.navigator?.storage?.estimate)return null;
    try{return await global.navigator.storage.estimate()}catch{return null}
  }
  global.AJIStorageService={prepareSnapshot,verifySnapshot,saveBackup,readBackup,readPrimary,schedulePrimary,flushPrimary,cancelPending,loadLatest,chooseLatest,clearAll,requestPersistence,estimate,fnv1a};
})(window);
