"use strict";
(function(global){
  function cleanBlock(value){
    return String(value??"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,2);
  }
  function normalize(value){
    const raw=String(value??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
    return raw.length===6?raw:"";
  }
  function fromBlocks(bb,cc,dd){
    const parts=[cleanBlock(bb),cleanBlock(cc),cleanBlock(dd)];
    return parts.every(x=>x.length===2)?parts.join(""):"";
  }
  function toBlocks(value){
    const raw=normalize(value);
    return raw?[raw.slice(0,2),raw.slice(2,4),raw.slice(4,6)]:["","",""];
  }
  function format(value){
    const raw=normalize(value);
    return raw?`${raw.slice(0,2)}-${raw.slice(2,4)}-${raw.slice(4,6)}`:"";
  }
  function isValid(value){return normalize(value)!==""}
  global.AJITfiLocation={cleanBlock,normalize,fromBlocks,toBlocks,format,isValid};
})(window);
