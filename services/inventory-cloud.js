/* Espejo de inventario con autorización inicial, cola persistente y revisión de conflictos. */
const InventoryCloud = {
  KEY:'pos_inventory_link_v1', QUEUE:'pos_inventory_outbox_v1', busy:false, timer:null,
  client:null,authorized:false,
  config() { return JSON.parse(localStorage.getItem(this.KEY)||'null'); },
  api() { return this.client ||= supabase.createClient(CloudConfig.url,CloudConfig.key,{auth:{storageKey:'pos-inventory-auth-v1',persistSession:false,autoRefreshToken:true,detectSessionInUrl:false}}); },
  normalized(products) {
    return products.map(p=>({id:String(p.id),stock:Number(p.stock||0),cold_stock:Number(p.coldStock||0),data:{...p,
      precioVenta:Number(p.precioVenta??p.precio??0),costoPieza:Number(p.costoPieza??p.precioCompra??0),
      unidadesPorCarton:Number(p.unidadesPorCarton||0),precioCarton:Number(p.precioCarton||0),costoCarton:Number(p.costoCarton||0),
      cobroExtraEnvaseFaltantePieza:Number(p.cobroExtraEnvaseFaltantePieza||0),cobroExtraEnvaseFaltanteCarton:Number(p.cobroExtraEnvaseFaltanteCarton||0)}}));
  },
  snapshot() {
    if(DataStore.getItem('cerveceria_products')===null) throw new Error('No se encuentra el catálogo local. No se modificó la nube.');
    return JSON.stringify({products:this.normalized(Database.getProducts()),cycles:Database.getInventoryCycles()});
  },
  status(message) {
    let banner=document.getElementById('inventory-cloud-status');
    if(!banner){banner=document.createElement('div');banner.id='inventory-cloud-status';banner.className='inventory-cloud-status';banner.setAttribute('role','status');document.body.append(banner);}
    banner.textContent=message;
  },
  schedule() { clearTimeout(this.timer); this.timer=setTimeout(()=>this.sync().catch(e=>this.status('Inventario pendiente de nube: '+e.message)),700); },
  async sync() {
    if(DemoMode||this.busy||!this.config()) return;
    if(!Auth.isAdmin()){if(this.authorized){await this.api().auth.signOut({scope:'local'});this.authorized=false;}return;}
    if(!this.authorized){this.status('Inventario pendiente · autoriza la nube desde Ajustes en esta sesión.');return;}
    if(!navigator.onLine){this.status('Sin internet · inventario guardado en este dispositivo, pendiente de nube.');return;}
    const cfg=this.config();
    const snapshot=this.snapshot();
    if(snapshot===cfg.lastSnapshot&&!localStorage.getItem(this.QUEUE))return;
    this.busy=true; let retryLater=false;
    try {
      let pending=JSON.parse(localStorage.getItem(this.QUEUE)||'null');
      if(!pending){pending={id:crypto.randomUUID(),snapshot,payload:{...JSON.parse(snapshot),installation:cfg.installation,expected:cfg.revisions}};localStorage.setItem(this.QUEUE,JSON.stringify(pending));}
      this.status('Guardando inventario en la nube…');
      if(pending.rejected)throw new Error(pending.rejected);
      const {data,error}=await this.api().rpc('pos_sync_inventory',{p_business:CloudConfig.businessId,p_request:pending.id,p_payload:pending.payload});
      if(error){if(error.code==='P0001'){pending.rejected=error.message;localStorage.setItem(this.QUEUE,JSON.stringify(pending));}throw error;}
      cfg.revisions=data.revisions;cfg.lastSnapshot=pending.snapshot;cfg.lastSync=data.synced_at;
      localStorage.setItem(this.KEY,JSON.stringify(cfg));localStorage.removeItem(this.QUEUE);
      this.status('Inventario en nube actualizado · '+new Date(data.synced_at).toLocaleTimeString('es-MX'));
      retryLater=this.snapshot()!==pending.snapshot;
    } finally {this.busy=false;if(retryLater)this.schedule();}
  },
  open() {
    Auth.requireAdmin();
    if(DemoMode){alert('La simulación en memoria no se vincula a la nube. Abre la aplicación normal para publicar tu inventario.');return;}
    const overlay=document.createElement('div');overlay.className='security-overlay';
    overlay.innerHTML='<section class="security-card"><h2>Vincular inventario con supervisor</h2><p>Este dispositivo será el origen del inventario. La primera publicación reemplaza las existencias de nube con tu catálogo local. Los cambios siguientes se enviarán durante esta sesión de administrador, incluidos ciclos y conteos. Después de cerrar o recargar autoriza de nuevo. No se guarda tu sesión de nube.</p><p>Las ventas locales todavía no se transfieren como tickets. Si otro dispositivo modifica la nube, se detiene el envío para no sobrescribirlo.</p><form class="login-form"><label>Correo administrador<input class="login-field" name="email" type="email" autocomplete="username" required></label><label>Contraseña de nube<input class="login-field" name="password" type="password" autocomplete="current-password" required></label><button class="btn">Vincular y publicar inventario local</button></form><p role="status"></p><button class="btn secondary" data-close>Cerrar</button></section>';
    document.body.append(overlay);overlay.querySelector('[data-close]').onclick=()=>overlay.remove();
    overlay.querySelector('form').onsubmit=async e=>{
      e.preventDefault();const form=e.target;const button=form.querySelector('button');button.disabled=true;const status=overlay.querySelector('[role="status"]');
      try {
        Auth.requireAdmin();
        const pending=JSON.parse(localStorage.getItem(this.QUEUE)||'null');
        if(pending?.rejected){if(!confirm('La nube cambió o rechazó el envío. ¿Revisaste los datos y quieres volver a publicar el catálogo local sobre las existencias actuales de nube?'))return;localStorage.removeItem(this.QUEUE);}
        const {error}=await this.api().auth.signInWithPassword({email:form.email.value.trim(),password:form.password.value});form.password.value='';if(error)throw error;
        const claim=await this.api().rpc('pos_claim_access');if(claim.error)throw claim.error;
        this.authorized=true;
        if(pending&&!pending.rejected){await this.sync();if(localStorage.getItem(this.QUEUE))throw new Error('Resuelve el envío pendiente antes de volver a vincular.');}
        const current=await this.api().rpc('pos_snapshot',{p_business:CloudConfig.businessId});if(current.error)throw current.error;
        if(current.data?.member?.role!=='admin')throw new Error('Necesitas una cuenta administradora de nube.');
        Auth.requireAdmin();
        const previous=this.config();
        const installation=previous?.installation||crypto.randomUUID();
        localStorage.setItem(this.KEY,JSON.stringify({installation,revisions:Object.fromEntries(current.data.products.map(p=>[p.id,p.revision]))}));
        await this.sync();status.textContent='Inventario publicado. El supervisor ya puede consultarlo.';
      } catch(error){status.textContent=error.message;this.status('Inventario no sincronizado: '+error.message);this.authorized=false;await this.api().auth.signOut({scope:'local'}).catch(()=>{});}
      finally{button.disabled=false;}
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
