// Una sola pestaña operativa evita ventas simultáneas sobre el mismo inventario local.
const WriteGuard = {
  ready: false, started: false,
  start(run) {
    if (this.started) return; this.started=true;
    const main=document.getElementById('app-main');
    if (!navigator.locks) { main.textContent='Este navegador no permite proteger las operaciones simultáneas. Abre el sistema en una versión reciente de Chrome o Edge mediante localhost o HTTPS.'; return; }
    navigator.locks.request('cerveceria-single-writer'+(typeof ProductionMode!=='undefined'&&ProductionMode?'-production':''), { ifAvailable:true }, async lock=>{
      if (!lock) { main.innerHTML='<div class="startup-notice"><h2>La caja está abierta en otra pestaña</h2><p>Cierra la otra pestaña para operar aquí y evitar ventas duplicadas.</p><button class="btn" onclick="location.reload()">Intentar de nuevo</button><p><a href="nube.html?mode=supervisor" target="_blank" rel="noopener">Entrar como supervisor</a></p></div>'; return; }
      this.ready=true; run(); await new Promise(resolve=>{this.release=resolve;});
    }).catch(error=>{ main.textContent=error.message; });
  }
};
const ShiftGuard = {
  checking:false,
  check() {
    if (this.checking || !WriteGuard.ready) return;
    const session=CashSession.getActiveSession(); if (!session) return;
    const opened=new Date(session.openedAt); const now=new Date();
    if (SalesLog.dateKey(opened) === SalesLog.dateKey(now)) return;
    this.checking=true;
    // No se inventa un conteo físico: el cierre vencido exige revisión del cajero.
    const banner=document.createElement('div'); banner.className='shift-warning'; banner.id='shift-warning';
    banner.innerHTML='<strong>Turno pendiente de cierre</strong><span>El turno comenzó un día anterior. Revisa el corte antes de seguir vendiendo.</span><button class="btn" id="review-expired-cut">Revisar corte</button>';
    if (!document.getElementById('shift-warning')) document.body.appendChild(banner);
    banner.querySelector('button').onclick=()=>POS.openCashCutModal();
    this.checking=false;
  },
  overdue() { const s=CashSession.getActiveSession(); return !!s && SalesLog.dateKey(s.openedAt) < SalesLog.dateKey(new Date()); }
};
window.addEventListener('focus',()=>ShiftGuard.check());
document.addEventListener('visibilitychange',()=>{if (!document.hidden) ShiftGuard.check();});
setInterval(()=>ShiftGuard.check(),30000);
const PaymentVerification = {
  getAll() { return JSON.parse(DataStore.getItem('cerveceria_payment_attempts') || '[]'); },
  save(list) { DataStore.setItem('cerveceria_payment_attempts',JSON.stringify(list)); },
  finish(id,status,saleId) { const list=this.getAll(); const entry=list.find(x=>x.id===id); if (!entry) throw new Error('No existe el intento de cobro.'); entry.status=status; entry.saleId=saleId || null; entry.updatedAt=new Date().toISOString(); this.save(list); },
  request(amount, requireReference = true) {
    const attempt={id:crypto.randomUUID(),amount,status:'pending',createdAt:new Date().toISOString(),userId:CashSession.getActiveSession().userId};
    const list=this.getAll(); list.push(attempt); this.save(list);
    // Finalizar el cobro con tarjeta es la declaración del cajero, no una validación bancaria.
    if (!requireReference) return Promise.resolve({...attempt,status:'confirmed',method:'cashier-declared',bankVerified:false,declaredBy:attempt.userId,declaredAt:new Date().toISOString()});
    return new Promise(resolve=>{
      const overlay=document.createElement('div'); overlay.className='security-overlay';
      overlay.innerHTML='<section class="security-card" role="dialog" aria-modal="true" aria-labelledby="verify-heading"><h2 id="verify-heading">Pago pendiente de verificación</h2><p id="verify-amount"></p><p>Revisa el movimiento aprobado en la terminal, banco o Mercado Pago. El QR por sí solo no confirma el pago.</p><form class="login-form"><input class="login-field" name="reference" placeholder="Referencia o autorización del movimiento" required maxlength="120"><label><input type="checkbox" name="verified" required> Verifiqué que el importe fue recibido y aprobado.</label><button class="btn" type="submit">Confirmar pago recibido</button></form><button class="btn secondary" id="verify-cancel">Cancelar intento</button></section>';
      document.body.appendChild(overlay); overlay.querySelector('#verify-amount').textContent='Importe electrónico: $'+amount.toFixed(2);
      overlay.querySelector('#verify-cancel').onclick=()=>{this.finish(attempt.id,'cancelled'); overlay.remove(); resolve(null);};
      overlay.querySelector('form').onsubmit=e=>{e.preventDefault(); const reference=e.target.reference.value.trim(); if (!reference || !e.target.verified.checked) return; overlay.remove(); resolve({...attempt,status:'confirmed',reference,method:'manual',verifiedBy:attempt.userId,verifiedAt:new Date().toISOString()});};
      overlay.querySelector('input').focus();
    });
  }
};
