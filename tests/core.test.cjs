const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'); const fs = require('node:fs'); const path=require('node:path');
function environment() {
  const values=new Map();
  const localStorage={ getItem:k=>values.has(k)?values.get(k):null, setItem(k,v){ if(this.failKey===k) throw Error('Sin espacio'); values.set(k,String(v)); }, removeItem:k=>values.delete(k) };
  const document={addEventListener(){}, getElementById(){return null;}, querySelectorAll(){return [];}};
  const context=vm.createContext({crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,testPin:String(require('node:crypto').randomInt(100000,1000000)),testStaffPin:'Personal-'+String(require('node:crypto').randomInt(100000,1000000)),console,alert(){},localStorage,AppStorage:localStorage,document,navigator:{},setInterval(){},setTimeout(){},CustomEvent:class{},window:{addEventListener(){},dispatchEvent(){}}});
  for(const file of ['services/storage.js','services/auth.js','services/operations.js','db/database.js','services/salesBreakdown.js','services/emailService.js','js/login.js','services/salesLog.js','js/pos.js','js/pos-cash-cut.js','js/pos-scanner.js','js/reports.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
  vm.runInContext('WriteGuard.ready=true; DataStore.mirror=async()=>{};',context);
  return {context, values, localStorage, run:code=>vm.runInContext(code,context)};
}
async function opened() {
  const env=environment(); env.run('Database.init(); Database.saveProducts(Array.from({length:10},(_,i)=>({id:"p"+(i+1),nombre:"Producto de prueba "+(i+1),precio:35,precioCompra:20,stock:100,coldStock:24,activo:true})))');
  await env.run("Auth.addUser('Administrador',testPin,'admin',true)");
  await env.run("Auth.verify('Administrador',testPin,'admin').then(user=>CashSession.save({...user,cashOpening:100,openedAt:new Date().toISOString(),turnoNumero:1,turnoId:'opening-1'}))");
  return env;
}
const sale="({items:[{productId:'p1',quantity:2,precio:35}],total:70,paymentBreakdown:{efectivo:70,tarjeta:0,transferencia:0},paymentMethod:'efectivo'})";
test('instalación nueva carga solo Mega Corona y no repone un catálogo eliminado',()=>{ const e=environment(); e.run('Database.init()'); assert.equal(e.run('Database.getProducts().length'),1); assert.equal(e.run('Database.getProducts()[0].nombre'),'Mega Corona'); assert.equal(e.run("DataStore.getItem('fridgeStock')"),'0'); e.run('Database.saveProducts([]); Database.init()'); assert.equal(e.run('Database.getProducts().length'),0); });
test('migración conserva los productos anteriores',()=>{const e=environment(); e.localStorage.setItem('cerveceria_products','[]'); e.run('Database.init()'); assert.equal(e.run('Database.getProducts().length'),0); assert.equal(e.localStorage.getItem('cerveceria_products'),'[]');});
test('NIP real y sesión autenticada',async()=>{ const e=await opened(); assert.ok(e.run('CashSession.getActiveSession()')); await assert.rejects(e.run("Auth.verify('Administrador','cualquier-clave','admin')")); assert.ok(e.run("Auth.users()[0].credentialType === 'pin' && !Object.hasOwn(Auth.users()[0], 'pin')")); e.run("let s=CashSession.readRaw(); s.authToken='falso'; CashSession.save(s)"); assert.equal(e.run('CashSession.getActiveSession()'),null); });
test('empleado no puede modificar inventario ni importar',async()=>{ const e=await opened(); await e.run("Auth.addUser('Empleado',testStaffPin,'employee')"); await e.run("Auth.verify('Empleado',testStaffPin,'employee').then(user=>CashSession.save({...user,cashOpening:0,openedAt:new Date().toISOString()}))"); assert.throws(()=>e.run("Database.updateProduct('p1',{stock:500})"),/administrador/); assert.throws(()=>e.run('Database.importBackup(Database.exportBackup())'),/administrador/); });
test('venta e inventario se guardan juntos y preservan costos históricos',async()=>{ const e=await opened(); e.run('Database.registerSale('+sale+')'); assert.equal(e.run('Database.getSales().length'),1); assert.equal(e.run('Database.getProducts()[0].stock'),98); assert.equal(e.run('Database.getSales()[0].items[0].costoTotal'),40); assert.equal(e.run('SalesLog.compactTicket(SalesLog.buildTicket(Database.getSales()[0])).items[0].costoTotal'),40); });
test('falla de guardado no deja venta ni descuento parcial',async()=>{ const e=await opened(); e.localStorage.failKey='cerveceria_state_v2'; assert.throws(()=>e.run('Database.registerSale('+sale+')'),/espacio/); e.localStorage.failKey=null; assert.equal(e.run('Database.getSales().length'),0); assert.equal(e.run('Database.getProducts()[0].stock'),100); });
test('demanda combinada de líneas frías y naturales no supera stock',async()=>{const e=await opened(); assert.throws(()=>e.run("Database.registerSale({items:[{productId:'p1',quantity:70},{productId:'p1',quantity:40,piezaFria:true}],total:100,paymentBreakdown:{efectivo:100}})"),/Existencias/); assert.equal(e.run('Database.getSales().length'),0);});
test('rechaza negativos, cantidades fraccionarias y pagos que no cuadran',async()=>{const e=await opened(); for(const change of ['s.items[0].quantity=-1','s.items[0].quantity=1.5','s.total=NaN','s.paymentBreakdown.efectivo=1']) assert.throws(()=>e.run('(()=>{let s='+sale+';'+change+';Database.registerSale(s)})()')); assert.equal(e.run('Database.getSales().length'),0);});
test('no se vende sin caja abierta',async()=>{const e=await opened(); e.run('CashSession.clear()'); assert.throws(()=>e.run('Database.registerSale('+sale+')'),/caja/);});
test('respaldo v2 incluye ciclos, link, usuarios e intentos de pago',async()=>{const e=await opened(); e.run("Database.createInventoryCycle('2026-10-28'); localStorage.setItem('mp_link','https://example.com/cobro'); globalThis.backup=Database.exportBackup(); Database.saveInventoryCycles([]); Database.importBackup(backup)"); assert.equal(e.run('Database.getInventoryCycles().length'),1); assert.equal(e.localStorage.getItem('mp_link'),'https://example.com/cobro'); assert.equal(e.run('Auth.users().length'),1); assert.equal(e.run('CashSession.getActiveSession()'),null); assert.ok(e.localStorage.getItem('cerveceria_before_restore'));});
test('respaldo inválido no toca los datos',async()=>{const e=await opened(); const before=e.localStorage.getItem('cerveceria_state_v2'); assert.throws(()=>e.run("Database.importBackup({version:2,products:[]})"),/incompleto/); assert.equal(e.localStorage.getItem('cerveceria_state_v2'),before);});
test('restauración fallida conserva datos y link anterior',async()=>{const e=await opened(); e.localStorage.setItem('mp_link','https://old.example/'); e.run("globalThis.backup=Database.exportBackup(); backup.mpLink='https://new.example/'; backup.products=[]"); e.localStorage.failKey='cerveceria_state_v2'; assert.throws(()=>e.run('Database.importBackup(backup)'),/espacio/); e.localStorage.failKey=null; assert.equal(e.run('Database.getProducts().length'),10); assert.equal(e.localStorage.getItem('mp_link'),'https://old.example/');});
test('respaldo v1 se importa sin mezclar ciclos del equipo actual',async()=>{const e=await opened(); e.run("let b=Database.exportBackup(); b.version=1; delete b.inventoryCycles; delete b.users; Database.importBackup(b)"); assert.equal(e.run('Database.getInventoryCycles().length'),0);});
test('no se reabre un ciclo si ya hay otro abierto',async()=>{const e=await opened(); e.run("let c=Database.createInventoryCycle('2026-10-28'); Database.closeInventoryCycle(c.id,Object.fromEntries(Database.getProducts().map(p=>[p.id,p.stock]))); Database.createInventoryCycle('2026-10-29')"); assert.throws(()=>e.run('Database.reopenInventoryCycle(Database.getInventoryCycles()[0].id)'),/Cierra el ciclo/);});
test('descuento de promoción es el ahorro, no el precio del paquete',()=>{const e=environment(); assert.equal(e.run("SalesBreakdown.getVolumePromotionsSummary([{items:[{precio:35,quantity:2,promoVolumenAplicada:{cantidad:2,precio:60}}]}]).monto"),10);});
test('correo distingue costo de reinversión y utilidad bruta sin descontar dos veces',()=>{const e=environment(); assert.equal(e.run("EmailService.getTemplateParams({totalVentas:60,tickets:[{items:[{quantity:2,precio:35,costoTotal:40}]}]}).capital_reinversion"),40); assert.equal(e.run("EmailService.getTemplateParams({totalVentas:60,tickets:[{items:[{quantity:2,precio:35,costoTotal:40}]}]}).ganancias_libres"),20); assert.match(e.run("EmailService.getTemplateParams({tickets:[{items:[{}]}]}).ganancias_libres"),/Sin costos/);});
test('pago electrónico conserva el control de intentos y se confirma con la venta',async()=>{const e=await opened(); assert.throws(()=>e.run("Database.registerSale({items:[{productId:'p1',quantity:1}],total:35,paymentBreakdown:{tarjeta:35}})"),/Confirma/); e.run("PaymentVerification.save([{id:'pago-1',status:'pending'}]); Database.registerSale({items:[{productId:'p1',quantity:1}],total:35,paymentBreakdown:{tarjeta:35},paymentVerification:{id:'pago-1',status:'confirmed',reference:'aprobado'}})"); assert.equal(e.run('PaymentVerification.getAll()[0].status'),'confirmed');});
test('tarjeta se registra sin ventana ni referencia y no se declara validación bancaria',async()=>{const e=await opened(); const declaration=await e.run('PaymentVerification.request(35,false)'); assert.equal(declaration.method,'cashier-declared'); assert.equal(declaration.bankVerified,false);
  e.run('globalThis.cardDeclaration='+JSON.stringify(declaration));
  e.run("Database.registerSale({items:[{productId:'p1',quantity:1}],total:35,paymentBreakdown:{tarjeta:35},paymentVerification:cardDeclaration})");
  assert.equal(e.run('PaymentVerification.getAll()[0].status'),'confirmed');
});
test('exportar corte no lo registra ni archiva ventas',()=>{const e=environment(); const source=fs.readFileSync(path.join(__dirname,'../js/pos-cash-cut.js'),'utf8'); const action=source.slice(source.indexOf('async runCutAction'),source.indexOf('  setCutBusy')); assert.ok(action.includes('this.buildCutData()')); assert.ok(!action.includes('ensureCutRecorded()'));});
test('pestaña sin bloqueo de escritura no puede guardar',()=>{const e=environment(); e.run('WriteGuard.ready=false'); assert.throws(()=>e.run('Database.saveProducts([])'),/escritura/);});
test('copia local permite recuperar estado anterior',async()=>{const e=await opened(); e.run('Database.saveProducts([])'); await e.run('DataStore.recover()'); assert.equal(e.run('Database.getProducts().length'),10);});

test('los depósitos de envases no se cuentan como utilidad',()=>{const e=environment(); assert.equal(e.run("SalesBreakdown.getFinancialSummary([{total:80,items:[{costoTotal:40,envaseCargo:10}]}]).grossProfit"),30);});
test('un pago confirmado no se puede reutilizar',async()=>{const e=await opened(); e.run("PaymentVerification.save([{id:'pago-2',status:'confirmed',amount:35}])"); assert.throws(()=>e.run("Database.registerSale({items:[{productId:'p1',quantity:1}],total:35,paymentBreakdown:{tarjeta:35},paymentVerification:{id:'pago-2',status:'confirmed',reference:'aprobado'}})"),/ya fue usado/);});
test('turno de un día anterior bloquea nuevas ventas',async()=>{const e=await opened(); e.run("let s=CashSession.readRaw(); s.openedAt='2020-01-01T12:00:00Z'; CashSession.save(s)"); assert.throws(()=>e.run('Database.registerSale('+sale+')'),/turno pendiente/);});
test('corte y archivo de ventas se revierten juntos cuando falla la escritura',async()=>{const e=await opened(); e.run('Database.registerSale('+sale+')'); e.localStorage.failKey='cerveceria_state_v2'; assert.equal(e.run("POS.persistCut({tipo:'cierre',turnoId:'opening-1',ventasIds:Database.getSales().map(s=>s.id)})"),null); e.localStorage.failKey=null; assert.equal(e.run('Database.getCuts().length'),0); assert.ok(!e.run('Database.getSales()[0].archivadoEnCorte'));});
test('la venta conserva su éxito si después falla la actualización visual',async()=>{const e=await opened(); e.run("POS.cart=[{productId:'p1',quantity:1,precio:35}]; POS.getColdChargeRate=()=>0; POS.getColdChargeTotal=()=>0; POS.getColdUnits=()=>0; POS.getEnvaseChargeTotal=()=>0; POS.getPromoEvaluation=()=>({applications:[],discount:0}); POS.getPromoDiscount=()=>0; POS.checkColdAlerts=()=>{throw Error('Falla visual')}"); const result=e.run("POS.completeSale({paymentMethod:'efectivo',breakdown:{efectivo:35,tarjeta:0,transferencia:0,recibido:35,cambio:0},cashReceived:35,change:0})"); assert.equal(result.success,true); assert.equal(e.run('Database.getSales().length'),1); assert.equal(e.run('POS.cart.length'),0);});

test('apertura y sesión se revierten juntas si falla el guardado',async()=>{const e=environment(); e.run('Database.init()'); await e.run("Auth.addUser('Admin',testPin,'admin',true)"); await e.run("Auth.verify('Admin',testPin,'admin').then(u=>globalThis.user=u)"); e.localStorage.failKey='cerveceria_state_v2'; assert.throws(()=>e.run('Database.openRegister(user,500)')); e.localStorage.failKey=null; assert.equal(e.run('Database.getCuts().length'),0); assert.equal(e.run('CashSession.getActiveSession()'),null);});
test('cierre confirmado guarda corte y elimina la sesión conjuntamente',async()=>{const e=await opened(); e.run('Database.registerSale('+sale+')'); const saved=e.run("POS.persistCut({tipo:'cierre',turnoId:'opening-1',ventasIds:Database.getSales().map(s=>s.id)})"); assert.ok(saved); assert.equal(e.run('CashSession.getActiveSession()'),null); assert.equal(e.run('Database.getCuts().length'),1); assert.equal(e.run('Database.getSales()[0].archivadoEnCorte'),true);});

test('todos los recursos del modo sin conexión existen en el proyecto',()=>{const context=vm.createContext({self:{addEventListener(){}}}); vm.runInContext(fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8'),context); const assets=vm.runInContext('ASSETS',context); for(const file of assets) assert.ok(fs.existsSync(path.join(__dirname,'..',file)),file);});
test('el respaldo conserva conteo global de nevera y enlace en el estado transaccional',async()=>{const e=await opened(); e.run("DataStore.setItem('fridgeStock','8'); DataStore.setItem('mp_link','https://example.com/negocio'); globalThis.b=Database.exportBackup(); DataStore.setItem('fridgeStock','1'); Database.importBackup(b)"); assert.equal(e.run("DataStore.getItem('fridgeStock')"),'8'); assert.equal(e.run("DataStore.getItem('mp_link')"),'https://example.com/negocio');});

// Datos generados solo en el entorno de pruebas; la aplicación no carga este archivo.
test('la inicialización no vuelve a borrar inventario ni historial real',async()=>{
 const e=await opened();e.run('Database.registerSale('+sale+')');e.run("Database.createInventoryCycle('2026-10-28')");
 const before=e.localStorage.getItem('cerveceria_state_v2');e.run('Database.init(); Database.init()');assert.equal(e.localStorage.getItem('cerveceria_state_v2'),before);
});
test('una instalación anterior con historial se conserva al añadir la marca de fábrica',async()=>{
 const e=await opened();e.run('Database.registerSale('+sale+')');e.run("DataStore.removeItem('cerveceria_factory_v1')");e.run('Database.init()');assert.equal(e.run('Database.getSales().length'),1);assert.equal(e.run('Database.getProducts()[0].stock'),98);
});
test('NIP inicial se crea una sola vez y no cambia al reiniciar',async()=>{
 const e=environment();e.run('Database.init()');const messages=[];e.context.console={...console,info:message=>messages.push(message)};
 const pin=await e.run('Auth.ensureCredentials()');assert.equal(pin,'1234');assert.ok(messages[0].includes(pin));
 const before=e.run('JSON.stringify(Auth.users())');assert.equal(await e.run('Auth.ensureCredentials()'),null);assert.equal(e.run('JSON.stringify(Auth.users())'),before);assert.equal(messages.length,1);
 assert.equal(e.run('Database.getProducts().length'),1);assert.equal(e.run('Database.getSales().length'),0);assert.equal(e.run('Database.getCuts().length'),0);
});
test('los NIP aceptan solo entre 4 y 8 dígitos, incluidos ceros iniciales',()=>{
 const e=environment();for(const pin of ['0000','01928374']) e.context.testInput=pin,e.run('Auth.validatePin(testInput)');
 for(const pin of ['','12','123456789','12a4',' 1234','12.3']) {e.context.testInput=pin;assert.throws(()=>e.run('Auth.validatePin(testInput)'));}
});
test('administrador cambia su NIP y la contraseña del empleado',async()=>{
 const e=await opened();assert.equal(await e.run('Auth.readPin(Auth.users()[0].id)'),e.context.testPin);
 await e.run("Auth.addUser('Personal',testStaffPin,'employee')");
 await e.run("Auth.setPassword(Auth.users().find(u=>u.role==='employee').id, testStaffPin+'0')");
 assert.equal(e.run("Auth.users().find(u=>u.role==='employee').credentialType"),'password');
 await assert.rejects(e.run("Auth.readPin(Auth.users().find(u=>u.role==='employee').id)"));
 await e.run("Auth.setPin(Auth.users()[0].id,testPin+'1')");assert.equal(await e.run('Auth.readPin(Auth.users()[0].id)'),e.context.testPin+'1');
 assert.equal(e.run('Auth.users()[0].temporary'),false);await assert.rejects(e.run("Auth.verify('Administrador',testPin,'admin')"));await e.run("Auth.verify('Administrador',testPin+'1','admin')");
});
test('empleado no puede consultar ni modificar NIP de nadie',async()=>{
 const e=await opened();await e.run("Auth.addUser('Personal',testStaffPin,'employee')");await e.run("Auth.verify('Personal',testStaffPin,'employee').then(u=>CashSession.save({...u,cashOpening:0,openedAt:new Date().toISOString()}))");
 await assert.rejects(e.run('Auth.readPin(Auth.users()[0].id)'),/administrador/);await assert.rejects(e.run('Auth.setPin(Auth.users()[0].id,testStaffPin)'),/permiso/);
});
test('respaldo conserva los NIP consultables sin texto plano',async()=>{
 const e=await opened();e.run('globalThis.pinBackup=Database.exportBackup()');assert.match(e.run('pinBackup.pinVaultKey'),/^[a-f0-9]{64}$/);
 e.run('Database.importBackup(pinBackup)');await e.run("Auth.verify('Administrador',testPin,'admin').then(u=>CashSession.save({...u,cashOpening:0,openedAt:new Date().toISOString()}))");assert.equal(await e.run('Auth.readPin(Auth.users()[0].id)'),e.context.testPin);
});
test('la migración de una contraseña anterior conserva la cuenta y los datos',async()=>{
 const e=await opened();e.run("let users=Auth.users();delete users[0].credentialType;delete users[0].pinCipher;DataStore.setItem(Auth.KEY,JSON.stringify(users))");
 e.context.grant=await e.run("Auth.verify('Administrador',testPin,'admin')");await e.run("Auth.setPin(grant.userId,testPin+'2',grant)");
 assert.equal(e.run('Auth.users()[0].credentialType'),'pin');assert.equal(e.run('Database.getProducts().length'),10);await assert.rejects(e.run("Auth.verify('Administrador',testPin,'admin')"));await e.run("Auth.verify('Administrador',testPin+'2','admin')");
});

test('si falla el cambio de NIP, el anterior sigue funcionando',async()=>{const e=await opened();const before=e.run('JSON.stringify(Auth.users())');e.localStorage.failKey='cerveceria_state_v2';await assert.rejects(e.run("Auth.setPin(Auth.users()[0].id,testPin+'0')"),/espacio/);e.localStorage.failKey=null;assert.equal(e.run('JSON.stringify(Auth.users())'),before);await e.run("Auth.verify('Administrador',testPin,'admin')");});

test('el ticket mixto dibuja hielo únicamente en la partida fría',async()=>{
 const e=await opened();const container={innerHTML:''};e.context.document.getElementById=id=>id==='pos-cart'?container:null;
 e.run("POS.escapeHtml=value=>String(value || '');POS.renderSummaryTotals=()=>{};POS.renderCartPromos=()=>'';POS.cart=[{productId:'p1',nombre:'Natural',quantity:1,precio:35,piezaFria:false},{productId:'p2',nombre:'Frío',quantity:1,precio:35,piezaFria:true}];POS.renderCart()");
 const cards=container.innerHTML.match(/class="cart-item-card[^"]*"/g);assert.equal(cards.length,2);assert.equal(cards[0],'class="cart-item-card"');assert.equal(cards[1],'class="cart-item-card is-cold"');assert.ok(!container.innerHTML.includes('ticket-frost-frame'));
});
test('activar y desactivar Frío cambia solo esa partida y conserva la otra',async()=>{
 const e=await opened();const container={innerHTML:''};e.context.document.getElementById=id=>id==='pos-cart'?container:null;
 e.run("POS.escapeHtml=value=>String(value || '');POS.renderSummaryTotals=()=>{};POS.renderCartPromos=()=>'';POS.canAddCold=()=>({ok:true});POS.adjustFridgeStock=()=>{};POS.releaseColdUnits=()=>{};POS.cart=[{productId:'p1',nombre:'Uno',quantity:1,precio:35,piezaFria:false},{productId:'p2',nombre:'Dos',quantity:2,precio:35,piezaFria:false}];POS.toggleCold('p1',false)");
 assert.equal((container.innerHTML.match(/class="cart-item-card is-cold"/g)||[]).length,1);assert.equal(e.run('POS.cart[1].piezaFria'),false);
 e.run("POS.toggleCold('p1',true)");assert.equal((container.innerHTML.match(/class="cart-item-card is-cold"/g)||[]).length,0);assert.equal(e.run('POS.cart[1].quantity'),2);
 e.run('POS.cart=[];POS.renderCart()');assert.match(container.innerHTML,/Carrito vacío/);assert.ok(!container.innerHTML.includes('is-cold'));
});

test('administrador se identifica únicamente por NIP y no admite acceso de empleado',async()=>{
 const e=await opened();const grant=await e.run('Auth.verifyAdmin(testPin)');assert.equal(grant.role,'admin');assert.equal(grant.name,'Administrador');
 e.context.authGrant=grant;e.run('CashSession.save({...authGrant,cashOpening:0,openedAt:new Date().toISOString()})');
 await e.run("Auth.addUser('Personal',testStaffPin,'employee')");await assert.rejects(e.run('Auth.verifyAdmin(testStaffPin)'));
});
test('empleado valida nombre y contraseña real, sin verificación de NIP',async()=>{
 const e=await opened();await e.run("Auth.addUser('Ana',testStaffPin,'employee')");await assert.rejects(e.run("Auth.verify('Ana','incorrecta','employee')"));const grant=await e.run("Auth.verify(' ana ',testStaffPin,'employee')");assert.equal(grant.name,'Ana');assert.equal(grant.role,'employee');assert.ok(e.run("!Object.hasOwn(Auth.users().find(u=>u.name==='Ana'),'pinCipher')"));
});
test('no se permiten NIP duplicados entre administradores',async()=>{
 const e=await opened();await assert.rejects(e.run("Auth.addUser('Otro admin',testPin,'admin')"),/ya usa/);
 await e.run("Auth.addUser('Otro admin',testPin+'3','admin')");await assert.rejects(e.run("Auth.setPin(Auth.users()[1].id,testPin)"),/ya usa/);
});
test('la venta conserva identidad autenticada aunque el cliente intente cambiar el nombre',async()=>{
 const e=await opened();await e.run("Auth.addUser('Ana',testStaffPin,'employee')");await e.run("Auth.verify('Ana',testStaffPin,'employee').then(u=>CashSession.save({...u,cashOpening:0,openedAt:new Date().toISOString(),turnoId:'turno-ana'}))");
 e.run('(()=>{const s='+sale+';s.cajero="Nombre falso";s.cajeroId="falso";Database.registerSale(s)})()');assert.equal(e.run('Database.getSales()[0].cajero'),'Ana');assert.equal(e.run('Database.getSales()[0].cajeroId'),e.run("Auth.users().find(u=>u.name==='Ana').id"));
 assert.equal(e.run('SalesLog.compactTicket(SalesLog.buildTicket(Database.getSales()[0])).cajero'),'Ana');assert.equal(e.run('SalesLog.compactTicket(SalesLog.buildTicket(Database.getSales()[0])).cajeroRol'),'employee');
});
test('resumen por responsable separa empleados y excluye cancelaciones',()=>{
 const e=environment();const groups=e.run("ReportsManager.getSalesByEmployee([{cajeroId:'a',cajero:'Ana',total:10.10},{cajeroId:'b',cajero:'Luis',total:20},{cajeroId:'a',cajero:'Ana',total:5.20},{cajeroId:'a',cajero:'Ana',total:100,status:'cancelada'},{total:3}])");assert.equal(groups.length,3);assert.equal(groups.find(g=>g.id==='a').count,2);assert.equal(groups.find(g=>g.id==='a').total,15.30);assert.equal(groups.find(g=>g.id==='b').total,20);assert.equal(groups.find(g=>g.id===null).name,'Sin responsable registrado');
});

test('Mega Corona tiene todos los valores iniciales exactos',()=>{
 const e=environment();e.run('Database.init()');const p=e.run('Database.getProducts()[0]');
 assert.equal(p.nombre,'Mega Corona');assert.equal(p.marca,'Corona');assert.equal(p.presentacion,'1L');assert.equal(p.codigoBarras,'100211');assert.equal(p.precio,50);assert.equal(p.precioVenta,50);assert.equal(p.costoPieza,26);assert.equal(p.precioCompra,26);assert.equal(p.cobroExtraEnvaseFaltantePieza,10);assert.equal(p.unidadesPorCarton,12);assert.equal(p.costoCarton,320);assert.equal(p.precioCarton,470);assert.equal(p.cobroExtraEnvaseFaltanteCarton,10);assert.equal(p.stock,149*12+11);assert.equal(p.stockMinimo,5);assert.equal(e.run("POS.findProductByBarcode('100211').nombre"),'Mega Corona');
});
test('la semilla nunca sobreescribe cambios posteriores ni vuelve tras eliminarse',()=>{
 const e=environment();e.run('Database.init();let p=Database.getProducts();p[0].precio=65;p[0].stock=7;Database.saveProducts(p);Database.init()');assert.equal(e.run('Database.getProducts()[0].precio'),65);assert.equal(e.run('Database.getProducts()[0].stock'),7);
 e.run('Database.saveProducts([]);Database.init()');assert.equal(e.run('Database.getProducts().length'),0);
});
test('un almacén de pruebas nuevo recupera la semilla original sin cambiar el anterior',()=>{
 const first=environment();first.run('Database.init();Database.saveProducts([])');const reset=environment();reset.run('Database.init()');assert.equal(reset.run('Database.getProducts().length'),1);assert.equal(reset.run('Database.getProducts()[0].stock'),1799);assert.equal(first.run('Database.getProducts().length'),0);
});
test('si faltan productos pero existe historial no se agrega la semilla',()=>{
 const e=environment();e.localStorage.setItem('cerveceria_sales',JSON.stringify([{id:'venta-anterior'}]));e.run('Database.init()');assert.equal(e.run('Database.getProducts().length'),0);assert.equal(e.run('Database.getSales().length'),1);
});
