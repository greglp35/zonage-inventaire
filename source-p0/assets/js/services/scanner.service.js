"use strict";
(function(global){
  const TARGET_FORMATS=["ean_13","ean_8","upc_a","upc_e","code_128","code_39","itf"];
  /* AUDIT : vendorisé localement (assets/js/vendor/) — CDN externe supprimé pour garantir le fonctionnement offline dès la 1ère installation. MAJ : 2026-08-15 */
  const FALLBACK_URLS=[
    "./assets/js/vendor/html5-qrcode.min.js"
  ];
  let fallbackPromise=null;

  function loadScript(url){
    return new Promise((resolve,reject)=>{
      const existing=[...document.scripts].find(s=>s.src===url);
      if(existing){if(global.Html5Qrcode)return resolve(url);existing.addEventListener("load",()=>resolve(url),{once:true});existing.addEventListener("error",reject,{once:true});return}
      const s=document.createElement("script");s.src=url;s.async=true;s.crossOrigin="anonymous";s.onload=()=>resolve(url);s.onerror=()=>reject(new Error("Chargement impossible : "+url));document.head.appendChild(s);
    });
  }
  async function ensureHtml5Fallback(){
    if(global.Html5Qrcode)return"déjà chargé";
    if(fallbackPromise)return fallbackPromise;
    fallbackPromise=(async()=>{
      if(global.AJIVendorLoader?.ensureHtml5Qrcode){await global.AJIVendorLoader.ensureHtml5Qrcode();return"vendor pack local"}
      let lastErr=null;
      for(const url of FALLBACK_URLS){try{await loadScript(url);if(global.Html5Qrcode)return url}catch(e){lastErr=e}}
      throw lastErr||new Error("Moteur scanner fallback indisponible");
    })();
    try{return await fallbackPromise}finally{if(!global.Html5Qrcode)fallbackPromise=null}
  }
  async function nativeFormats(){
    if(!global.BarcodeDetector?.getSupportedFormats)return[];
    try{return await global.BarcodeDetector.getSupportedFormats()}catch{return[]}
  }
  async function nativeReady(){
    const formats=await nativeFormats();
    const targetFormats=TARGET_FORMATS.filter(f=>formats.includes(f));
    const missingFormats=TARGET_FORMATS.filter(f=>!formats.includes(f));
    return{available:!!global.BarcodeDetector,formats,targetFormats,missingFormats,usable:missingFormats.length===0};
  }
  function makeVideo(root){
    root.innerHTML="";
    const video=document.createElement("video");
    video.className="scanner-video-native";
    video.setAttribute("playsinline","");video.muted=true;video.autoplay=true;
    root.appendChild(video);
    return video;
  }
  async function playStream(video,constraints){
    const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:constraints});
    video.srcObject=stream;
    try{await video.play()}catch{}
    await new Promise((resolve,reject)=>{
      if(video.readyState>=2&&video.videoWidth>0)return resolve();
      const timer=setTimeout(()=>reject(Object.assign(new Error("La caméra ne fournit pas d'image exploitable."),{name:"NotReadableError"})),5000);
      const done=()=>{clearTimeout(timer);video.removeEventListener("loadedmetadata",done);resolve()};
      video.addEventListener("loadedmetadata",done,{once:true});
    });
    return stream;
  }
  class NativeSession{
    constructor(root,onResult,onError){this.root=root;this.onResult=onResult;this.onError=onError;this.video=null;this.stream=null;this.detector=null;this.running=false;this.raf=0;this.lastDetect=0;this.cameras=[];this.cameraIndex=0;this.torchOn=false;this.engine="BarcodeDetector natif"}
    async start(source=null){
      const info=await nativeReady();
      if(!info.usable)throw Object.assign(new Error("BarcodeDetector ne prend pas en charge les formats terrain requis."),{name:"NativeScannerUnavailable"});
      this.video=makeVideo(this.root);
      const constraints=source?.deviceId?{deviceId:{exact:source.deviceId},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}}:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}};
      this.stream=await playStream(this.video,constraints);
      const detectorFormats=info.targetFormats.length?info.targetFormats:undefined;
      this.detector=new BarcodeDetector(detectorFormats?{formats:detectorFormats}:undefined);
      this.running=true;
      await this.refreshDevices();
      this.loop(performance.now());
      return this;
    }
    loop=(ts)=>{
      if(!this.running)return;
      this.raf=requestAnimationFrame(this.loop);
      if(ts-this.lastDetect<90||!this.video||this.video.readyState<2)return;
      this.lastDetect=ts;
      this.detector.detect(this.video).then(codes=>{
        if(!this.running||!codes?.length)return;
        const c=codes[0];this.onResult?.(c.rawValue,{format:c.format||"unknown",engine:"BarcodeDetector"});
      }).catch(err=>{if(this.running&&err?.name!=="NotFoundError")this.onError?.(err)});
    };
    async refreshDevices(){
      try{this.cameras=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==="videoinput");const active=this.track()?.getSettings?.().deviceId;const idx=this.cameras.findIndex(d=>d.deviceId===active);if(idx>=0)this.cameraIndex=idx}catch{this.cameras=[]}
      return this.cameras;
    }
    track(){return this.stream?.getVideoTracks?.()[0]||null}
    capabilities(){try{return this.track()?.getCapabilities?.()||{}}catch{return{}}}
    settings(){try{return this.track()?.getSettings?.()||{}}catch{return{}}}
    async toggleTorch(){const track=this.track(),caps=this.capabilities();if(!track||!caps.torch)return false;this.torchOn=!this.torchOn;await track.applyConstraints({advanced:[{torch:this.torchOn}]});return this.torchOn}
    async switchCamera(){if(this.cameras.length<2)return false;this.cameraIndex=(this.cameraIndex+1)%this.cameras.length;const next=this.cameras[this.cameraIndex];await this.stop();return this.start({deviceId:next.deviceId})}
    async stop(){this.running=false;if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;try{this.video?.pause()}catch{};try{this.stream?.getTracks?.().forEach(t=>t.stop())}catch{};if(this.video)this.video.srcObject=null;this.stream=null;this.detector=null;return true}
  }
  class Html5Session{
    constructor(root,onResult,onError){this.root=root;this.onResult=onResult;this.onError=onError;this.reader=null;this.running=false;this.cameras=[];this.cameraIndex=0;this.torchOn=false;this.engine="html5-qrcode 2.3.8 fallback"}
    formats(){const F=global.Html5QrcodeSupportedFormats;if(!F)return undefined;return[F.EAN_13,F.EAN_8,F.UPC_A,F.UPC_E,F.CODE_128,F.CODE_39,F.ITF].filter(v=>v!==undefined)}
    config(){return{fps:10,qrbox:(w,h)=>({width:Math.max(240,Math.min(Math.floor(w*.92),680)),height:Math.max(110,Math.min(Math.floor(h*.28),220))}),aspectRatio:1.7777778,disableFlip:true}}
    async start(source=null){
      await ensureHtml5Fallback();
      const formats=this.formats();
      const makeReader=()=>new Html5Qrcode(this.root.id,formats?{formatsToSupport:formats,useBarCodeDetectorIfSupported:true,verbose:false}:{useBarCodeDetectorIfSupported:true,verbose:false});
      const onSuccess=(text,result)=>{let format="unknown";try{format=result?.result?.format?.formatName||result?.result?.format?.toString?.()||"unknown"}catch{}this.onResult?.(text,{format,engine:"html5-qrcode"})};
      this.root.innerHTML="";this.reader=makeReader();
      const src=source?.deviceId||{facingMode:{ideal:"environment"}};
      try{await this.reader.start(src,this.config(),onSuccess,()=>{})}
      catch(first){
        if(source?.deviceId)throw first;
        try{await this.reader.clear()}catch{}this.root.innerHTML="";
        this.cameras=await Html5Qrcode.getCameras();if(!this.cameras.length)throw first;
        const back=this.cameras.findIndex(c=>/back|rear|environment|arriere|arrière|dos/i.test(c.label||""));
        this.cameraIndex=back>=0?back:this.cameras.length-1;
        this.reader=makeReader();await this.reader.start(this.cameras[this.cameraIndex].id,this.config(),onSuccess,()=>{});
      }
      this.running=true;await this.refreshDevices();return this;
    }
    video(){return this.root.querySelector("video")}
    track(){return this.video()?.srcObject?.getVideoTracks?.()[0]||null}
    capabilities(){try{return this.track()?.getCapabilities?.()||{}}catch{return{}}}
    settings(){try{return this.track()?.getSettings?.()||{}}catch{return{}}}
    async refreshDevices(){try{this.cameras=await Html5Qrcode.getCameras();const active=this.settings().deviceId;const idx=this.cameras.findIndex(c=>c.id===active);if(idx>=0)this.cameraIndex=idx}catch{this.cameras=[]}return this.cameras}
    async toggleTorch(){const track=this.track(),caps=this.capabilities();if(!track||!caps.torch)return false;this.torchOn=!this.torchOn;await track.applyConstraints({advanced:[{torch:this.torchOn}]});return this.torchOn}
    async switchCamera(){if(this.cameras.length<2)return false;this.cameraIndex=(this.cameraIndex+1)%this.cameras.length;const next=this.cameras[this.cameraIndex];await this.stop();return this.start({deviceId:next.id})}
    async stop(){try{if(this.reader&&this.running)await this.reader.stop()}catch{}try{if(this.reader)await this.reader.clear()}catch{}this.reader=null;this.running=false;this.root.innerHTML="";return true}
  }
  async function createSession({root,onResult,onError,preferNative=true}={}){
    if(!root)throw new Error("Racine scanner absente");
    if(preferNative){const info=await nativeReady();if(info.usable)return new NativeSession(root,onResult,onError)}
    return new Html5Session(root,onResult,onError);
  }
  global.AJIScannerService={TARGET_FORMATS,FALLBACK_URLS,nativeReady,ensureHtml5Fallback,createSession,NativeSession,Html5Session};
})(window);
