/* Terminal autenticada: ventas, turnos y stock con cola persistente y revisión de conflictos. */
const InventoryCloud = {
  KEY:'pos_inventory_link_v1', QUEUE:'pos_terminal_outbox_v2', busy:false, timer:null,
  client:null,
  config() { return JSON.parse(localStorage.getItem(this.KEY)||'null'); },
  api() { return this.client ||= supabase.createClient(CloudConfig.url,CloudConfig.key,{auth:{storageKey:'pos-inventory-auth-v1',persistSession:false,autoRefreshToken:true,detectSessionInUrl:false}}); },
  terminal() { return this.terminalClient ||= supabase.createClient(CloudConfig.url,CloudConfig.key,{auth:{storageKey:'pos-terminal-session-v2',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}); },
  normalized(products) {
    return products.map(p=>({id:String(p.id),stock:Number(p.stock||0),cold_stock:Number(p.coldStock||0),data:{...p,
      precioVenta:Number(p.precioVenta??p.precio??0),costoPieza:Number(p.costoPieza??p.precioCompra??0),
      unidadesPorCarton:Number(p.unidadesPorCarton||0),precioCarton:Number(p.precioCarton||0),costoCarton:Number(p.costoCarton||0),
      cobroExtraEnvaseFaltantePieza:Number(p.cobroExtraEnvaseFaltantePieza||0),cobroExtraEnvaseFaltanteCarton:Number(p.cobroExtraEnvaseFaltanteCarton||0)}}));
  },
  snapshot() {
    if(DataStore.getItem('cerveceria_products')===null) throw new Error('No se encuentra el catálogo local. No se modificó la nube.');
    const cfg=this.config()||{};
    const queued=JSON.parse(DataStore.getItem(TerminalEvents.KEY)||'{}');
    const sales=TerminalEvents.collect(!cfg.importComplete).filter(s=>!Object.hasOwn(cfg.sentSales||{},s.id)||Object.hasOwn(queued,s.id)).slice(0,500);
    return JSON.stringify({products:this.normalized(Database.getProducts()),cycles:Database.getInventoryCycles(),shifts:TerminalEvents.shifts(),sales});
  },
  status(message) {
    let banner=document.getElementById('inventory-cloud-status');
    if(!banner){banner=document.createElement('div');banner.id='inventory-cloud-status';banner.className='inventory-cloud-status';banner.setAttribute('role','status');document.body.append(banner);}
    banner.textContent=message;
  },
  schedule() { clearTimeout(this.timer); this.timer=setTimeout(()=>this.sync().catch(e=>this.status('Envío a nube pendiente: '+e.message)),700); },
  async sync() {
    if(DemoMode||this.busy||!this.config()) return;
    if(typeof WriteGuard!=='undefined'&&!WriteGuard.ready)return;
    if(!navigator.onLine){this.status('Sin internet · ventas e inventario guardados aquí, pendientes de nube.');return;}
    const session=await this.terminal().auth.getSession();
    if(session.error||!session.data?.session){this.status('Activa la terminal en Ajustes → Vincular ventas e inventario con nube.');return;}
    if(this.busy)return;
    const cfg=this.config();
    const snapshot=this.snapshot();
    if(snapshot===cfg.lastSnapshot&&!localStorage.getItem(this.QUEUE))return;
    this.busy=true; let retryLater=false;
    try {
      let pending=JSON.parse(localStorage.getItem(this.QUEUE)||'null');
      if(!pending){pending={id:crypto.randomUUID(),snapshot,payload:{...JSON.parse(snapshot),installation:cfg.installation,expected:cfg.revisions}};localStorage.setItem(this.QUEUE,JSON.stringify(pending));}
      this.status('Guardando inventario en la nube…');
      if(pending.rejected)throw new Error(pending.rejected);
      const {data,error}=await this.terminal().rpc('pos_terminal_sync',{p_business:CloudConfig.businessId,p_request:pending.id,p_payload:pending.payload});
      if(error){if(error.code==='P0001'){pending.rejected=error.message;localStorage.setItem(this.QUEUE,JSON.stringify(pending));}throw error;}
      const sent=JSON.parse(pending.snapshot).sales;
      cfg.sentSales||={};for(const sale of sent)cfg.sentSales[sale.id]=true;
      TerminalEvents.acknowledge(sent);
      cfg.importComplete=TerminalEvents.collect(true).every(s=>cfg.sentSales[s.id]);
      cfg.revisions=data.revisions;cfg.lastSnapshot=pending.snapshot;cfg.lastSync=data.synced_at;cfg.terminalVersion=2;
      localStorage.setItem(this.KEY,JSON.stringify(cfg));localStorage.removeItem(this.QUEUE);
      this.status('Ventas e inventario enviados · '+new Date(data.synced_at).toLocaleTimeString('es-MX'));
      retryLater=this.snapshot()!==pending.snapshot;
    } finally {this.busy=false;if(retryLater)this.schedule();}
  },
  open() {
    Auth.requireAdmin();
    if(DemoMode){alert('La simulación en memoria no se vincula a la nube. Abre la aplicación normal para publicar tu inventario.');return;}
    const overlay=document.createElement('div');overlay.className='security-overlay';
    overlay.innerHTML='<section class="security-card"><h2>Vincular ventas e inventario</h2><p>Esta terminal enviará automáticamente ventas, cajeros, turnos y existencias, aunque cobre un empleado o se cierre el turno. Si se interrumpe internet, los cambios quedan pendientes.</p><p>Se publicará el inventario actual de este dispositivo, sin volver a descontar las ventas ya hechas. Se recuperarán los tickets guardados en el historial y en los cortes.</p><form class="login-form"><label>Correo administrador<input class="login-field" name="email" type="email" autocomplete="username" required></label><label>Contraseña de nube<input class="login-field" name="password" type="password" autocomplete="current-password" required></label><label class="check"><input name="authorize" type="checkbox" required>Autorizo a esta terminal a conservar una sesión limitada para enviar sus ventas e inventario con cualquier cajero.</label><button class="btn">Autorizar terminal y enviar datos</button></form><p role="status"></p><button class="btn secondary" data-close>Cerrar</button></section>';
    document.body.append(overlay);overlay.querySelector('[data-close]').onclick=()=>overlay.remove();
    overlay.querySelector('form').onsubmit=async e=>{
      e.preventDefault();const form=e.target;const button=form.querySelector('button');button.disabled=true;const status=overlay.querySelector('[role="status"]');
      try {
        Auth.requireAdmin();
        const pending=JSON.parse(localStorage.getItem(this.QUEUE)||'null');
        if(pending?.rejected){if(!confirm('La nube cambió o rechazó el envío. ¿Revisaste los datos y quieres volver a publicar el catálogo local sobre las existencias actuales de nube?'))return;localStorage.removeItem(this.QUEUE);}
        const {error}=await this.api().auth.signInWithPassword({email:form.email.value.trim(),password:form.password.value});form.password.value='';if(error)throw error;
        const claim=await this.api().rpc('pos_claim_access');if(claim.error)throw claim.error;

        let current=await this.api().rpc('pos_snapshot',{p_business:CloudConfig.businessId});if(current.error)throw current.error;
        if(current.data?.member?.role!=='admin')throw new Error('Necesitas una cuenta administradora de nube.');
        Auth.requireAdmin();
        const previous=this.config();
        const installation=previous?.installation||crypto.randomUUID();
        if(!form.authorize.checked)throw new Error('Confirma la autorización de la terminal.');
        const enrollment=await this.api().functions.invoke('enroll-pos-terminal',{body:{business_id:CloudConfig.businessId,installation,authorize_terminal:true}});
        if(enrollment.error)throw new Error('No se pudo autorizar la terminal: '+enrollment.error.message);
        if(enrollment.data.error)throw new Error(enrollment.data.error);
        const installed=await this.terminal().auth.setSession(enrollment.data);if(installed.error)throw installed.error;
        if(pending&&!pending.rejected){await this.sync();if(localStorage.getItem(this.QUEUE))throw new Error('Revisa el envío pendiente antes de continuar.');current=await this.api().rpc('pos_snapshot',{p_business:CloudConfig.businessId});if(current.error)throw current.error;}
        const updated=this.config()||previous;
        localStorage.setItem(this.KEY,JSON.stringify({...updated,installation,lastSnapshot:'',revisions:Object.fromEntries(current.data.products.map(p=>[p.id,p.revision]))}));
        await this.sync();status.textContent='Terminal vinculada. El supervisor recibe ventas, turnos e inventario.';
      } catch(error){status.textContent=error.message;this.status('Envío no completado: '+error.message);}
      finally{await this.api().auth.signOut({scope:'local'}).catch(()=>{});button.disabled=false;}
    };
  },
  init() {
    if(DemoMode)return;
    window.addEventListener('pos:data-saved',()=>this.schedule());
    window.addEventListener('online',()=>this.schedule());
    setInterval(()=>this.schedule(),30000);
    this.schedule();
  }
};
window.addEventListener('load',()=>InventoryCloud.init());
