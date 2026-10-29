const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const ZXing=require('../vendor/zxing-0.21.3.min.js');

function barcode(inverted){
  const a=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const b=['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
  const code='4006381333931',parity='LGLLGG';
  let bits='000000000000101';
  for(let i=0;i<6;i++)bits+=(parity[i]==='L'?a:b)[Number(code[i+1])];
  bits+='01010';
  for(let i=7;i<13;i++)bits+=a[Number(code[i])].split('').map(c=>c==='0'?'1':'0').join('');
  bits+='101000000000000';
  const width=bits.length*3,height=90,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const pixel=(y*width+x)*4;let value=bits[Math.floor(x/3)]==='1'?0:255;if(inverted)value=255-value;data[pixel]=data[pixel+1]=data[pixel+2]=value;data[pixel+3]=255;}
  return {width,height,data,code};
}
for(const inverted of [false,true])test('escáner decodifica EAN-13 '+(inverted?'blanco sobre negro':'negro sobre blanco'),()=>{
  const image=barcode(inverted);let tick;let found;
  const context={window:{ZXing},document:{createElement:()=>({getContext:()=>({drawImage(){},getImageData:()=>image})})},
    Uint8ClampedArray,Map,setTimeout:fn=>{tick=fn;return 1;},clearTimeout(){},console};
  vm.runInNewContext(fs.readFileSync('services/scanner-engine.js','utf8')+'\nglobalThis.engine=ScannerEngine;',context);
  const handle=context.engine.scan({readyState:2,videoWidth:image.width,videoHeight:image.height},{getVideoTracks:()=>[]},r=>{found=r.getText();});
  tick();handle.reset();assert.equal(found,image.code);
});

test('espejo de inventario conserva la cola y el identificador cuando se pierde una respuesta',async()=>{
  const values=new Map();const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const context={window:{addEventListener(){}},localStorage:storage,DemoMode:false,Auth:{isAdmin:()=>true},navigator:{onLine:true},crypto,
    DataStore:{getItem:()=> '[]'},Database:{getProducts:()=>[{id:'p1',nombre:'Producto',precio:50,stock:1800}],getInventoryCycles:()=>[]},CloudConfig:{businessId:'business'},console};
  vm.runInNewContext(fs.readFileSync('services/inventory-cloud.js','utf8')+'\nglobalThis.bridge=InventoryCloud;',context);
  const bridge=context.bridge;bridge.status=()=>{};bridge.schedule=()=>{};bridge.authorized=true;
  storage.setItem(bridge.KEY,JSON.stringify({installation:crypto.randomUUID(),revisions:{}}));
  const calls=[];bridge.api=()=>({rpc:async(name,args)=>{calls.push(args);return calls.length===1?{error:{message:'Respuesta perdida'}}:{data:{revisions:{p1:1},synced_at:new Date().toISOString()}};}});
  await assert.rejects(bridge.sync());assert.ok(storage.getItem(bridge.QUEUE));
  await bridge.sync();assert.equal(calls[0].p_request,calls[1].p_request);assert.equal(storage.getItem(bridge.QUEUE),null);
  assert.equal(JSON.parse(storage.getItem(bridge.KEY)).revisions.p1,1);
});
