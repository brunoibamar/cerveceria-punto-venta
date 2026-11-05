const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const ZXing=require('../vendor/zxing-0.21.3.min.js');

function updateFixture(){
 const listeners={},workerListeners={},messages=[],sent=[],stored=new Map();let reloads=0;
 const worker={state:'installed',addEventListener:(event,cb)=>workerListeners[event]=cb,postMessage:message=>sent.push(message)};
 const registration={waiting:worker,installing:null,update:async()=>{},addEventListener(){}};
 const context=vm.createContext({navigator:{onLine:true,serviceWorker:{controller:{},addEventListener:(event,cb)=>listeners[event]=cb,register:async()=>registration}},
   document:{hidden:false,getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){}},setInterval(){},setTimeout(){},clearTimeout(){},URL,
   fetch:async()=>({ok:true,json:async()=>({version:'3.6.2'})}),
   location:{href:'https://example.test/pos/?env=production',search:'?env=production',reload:()=>reloads++},POS:{cart:[{productId:'p1',quantity:12,piezaFria:true}],CART_KEY:'cart',payment:{isOpen:false},cut:{isOpen:false}},
   App:{currentView:'pos'},CashSession:{getActiveSession:()=>({role:'employee'})},DataStore:{setItem:(key,value)=>stored.set(key,value)}});
 vm.runInContext(fs.readFileSync('services/app-updates.js','utf8')+'\nglobalThis.updates=AppUpdates;',context);
 const updates=context.updates;updates.registration=registration;updates.render=message=>messages.push(message||'available');
 return {context,updates,worker,registration,listeners,workerListeners,messages,sent,stored,reloads:()=>reloads};
}

test('detecta actualización pendiente sin recargar y conserva carrito frío al aceptarla',async()=>{
 const f=updateFixture();await f.updates.check(true);assert.equal(f.updates.pending,f.worker);assert.equal(f.reloads(),0);
 await f.updates.apply();assert.equal(f.sent[0].type,'ACTIVATE_UPDATE');assert.equal(JSON.parse(f.stored.get('cart'))[0].quantity,12);
 assert.equal(JSON.parse(f.stored.get('cart'))[0].piezaFria,true);assert.equal(f.reloads(),0);
 f.worker.state='activated';f.workerListeners.statechange();f.updates.finish();assert.equal(f.reloads(),1);
 assert.equal(f.context.location.search,'?env=production');
});

test('no interrumpe un cobro, corte, sincronización o formulario ni recarga por otra pestaña',async()=>{
 const f=updateFixture();f.updates.pending=f.worker;
 f.context.POS.payment.isOpen=true;await f.updates.apply();assert.equal(f.sent.length,0);
 f.context.POS.payment.isOpen=false;f.context.POS.cut.busy=true;await f.updates.apply();assert.equal(f.sent.length,0);
 f.context.POS.cut.busy=false;f.context.InventoryCloud={busy:true};await f.updates.apply();assert.equal(f.sent.length,0);
 f.context.InventoryCloud.busy=false;f.context.document.querySelector=()=>({});await f.updates.apply();assert.equal(f.sent.length,0);
 f.context.document.querySelector=()=>null;f.updates.init();f.listeners.controllerchange();assert.equal(f.reloads(),0);
});

test('si no se guarda el carrito no activa la actualización y puede reintentar',async()=>{
 const f=updateFixture();f.updates.pending=f.worker;
 f.context.DataStore.setItem=()=>{throw Error('Sin espacio');};await f.updates.apply();
 assert.equal(f.sent.length,0);assert.equal(f.reloads(),0);assert.equal(f.updates.reloadRequested,false);
 assert.match(f.messages.at(-1),/Sin espacio/);
 f.context.DataStore.setItem=()=>{};await f.updates.apply();assert.equal(f.sent.length,1);
});

test('formulario oculto no bloquea actualizaciones; formulario visible sin guardar sí',()=>{
 const f=updateFixture();f.context.document.querySelectorAll=()=>[{getClientRects:()=>[]}];assert.equal(f.updates.blockedReason(),'');
 f.context.document.querySelectorAll=()=>[{getClientRects:()=>[{}]}];assert.match(f.updates.blockedReason(),/formulario/);
});

test('avisa con versión publicada nueva aunque no exista worker en espera y permite recargar manualmente',async()=>{
 const f=updateFixture();f.registration.waiting=null;f.context.fetch=async()=>({ok:true,json:async()=>({version:'3.7.0'})});
 await f.updates.check(true);assert.equal(f.updates.available,true);assert.equal(f.reloads(),0);assert.ok(f.messages.includes('available'));
 assert.equal(f.updates.latestVersion,'3.7.0');
 f.updates.available=false;f.updates.canRefresh=true;await f.updates.apply();assert.equal(f.reloads(),1);
});

test('la simulación también detecta novedades y el acceso superior conserva el entorno real',async()=>{
 const f=updateFixture();f.context.DemoMode=true;f.context.fetch=async()=>({ok:true,json:async()=>({version:'4.0.0'})});
 await f.updates.check(true);assert.equal(f.updates.available,true);assert.equal(f.reloads(),0);
 const shortcut={};f.context.document.getElementById=()=>shortcut;f.updates.init();
 assert.equal(new URL(shortcut.href).searchParams.get('env'),'production');assert.equal(new URL(shortcut.href).pathname,'/pos/actualizar.html');
 assert.equal(typeof shortcut.onclick,'function');
});

