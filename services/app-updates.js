/* Actualización voluntaria por pestaña. Conserva almacenamiento y dirección del negocio. */
const AppUpdates = {
  version:'3.6.1', registration:null, pending:null, dismissed:false,
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
    banner.querySelector('[data-update-title]').textContent=this.pending?'Nueva versión disponible':'Actualizaciones';
    banner.querySelector('[data-update-message]').textContent=message||(this.pending?'Actualiza tu punto de venta desde aquí. Tus ventas y el carrito se conservan.':'');
    const button=banner.querySelector('[data-update-apply]');button.hidden=!this.pending;button.disabled=this.reloadRequested;
    button.textContent=this.reloadRequested?'Actualizando…':'Actualizar ahora';
    banner.querySelector('[data-update-dismiss]').textContent=this.pending?'Después':'Cerrar';
  },
  offer(worker) {
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
    if(this.reloadRequested||this.reloading)return;
    const blocked=this.blockedReason();if(blocked){this.render(blocked);return;}
    const worker=this.registration?.waiting||this.pending;
    if(!worker){await this.check(true);return;}
    try {
      // Escritura directa: un error de almacenamiento debe detener la recarga.
      if(typeof App!=='undefined'&&App.currentView&&typeof POS!=='undefined'&&typeof CashSession!=='undefined'&&CashSession.getActiveSession())DataStore.setItem(POS.CART_KEY,JSON.stringify(POS.cart));
      this.reloadRequested=true;this.render('Preparando la versión nueva…');
      if(worker.state==='activated'){this.finish();return;}
      worker.addEventListener('statechange',()=>{if(worker.state==='activated')this.finish();});
      worker.postMessage({type:'ACTIVATE_UPDATE'});
      setTimeout(()=>{if(this.reloadRequested&&!this.reloading){this.reloadRequested=false;this.render('La actualización sigue pendiente. Toca Actualizar ahora para reintentar.');}},20000);
    }catch(error){this.reloadRequested=false;this.render('No se pudo actualizar: '+error.message);}
  },
  async check(manual=false) {
    if(this.checking)return;
    if(typeof DemoMode!=='undefined'&&DemoMode){if(manual)this.render('La simulación temporal se renueva al abrirla de nuevo. El aviso automático funciona en la aplicación normal.');return;}
    if(!('serviceWorker' in navigator)){if(manual)this.render('Este navegador no admite actualizaciones desde la aplicación.');return;}
    if(!navigator.onLine){if(manual)this.render('Necesitas internet para buscar una versión nueva.');return;}
    if(!manual&&Date.now()-this.lastCheck<60000)return;
    this.checking=true;this.lastCheck=Date.now();
    if(manual){this.dismissed=false;this.render('Buscando una versión nueva…');}
    try{
      if(!this.registration){
        this.registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
        this.registration.addEventListener('updatefound',()=>this.observe(this.registration.installing));
        this.observe(this.registration.installing);
      }
      await this.registration.update();
      if(this.registration.waiting)this.offer(this.registration.waiting);
      else if(manual&&!this.registration.installing&&!this.pending)this.render('Tu punto de venta está actualizado · versión '+this.version+'.');
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
