"use strict";
(function(global){
  const PARTS=Array.from({length:4},(_,i)=>`./assets/js/vendor/html5-qrcode.part${String(i+1).padStart(2,"0")}.b64`);
  let promise=null;
  async function ensureHtml5Qrcode(){
    if(global.Html5Qrcode)return true;
    if(promise)return promise;
    promise=(async()=>{
      const chunks=await Promise.all(PARTS.map(async url=>{const r=await fetch(url);if(!r.ok)throw new Error(`Vendor scanner manquant: ${url}`);return r.text()}));
      const bytes=Uint8Array.from(atob(chunks.join("")),c=>c.charCodeAt(0));
      if(typeof DecompressionStream!=="function")throw new Error("DecompressionStream requis pour charger le fallback scanner local.");
      const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      const js=await new Response(stream).text();
      const blobUrl=URL.createObjectURL(new Blob([js],{type:"text/javascript"}));
      try{await new Promise((resolve,reject)=>{const s=document.createElement("script");s.src=blobUrl;s.onload=resolve;s.onerror=()=>reject(new Error("Exécution vendor scanner impossible"));document.head.appendChild(s)})}finally{URL.revokeObjectURL(blobUrl)}
      if(!global.Html5Qrcode)throw new Error("html5-qrcode non initialisé après chargement");
      return true;
    })();
    try{return await promise}finally{if(!global.Html5Qrcode)promise=null}
  }
  global.AJIVendorLoader={ensureHtml5Qrcode,parts:PARTS.slice()};
})(window);