test('no recarga con un worker activo anterior si la nueva descarga no quedó lista',async()=>{
 const f=updateFixture();f.registration.waiting=null;f.registration.active={state:'activated',scriptURL:'https://example.test/pos/sw.js?release=3.6.2'};
 f.updates.available=true;f.updates.latestVersion='3.7.0';await f.updates.apply();
 assert.equal(f.reloads(),0);assert.equal(f.updates.reloadRequested,false);assert.equal(f.updates.preparing,false);
 assert.match(f.messages.at(-1),/todavía no está lista/);
});

test('actualización descarga recursos versionados y conserva las rutas para uso sin conexión',async()=>{
 const listeners={},requests=[],saved=[];let install;
 const context={URL,Request,Response,self:{registration:{scope:'https://example.test/pos/'},addEventListener:(name,handler)=>listeners[name]=handler},
   caches:{open:async()=>({put:async(path,response)=>saved.push([path,await response.text()])})},
   fetch:async request=>{requests.push(request);return new Response('archivo nuevo');}};
 vm.runInNewContext(fs.readFileSync('sw.js','utf8'),context);
 listeners.install({waitUntil:promise=>install=promise});await install;
 assert.ok(requests.some(r=>new URL(r.url).pathname==='/pos/js/pos.js'));
 assert.ok(requests.every(r=>r.cache==='reload'&&new URL(r.url).searchParams.has('pos_release')));
 assert.ok(saved.some(([path,body])=>path==='./js/pos.js'&&body==='archivo nuevo'));
});

test('negocio real inicia vacío con almacenamiento independiente y conserva pruebas',()=>{
  const values=new Map([['cerveceria_products','[{"id":"prueba","nombre":"Solo pruebas"}]']]);
  const storage={getItem:k=>values.has(k)?values.get(k):null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
  const context=vm.createContext({localStorage:storage,location:{search:'?env=production'},URLSearchParams,document:{querySelector:()=>null},window:{dispatchEvent(){}},CustomEvent:class{},console});
  for(const file of ['services/runtime.js','services/storage.js','db/database.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context);
  vm.runInContext('DataStore.mirror=async()=>{}; Database.init()',context);
  assert.equal(vm.runInContext('Database.getProducts().length',context),0);
  assert.match(values.get('cerveceria_products'),/Solo pruebas/);
  assert.ok(values.has('production:cerveceria_state_v2'));
});

test('aviso de envío correcto se oculta sin detener la sincronización',()=>{
  let hide;const banner={hidden:true,textContent:''};
  const context=vm.createContext({window:{addEventListener(){}},document:{getElementById:()=>banner},clearTimeout(){},setTimeout:fn=>{hide=fn;return 1;}});
  vm.runInContext(fs.readFileSync('services/inventory-cloud.js','utf8')+'\nglobalThis.bridge=InventoryCloud;',context);
  context.bridge.status('Ventas e inventario enviados · 12:00');assert.equal(banner.hidden,false);hide();assert.equal(banner.hidden,true);
  context.bridge.status('Sin internet · envío pendiente');assert.equal(banner.hidden,false);
});

test('credencial interna de terminal respeta el límite de 72 bytes de Supabase Auth',()=>{
  const source=fs.readFileSync('supabase/functions/enroll-pos-terminal/index.ts','utf8');
  const expression=source.match(/const password=(.*);/)[1];
  const passwords=new Set();
  for(let i=0;i<100;i++){
    const password=vm.runInNewContext(expression,{crypto});
    assert.equal(Buffer.byteLength(password,'utf8'),69);
    assert.match(password,/^T!a9-[a-f0-9]{64}$/);
    passwords.add(password);
  }
  assert.equal(passwords.size,100);
});

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

test('envío de terminal conserva cola e identificador aunque opere un empleado y se pierda una respuesta',async()=>{
  const values=new Map();const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const context={window:{addEventListener(){}},localStorage:storage,DemoMode:false,Auth:{isAdmin:()=>false},navigator:{onLine:true},crypto,
    TerminalEvents:{KEY:'test-outbox',collect:()=>[],shifts:()=>[],acknowledge(){}},
    DataStore:{getItem:()=> '[]'},Database:{getProducts:()=>[{id:'p1',nombre:'Producto',precio:50,stock:1800}],getInventoryCycles:()=>[]},CloudConfig:{businessId:'business'},console};
  vm.runInNewContext(fs.readFileSync('services/inventory-cloud.js','utf8')+'\nglobalThis.bridge=InventoryCloud;',context);
  const bridge=context.bridge;bridge.status=()=>{};bridge.schedule=()=>{};
  storage.setItem(bridge.KEY,JSON.stringify({installation:crypto.randomUUID(),revisions:{}}));
  const calls=[];bridge.terminal=()=>({auth:{getSession:async()=>({data:{session:{}}})},rpc:async(name,args)=>{calls.push(args);return calls.length===1?{error:{message:'Respuesta perdida'}}:{data:{revisions:{p1:1},synced_at:new Date().toISOString()}};}});
  await assert.rejects(bridge.sync());assert.ok(storage.getItem(bridge.QUEUE));
  await bridge.sync();assert.equal(calls[0].p_request,calls[1].p_request);assert.equal(storage.getItem(bridge.QUEUE),null);
  assert.equal(JSON.parse(storage.getItem(bridge.KEY)).revisions.p1,1);
});
