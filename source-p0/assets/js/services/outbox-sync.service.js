"use strict";
(function(global){
  let flushing=false;
  let retryTimer=null;
  const PERMANENT_4XX=new Set([400,401,403,404,409,413,415,422]);

  function nowMs(){return Date.now()}
  function iso(ms){return new Date(ms).toISOString()}
  function local(){const s=global.AJILocalDataService;if(!s)throw new Error("AJILocalDataService requis");return s}
  function config(){const s=global.AJISyncService;if(!s?.readConfig)throw new Error("AJISyncService.readConfig requis");return s.readConfig()}
  function computeBackoff(attempt,retryAfter="",randomValue=Math.random()){
    const sec=Number(String(retryAfter||"").trim());
    if(Number.isFinite(sec)&&sec>0)return Math.min(120000,Math.max(1000,sec*1000));
    const n=Math.max(1,Number(attempt)||1),base=Math.min(60000,1000*(2**Math.min(6,n-1)));
    const jitter=Math.floor(base*0.25*Math.max(0,Math.min(1,Number(randomValue)||0)));
    return base+jitter;
  }
  function classify(status){
    const s=Number(status)||0;
    if(s>=200&&s<300)return"ack";
    if(s===0||s===408||s===425||s===429||s>=500)return"retry";
    if(PERMANENT_4XX.has(s)||(s>=400&&s<500))return"blocked";
    return"retry";
  }
  function buildEnvelope(op,siteCode){return{
    operationId:op.opId,
    operation:"event",
    payload:{
      contractVersion:"1.1",
      siteCode,
      eventId:op.eventId,
      collection:op.collection,
      entityId:op.entityId,
      mutation:op.mutation,
      revision:Number(op.revision)||0,
      baseRevision:Number(op.baseRevision)||0,
      updatedAt:op.updatedAt||op.createdAt||new Date().toISOString(),
      data:op.mutation==="delete"?null:op.payload
    }
  }}
  async function responseCode(response){try{return String((await response.clone().json())?.code||"")}catch{return""}}
  function schedule(delay){
    if(retryTimer)clearTimeout(retryTimer);
    retryTimer=setTimeout(()=>{retryTimer=null;flush().catch(()=>{})},Math.max(250,delay||1000));
  }
  async function sendOne(op,{force=false,scheduleRetry=true}={}){
    const cfg=config();
    if(!cfg.endpoint||!cfg.siteCode||!cfg.syncKey)return{ok:false,reason:"not_configured"};
    if(!force&&op.nextAttemptAt&&Date.parse(op.nextAttemptAt)>nowMs())return{ok:false,reason:"backoff",until:op.nextAttemptAt};
    const endpoint=new URL(cfg.endpoint,global.location.origin);
    if(endpoint.origin!==global.location.origin)return{ok:false,reason:"cross_origin_endpoint"};
    if(endpoint.protocol!=="https:"&&!['localhost','127.0.0.1','::1'].includes(endpoint.hostname))return{ok:false,reason:"insecure_endpoint"};
    let response;
    try{
      response=await fetch(endpoint.href,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-AJI-Contract":"zonage-sync/1.1","X-AJI-Site":cfg.siteCode,"X-AJI-Sync-Key":cfg.syncKey},body:JSON.stringify(buildEnvelope(op,cfg.siteCode))});
    }catch(error){
      const attempts=(op.attempts||0)+1,delay=computeBackoff(attempts),next=iso(nowMs()+delay);
      await local().markAttempt(op.opId,`NETWORK ${String(error?.message||error)}`,next);
      if(scheduleRetry&&global.navigator?.onLine)schedule(delay);
      return{ok:false,reason:"retry",status:0,delay,nextAttemptAt:next};
    }
    const action=classify(response.status),code=await responseCode(response);
    if(action==="ack"){
      const ack=await local().ack(op.opId);
      return{ok:true,reason:"acked",status:response.status,code,ack};
    }
    if(action==="blocked"){
      await local().block(op.opId,code?`HTTP ${response.status} ${code}`:`HTTP ${response.status}`);
      return{ok:false,reason:"blocked",status:response.status,code};
    }
    const attempts=(op.attempts||0)+1,delay=computeBackoff(attempts,response.headers.get("retry-after")),next=iso(nowMs()+delay);
    await local().markAttempt(op.opId,code?`HTTP ${response.status} ${code}`:`HTTP ${response.status}`,next);
    if(scheduleRetry&&global.navigator?.onLine)schedule(delay);
    return{ok:false,reason:"retry",status:response.status,code,delay,nextAttemptAt:next};
  }
  async function flush(options={}){
    if(flushing)return{ok:false,reason:"busy"};
    flushing=true;
    const summary={ok:true,reason:"complete",acked:0,blocked:0,retry:0,processed:0};
    try{
      const limit=Math.max(1,Math.min(Number(options.limit)||100,1000));
      const pending=await local().listOutbox({status:"pending",limit});
      for(const op of pending){
        const result=await sendOne(op,options);
        if(result.reason==="backoff"){summary.reason="backoff";break}
        summary.processed++;
        if(result.reason==="acked"){summary.acked++;continue}
        if(result.reason==="blocked"){summary.blocked++;continue}
        if(result.reason==="retry"){summary.retry++;summary.ok=false;summary.reason="retry";break}
        summary.ok=false;summary.reason=result.reason||"stopped";break;
      }
      const remaining=await local().countOutbox("pending"),blocked=await local().countOutbox("blocked");
      return{...summary,remaining,blockedTotal:blocked};
    }finally{flushing=false}
  }
  async function status(){return{pending:await local().countOutbox("pending"),blocked:await local().countOutbox("blocked"),flushing}}
  global.addEventListener?.("online",()=>flush().catch(()=>{}));
  global.AJIOutboxSyncService={computeBackoff,classify,buildEnvelope,sendOne,flush,status};
})(window);
