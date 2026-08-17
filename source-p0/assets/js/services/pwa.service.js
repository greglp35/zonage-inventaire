"use strict";
(function(global){
  function setStatus(text,type="info"){
    const el=document.getElementById("pwaStatus");if(el){el.textContent=text;el.dataset.state=type}
    const top=document.getElementById("pwaBadge");if(top)top.textContent=text;
  }
  function refreshNetwork(){
    const mode=navigator.onLine?"En ligne":"Hors ligne";
    const controlled=!!navigator.serviceWorker?.controller;
    setStatus(`${mode}${controlled?" · PWA prête":" · cache en préparation"}`,navigator.onLine?"ok":"warn");
  }
  async function register(){
    if(!("serviceWorker" in navigator)){setStatus("Service Worker indisponible","err");return null}
    const local=["localhost","127.0.0.1","::1"].includes(location.hostname);
    if(location.protocol!=="https:"&&!local){setStatus("HTTPS requis pour la PWA","err");return null}
    try{
      const reg=await navigator.serviceWorker.register("./sw.js");
      navigator.serviceWorker.addEventListener("controllerchange",refreshNetwork);
      reg.addEventListener("updatefound",()=>setStatus("Mise à jour PWA détectée","info"));
      refreshNetwork();return reg;
    }catch(err){console.error("[PWA]",err);setStatus("PWA non installée","err");return null}
  }
  global.addEventListener("online",refreshNetwork);global.addEventListener("offline",refreshNetwork);
  global.AJIPWAService={register,refreshNetwork,setStatus};
})(window);
