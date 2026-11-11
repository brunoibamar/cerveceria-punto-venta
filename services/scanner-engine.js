/* Motor compartido por ventas e inventario. Procesa en el dispositivo; no guarda imágenes. */
const ScannerEngine = {
  cameraConstraints() {
    return {video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false};
  },
  capabilities(track) { try { return track?.getCapabilities?.()||{}; } catch (_) { return {}; } },
  async focus(track) {
    const caps=this.capabilities(track);
    if(caps.focusMode?.includes('continuous')&&track?.applyConstraints) {
      try { await track.applyConstraints({advanced:[{focusMode:'continuous'}]}); } catch (_) { /* Opcional según el teléfono. */ }
    }
  },
  async torch(stream,enabled) {
    const track=stream?.getVideoTracks()[0];
    if(!this.capabilities(track).torch||!track?.applyConstraints)throw new Error('Este dispositivo no permite controlar la luz.');
    await track.applyConstraints({advanced:[{torch:enabled}]});
  },
  invert(bytes) { for(let i=0;i<bytes.length;i+=4){bytes[i]=255-bytes[i];bytes[i+1]=255-bytes[i+1];bytes[i+2]=255-bytes[i+2];} return bytes; },
  // Compensa sombras y fondo de vidrio con la media local, sin inventar bordes ni números.
  enhance(input,width,height) {
    const out=new Uint8ClampedArray(input.length);
    const radius=Math.max(12,Math.round(width/32));
    const sums=new Float64Array(width+1);
    for(let y=0;y<height;y++) {
      const row=y*width;sums[0]=0;
      for(let x=0;x<width;x++)sums[x+1]=sums[x]+input[row+x];
      for(let x=0;x<width;x++) {
        const left=Math.max(0,x-radius),right=Math.min(width,x+radius+1);
        out[row+x]=128+(input[row+x]-(sums[right]-sums[left])/(right-left))*4;
      }
    }
    return out;
  },
  rotate(input,width,height) {
    const out=new Uint8ClampedArray(input.length);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)out[x*height+height-1-y]=input[y*width+x];
    return out;
  },
  scan(video,stream,onResult) {
    const z=window.ZXing;
    if(!z?.BrowserMultiFormatReader)throw new Error('Lector de cámara no disponible');
    const formats=['EAN_13','EAN_8','UPC_A','UPC_E','CODE_128','CODE_39','CODE_93','ITF','CODABAR'].map(name=>z.BarcodeFormat[name]).filter(value=>value!==undefined);
    // Solo códigos comerciales 1D; no gastar tiempo buscando QR u otros formatos 2D.
    const reader=new z.BrowserMultiFormatReader(new Map([[z.DecodeHintType.POSSIBLE_FORMATS,formats]]));
    const canvas=document.createElement('canvas');const ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw new Error('No se pudo preparar el lector');
    let stopped=false,timer,round=0;
    this.focus(stream.getVideoTracks()[0]);
    const decode=(pixels,width,height)=>{
      for(let pass=0;pass<2&&!stopped;pass++) {
        if(pass)for(let i=0;i<pixels.length;i++)pixels[i]=255-pixels[i];
        try {
          const source=new z.RGBLuminanceSource(pixels,width,height);
          return reader.decodeBitmap(new z.BinaryBitmap(new z.HybridBinarizer(source)));
        } catch (_) { /* Un cuadro sin código legible es normal. */ }
      }
      return null;
    };
    const run=()=>{
      if(stopped)return;
      let result=null;
      try {
        if(video.readyState>=2&&video.videoWidth&&video.videoHeight) {
          const step=round++;
          // Un cuadro completo periódico recupera códigos fuera de la guía central.
          const crop=step%4>=2,sx=crop?video.videoWidth*.08:0,sy=crop?video.videoHeight*.18:0;
          const sw=video.videoWidth-2*sx,sh=video.videoHeight-2*sy;
          const width=Math.round(Math.min(1280,sw)),height=Math.max(1,Math.round(sh*width/sw));
          if(canvas.width!==width)canvas.width=width;
          if(canvas.height!==height)canvas.height=height;
          ctx.drawImage(video,sx,sy,sw,sh,0,0,width,height);
          const image=ctx.getImageData(0,0,width,height);
          const normal=new Uint8ClampedArray(width*height),color=new Uint8ClampedArray(width*height);
          // Alternar canales rescata contraste que desaparece al convertir vidrio de color a gris.
          const channel=step%3;
          for(let i=0,j=0;j<normal.length;i+=4,j++) {
            normal[j]=(image.data[i]+2*image.data[i+1]+image.data[i+2])>>2;
            color[j]=image.data[i+channel];
          }
          result=decode(normal,width,height);
          if(!result&&!stopped) {
            // Un solo intento adicional por cuadro mantiene libre el hilo entre lecturas.
            const rotated=step%2===1;
            const pixels=rotated?this.rotate(color,width,height):color;
            const w=rotated?height:width,h=rotated?width:height;
            result=decode(this.enhance(pixels,w,h),w,h);
          }
        }
      } catch (_) { /* La cámara puede interrumpir un cuadro al rotar o cerrar el modal. */ }
      if(result&&!stopped)onResult(result);
      // Sin intervalos superpuestos: el siguiente cuadro comienza tras terminar el anterior.
      if(!stopped)timer=setTimeout(run,result?250:120);
    };
    timer=setTimeout(run,100);
    return {reset(){stopped=true;clearTimeout(timer);reader.reset();}};
  }
};
if(typeof module!=='undefined')module.exports=ScannerEngine;
