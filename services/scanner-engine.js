/* Un solo stream por cámara. Lee luminancia normal e invertida, sin alterar la vista previa. */
const ScannerEngine = {
  invert(bytes) { for(let i=0;i<bytes.length;i+=4){bytes[i]=255-bytes[i];bytes[i+1]=255-bytes[i+1];bytes[i+2]=255-bytes[i+2];} return bytes; },
  scan(video,stream,onResult) {
    const z=window.ZXing;
    if(!z?.BrowserMultiFormatReader)throw new Error('Lector de cámara no disponible');
    const hints=new Map([[z.DecodeHintType.TRY_HARDER,true]]);
    const reader=new z.BrowserMultiFormatReader(hints);
    const canvas=document.createElement('canvas');const ctx=canvas.getContext('2d',{willReadFrequently:true});
    let stopped=false,timer,round=0;
    const track=stream.getVideoTracks()[0];
    const capabilities=track?.getCapabilities?.()||{};
    if(capabilities.focusMode?.includes('continuous'))track.applyConstraints({advanced:[{focusMode:'continuous'}]}).catch(()=>{});
    const run=()=>{
      if(stopped)return;
      if(video.readyState>=2&&video.videoWidth){
        const crop=(round++%2)===1;const sx=crop?video.videoWidth*.1:0;const sy=crop?video.videoHeight*.2:0;
        const sw=video.videoWidth-2*sx,sh=video.videoHeight-2*sy;
        canvas.width=Math.min(1280,sw);canvas.height=Math.round(sh*canvas.width/sw);
        ctx.drawImage(video,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
        const image=ctx.getImageData(0,0,canvas.width,canvas.height);
        const luminance=new Uint8ClampedArray(canvas.width*canvas.height);
        for(let i=0,j=0;i<image.data.length;i+=4,j++)luminance[j]=(image.data[i]+2*image.data[i+1]+image.data[i+2])>>2;
        for(let pass=0;pass<2&&!stopped;pass++){
          if(pass)for(let i=0;i<luminance.length;i++)luminance[i]=255-luminance[i];
          try {
            const source=new z.RGBLuminanceSource(luminance,canvas.width,canvas.height);
            const result=reader.decodeBitmap(new z.BinaryBitmap(new z.HybridBinarizer(source)));
            if(result){onResult(result);break;}
          } catch(error){/* Es normal no encontrar un código en la mayoría de los cuadros. */}
        }
      }
      if(!stopped)timer=setTimeout(run,350);
    };
    timer=setTimeout(run,100);
    return {reset(){stopped=true;clearTimeout(timer);reader.reset();}};
  }
};
if(typeof module!=='undefined')module.exports=ScannerEngine;
