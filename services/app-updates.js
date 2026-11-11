/* Actualización voluntaria por pestaña. Conserva almacenamiento y dirección del negocio. */
const AppUpdates = {
  version:'3.6.5', registration:null, pending:null, dismissed:false,
  latestVersion:null, available:false, preparing:false,
  checking:false, lastCheck:0, reloadRequested:false, reloading:false,
  render(message) {
    let banner=document.getElementById('app-update-banner');
    if(!banner){
      banner=document.createElement('section');banner.id='app-update-banner';banner.setAttribute('role','status');banner.setAttribute('aria-live','polite');
      banner.innerHTML='<div><strong data-update-title></strong><p data-update-message></p></div><div class="app-update-actions"><button type="button" data-update-apply>Actualizar ahora</button><button type="button" data-update-dismiss>Después</button></div>';
      document.body.append(banner);
      banner.querySelector('[data-update-apply]').onclick=()=>this.apply();
      banner.querySelector('[data-update-dismiss]').onclick=()=>{this.dismissed=true;banner.hidden=true;};
    }
    banner.hidden=false;
    const newer=this.available||!!this.pending;
    banner.querySelector('[data-update-title]').textContent=newer?'Hay una actualización para tu punto de venta':'Actualizaciones';
    const demo=typeof DemoMode!=='undefined'&&DemoMode;
    banner.querySelector('[data-update-message]').textContent=message||(newer?(demo?'Actualiza la aplicación. La simulación temporal se reiniciará.':'Actualiza la aplicación para cargar las mejoras. Tus ventas y el carrito se conservan.'):'');
    const button=banner.querySelector('[data-update-apply]');button.hidden=!newer;button.disabled=this.reloadRequested||this.preparing;
    button.textContent=this.reloadRequested||this.preparing?'Actualizando…':'Actualizar aplicación';
    banner.querySelector('[data-update-dismiss]').textContent=newer?'Después':'Cerrar';
  },
  offer(worker) {
    // Un worker nuevo puede contener la misma versión: no anunciarlo como mejora.
    if(!this.isNewer(this.latestVersion))return;
    if(this.pending!==worker)this.dismissed=false;
    this.pending=worker;
    if(!this.dismissed)this.render();
  },
  observe(worker) {
    if(!worker)return;
    const isUpdate=!!navigator.serviceWorker.controller;
    const inspect=()=>{
      if(worker.state==='installed'&&isUpdate)this.offer(this.registration.waiting||worker);
      if(worker.state==='redundant'&&this.reloadRequested){this.reloadRequested=false;this.pending=null;this.render('No se completó la actualización. Busca la versión nuevamente desde Ajustes.');}
    };
    worker.addEventListener('statechange',inspect);inspect();
  },
  blockedReason() {
    if(typeof POS!=='undefined'&&(POS.paymentProcessing||POS.payment?.isOpen||POS.cut?.isOpen||POS.cut?.busy))return 'Termina o cierra el cobro o corte de caja antes de actualizar.';
    if(typeof POS!=='undefined'&&POS.scanner?.isScanning)return 'Cierra el escáner antes de actualizar.';
    if(typeof InventoryCloud!=='undefined'&&InventoryCloud.busy)return 'Se están enviando datos a la nube. Intenta actualizar cuando termine el envío.';
    if(typeof Cloud!=='undefined'&&(Cloud.busy||Cloud.cart?.length))return 'Termina la operación o vacía el ticket de la caja compartida antes de actualizar.';
    if(document.querySelector('.settings-modal-backdrop, .security-overlay, .inv-modal.is-open')||Array.from(document.querySelectorAll('form[data-update-dirty="true"]')).some(form=>form.getClientRects().length>0))return 'Guarda o cierra el formulario que tienes abierto antes de actualizar.';
    return '';
  },
  finish() {
    if(!this.reloadRequested||this.reloading)return;
    const blocked=this.blockedReason();
    if(blocked){this.reloadRequested=false;this.render('La versión está lista. '+blocked);return;}
    this.reloading=true;
    location.reload();
  },
  async apply() {
    if(this.reloadRequested||this.reloading||this.preparing)return;
    const blocked=this.blockedReason();if(blocked){this.render(blocked);return;}
    try {
      let worker=this.registration?.waiting||this.pending;
      if(this.available&&(!worker||this.registrationRelease!==this.latestVersion)){
        this.preparing=true;this.render('Descargando la actualización. Espera un momento…');
        await this.connectRegistration();await this.registration.update();
        worker=this.registration.waiting||this.registration.installing;
        if(!worker&&this.registration.active?.scriptURL&&new URL(this.registration.active.scriptURL,location.href).searchParams.get('release')===this.latestVersion)worker=this.registration.active;
        if(!worker)throw new Error('La actualización todavía no está lista. Intenta nuevamente.');
        await this.waitUntilReady(worker);
      }
      const changed=this.blockedReason();if(changed){this.preparing=false;this.render(changed);return;}
      if(!worker){await this.check(true);return;}
      // Escritura directa: un error de almacenamiento debe detener la recarga.
      if(typeof App!=='undefined'&&App.currentView&&typeof POS!=='undefined'&&typeof CashSession!=='undefined'&&CashSession.getActiveSession())DataStore.setItem(POS.CART_KEY,JSON.stringify(POS.cart));
      this.preparing=false;
      this.reloadRequested=true;this.render('Preparando la versión nueva…');
      if(worker.state==='activated'){this.finish();return;}
      worker.addEventListener('statechange',()=>{if(worker.state==='activated')this.finish();});
      worker.postMessage({type:'ACTIVATE_UPDATE'});
      setTimeout(()=>{if(this.reloadRequested&&!this.reloading){this.reloadRequested=false;this.render('La actualización sigue pendiente. Toca Actualizar ahora para reintentar.');}},20000);
    }catch(error){this.reloadRequested=false;this.preparing=false;this.render('No se pudo actualizar: '+error.message);}
    finally{this.preparing=false;}
  },
  waitUntilReady(worker) {
    if(['installed','activated'].includes(worker.state))return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('La descarga sigue pendiente. Revisa tu conexión y reintenta.')),30000);
      worker.addEventListener('statechange',()=>{
        if(['installed','activated'].includes(worker.state)){clearTimeout(timeout);resolve();}
        else if(worker.state==='redundant'){clearTimeout(timeout);reject(new Error('No se completó la descarga.'));}
      });
    });
  },
  async connectRegistration() {
    const release=this.latestVersion||this.version;
    if(this.registration&&(!this.available||this.registrationRelease===release))return;
    if(!('serviceWorker' in navigator))throw new Error('Este navegador no permite instalar la actualización desde aquí.');
    this.registration=await navigator.serviceWorker.register('./sw.js?release='+encodeURIComponent(release),{updateViaCache:'none'});
    this.registrationRelease=release;
    this.registration.addEventListener('updatefound',()=>this.observe(this.registration.installing));
    this.observe(this.registration.installing);
  },
  isNewer(version) {
    if(!/^\d+\.\d+\.\d+$/.test(version||''))return false;
    const next=version.split('.').map(Number),current=this.version.split('.').map(Number);
    for(let n=0;n<3;n++){if(next[n]!==current[n])return next[n]>current[n];}
    return false;
  },
  async check(manual=false) {
    if(this.checking)return;
    if(!navigator.onLine){if(manual)this.render('Necesitas internet para buscar actualizaciones.');return;}
    if(!manual&&Date.now()-this.lastCheck<60000)return;
    this.checking=true;this.lastCheck=Date.now();
    if(manual){this.dismissed=false;this.render('Buscando una versión nueva…');}
    try{
      let knownVersion=false;
      try{
        const url=new URL('./version.json',location.href);url.searchParams.set('check',String(Date.now()));
        const response=await fetch(url.href,{cache:'no-store'});if(!response.ok)throw new Error('Versión no disponible');
        const info=await response.json();if(!/^\d+\.\d+\.\d+$/.test(info.version||''))throw new Error('Versión inválida');
        const changed=this.latestVersion!==info.version;
        this.latestVersion=info.version;this.available=this.isNewer(info.version);knownVersion=true;
        if(this.available&&changed)this.dismissed=false;
        if(!this.available){
          this.pending=null;
          const banner=document.getElementById('app-update-banner');
          if(!manual&&banner&&!this.reloadRequested&&!this.preparing)banner.hidden=true;
        }
        if(this.available&&!this.dismissed)this.render();
      }catch(error){/* La detección del navegador sigue disponible si falla la consulta de versión. */}
      if(typeof DemoMode!=='undefined'&&DemoMode){
        if(manual&&!this.available)this.render('Tu punto de venta está actualizado · versión '+this.version+'.');
        return;
      }
      if(!('serviceWorker' in navigator)){if(manual&&!this.available)this.render('No se pudo comprobar la instalación en este navegador.');return;}
      await this.connectRegistration();
      await this.registration.update();
      if(this.registration.waiting)this.offer(this.registration.waiting);
      else if(manual&&!this.registration.installing&&!this.pending&&!this.available)this.render(knownVersion?'Tu punto de venta está actualizado · versión '+this.version+'.':'No se pudo comprobar la versión publicada. Reintenta cuando tengas conexión.');
    }catch(error){if(manual)this.render('No se pudo buscar la actualización. Revisa tu conexión e intenta nuevamente.');}
    finally{this.checking=false;}
  },
  init() {
    if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('controllerchange',()=>this.finish());
    document.addEventListener('input',event=>{const form=event.target.closest?.('form');if(form)form.dataset.updateDirty='true';});
    window.addEventListener('online',()=>this.check());
    window.addEventListener('focus',()=>this.check());
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.check();});
    setInterval(()=>{if(!document.hidden)this.check();},300000);
    this.check();
  }
};
window.addEventListener('load',()=>AppUpdates.init());
