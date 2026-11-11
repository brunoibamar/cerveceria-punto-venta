const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ZXing=require('../vendor/zxing-0.21.3.min.js');

function ean({inverted=false,vertical=false,glass=false}={}) {
  const a=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const b=['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
  const code='4006381333931',parity='LGLLGG';
  let bits='000000000000101';
  for(let i=0;i<6;i++)bits+=(parity[i]==='L'?a:b)[Number(code[i+1])];
  bits+='01010';
  for(let i=7;i<13;i++)bits+=a[Number(code[i])].split('').map(c=>c==='0'?'1':'0').join('');
  bits+='101000000000000';
  const matrix={getWidth:()=>bits.length*3,getHeight:()=>150,get:(x,y)=>bits[Math.floor(x/3)]==='1'};
  const width=vertical?matrix.getHeight():matrix.getWidth(),height=vertical?matrix.getWidth():matrix.getHeight();
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const bar=vertical?matrix.get(y,matrix.getHeight()-1-x):matrix.get(x,y);
    const dark=inverted?!bar:bar;
    const offset=(y*width+x)*4;
    // Transparencia simulada sobre vidrio ámbar, con sombra lateral y contraste bajo.
    const shade=glass?50*x/width:0;
    const rgb=glass?(dark?[90+shade,65+shade,35+shade]:[118+shade,81+shade,42+shade]):[dark?0:255,dark?0:255,dark?0:255];
    data.set([...rgb,255],offset);
  }
  return {width,height,data,code};
}
function fixture(image) {
  let next,draw,found=[],stops=0;
  const canvas={width:0,height:0,getContext:()=>({
    drawImage:(video,sx,sy,sw,sh)=>{draw={sx,sy,sw,sh};},
    getImageData:()=>{
      const data=new Uint8ClampedArray(canvas.width*canvas.height*4);
      for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++) {
        const ix=Math.min(image.width-1,Math.floor(draw.sx+x*draw.sw/canvas.width));
        const iy=Math.min(image.height-1,Math.floor(draw.sy+y*draw.sh/canvas.height));
        data.set(image.data.subarray((iy*image.width+ix)*4,(iy*image.width+ix)*4+4),(y*canvas.width+x)*4);
      }
      return {data};
    }
  })};
  const context={window:{ZXing},document:{createElement:()=>canvas},setTimeout:fn=>{next=fn;return 1;},clearTimeout:()=>{next=null;},console};
  vm.runInNewContext(fs.readFileSync('services/scanner-engine.js','utf8')+'\nglobalThis.engine=ScannerEngine;',context);
  const handle=context.engine.scan({readyState:2,videoWidth:image.width,videoHeight:image.height},{getVideoTracks:()=>[]},r=>found.push(r.getText()));
  return {context,found,step(){const fn=next;next=null;fn?.();},reset:()=>{handle.reset();stops++;},pending:()=>Boolean(next)};
}
for(const options of [{},{inverted:true},{glass:true},{glass:true,inverted:true},{vertical:true},{vertical:true,glass:true,inverted:true}]) {
  test('lector compartido EAN válido '+JSON.stringify(options),()=>{
    const image=ean(options),f=fixture(image);
    for(let i=0;i<8&&!f.found.length;i++)f.step();
    f.reset();assert.equal(f.found[0],image.code);assert.equal(f.pending(),false);
  });
}
test('no inventa códigos en una etiqueta sin barras',()=>{
  const image=ean();image.data.fill(128);const f=fixture(image);
  for(let i=0;i<6;i++)f.step();f.reset();assert.deepEqual(f.found,[]);
});
test('enfoque opcional tolera rechazo del teléfono y luz valida capacidades',async()=>{
  const f=fixture(ean()),engine=f.context.engine;
  await engine.focus({getCapabilities:()=>({focusMode:['continuous']}),applyConstraints:()=>Promise.reject(Error('No compatible'))});
  await engine.focus({getCapabilities:()=>{throw Error('No compatible');}});
  await assert.rejects(engine.torch({getVideoTracks:()=>[]},true),/no permite/);
  let request;
  await engine.torch({getVideoTracks:()=>[{getCapabilities:()=>({torch:true}),applyConstraints:async c=>{request=c;}}]},true);
  assert.equal(request.advanced[0].torch,true);f.reset();
});
test('el lector no modifica los píxeles originales al mejorar contraste',()=>{
  const f=fixture(ean()),input=new Uint8ClampedArray([80,80,100,100]);
  f.context.engine.enhance(input,4,1);
  assert.deepEqual([...input],[80,80,100,100]);f.reset();
});

test('cerrar ventas mientras llega el permiso de cámara libera el stream sin arrancar el lector',async()=>{
  const f=fixture(ean());let resolve,stopped=0,requests=0;
  const video={srcObject:null,play:async()=>{}};
  const context={ScannerEngine:f.context.engine,POS:{scanner:{}},document:{getElementById:id=>id==='pos-scanner-video'?video:null},
    navigator:{mediaDevices:{getUserMedia:()=>{requests++;return new Promise(r=>{resolve=r;});}}},console};
  vm.runInNewContext(fs.readFileSync('js/pos-scanner.js','utf8'),context);
  const start=context.POS.startCameraScanner();
  await context.POS.startCameraScanner();assert.equal(requests,1);
  context.POS.stopCameraScanner();
  resolve({getTracks:()=>[{stop:()=>stopped++}]});await start;
  assert.equal(stopped,1);assert.equal(video.srcObject,null);assert.equal(context.POS.scanner.starting,false);f.reset();
});
test('ventas libera la cámara si falla la reproducción de video',async()=>{
  const f=fixture(ean());let stopped=0;
  const video={srcObject:null,play:async()=>{throw Error('Video interrumpido');}};
  const context={ScannerEngine:f.context.engine,POS:{scanner:{}},document:{getElementById:id=>id==='pos-scanner-video'?video:null},
    navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>stopped++}]})}},console:{error(){}}};
  vm.runInNewContext(fs.readFileSync('js/pos-scanner.js','utf8'),context);
  await context.POS.startCameraScanner();assert.equal(stopped,1);assert.equal(video.srcObject,null);
  assert.equal(context.POS.scanner.isScanning,false);assert.equal(context.POS.scanner.starting,false);f.reset();
});
test('ventas e inventario solicitan exactamente la misma configuración de cámara',async()=>{
  const f=fixture(ean()),requests=[];
  const video={srcObject:null,play:async()=>{},setAttribute(){}};
  const context={ScannerEngine:{...f.context.engine,scan:()=>({reset(){}})},POS:{scanner:{}},window:{ZXing,addEventListener(){}},
    document:{getElementById:id=>id.endsWith('scanner-video')?video:null},
    navigator:{mediaDevices:{getUserMedia:async constraints=>{requests.push(JSON.stringify(constraints));return {getTracks:()=>[],getVideoTracks:()=>[]};}}},console};
  vm.runInNewContext(fs.readFileSync('js/pos-scanner.js','utf8'),context);
  vm.runInNewContext(fs.readFileSync('js/inventory.js','utf8'),context);
  await context.POS.startCameraScanner();context.window.InventoryManager.startInventoryScanner();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);
  context.POS.stopCameraScanner();context.window.InventoryManager.closeInventoryScanner();f.reset();
});
