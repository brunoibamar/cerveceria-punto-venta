// Indicador compartido de llenado: nunca crea ni mueve inventario por producto.
const FridgeView = {
  render(host=document.getElementById('app-main')) {
    if(!CashSession.getActiveSession())throw new Error('Inicia sesión para operar el refri.');
    const capacity=Number(Database.getSettings().fridgeCapacity)||24;
    const current=POS.getFridgeStock();
    host.innerHTML='<section class="settings-view"><h2>❄️ Refri</h2><p>Indicador de llenado. Puedes vender cualquier producto frío que tengas disponible físicamente.</p><div class="settings-card"><strong>'+current+' de '+capacity+' piezas</strong><p>Faltan '+Math.max(0,capacity-current)+' piezas para llenarlo.</p><label>Piezas que repusiste<input id="refri-refill" type="number" inputmode="numeric" min="1" max="'+Math.max(1,capacity-current)+'" step="1" value="'+Math.max(1,capacity-current)+'"></label><button class="btn" id="refri-apply" '+(current>=capacity?'disabled':'')+'>Registrar reposición</button><button class="btn secondary" id="refri-full" '+(current>=capacity?'disabled':'')+'>Ya rellené el refri</button><p>No cambia las existencias del inventario general.</p><p role="alert" id="refri-error"></p></div></section>';
    const replenish=amount=>{try{this.refill(amount);this.render(host);}catch(e){host.querySelector('#refri-error').textContent=e.message;}};
    host.querySelector('#refri-apply').onclick=()=>replenish(Number(host.querySelector('#refri-refill').value));
    host.querySelector('#refri-full').onclick=()=>replenish(capacity-current);
  },
  refill(amount) {
    const user=CashSession.getActiveSession();if(!user)throw new Error('Inicia sesión.');
    const capacity=Number(Database.getSettings().fridgeCapacity)||24,current=POS.getFridgeStock();
    if(!Number.isInteger(amount)||amount<=0||current+amount>capacity)throw new Error('Indica las piezas repuestas sin superar la capacidad.');
    DataStore.atomic(()=>{
      POS.setFridgeStock(current+amount);
      const log=JSON.parse(DataStore.getItem('cerveceria_fridge_events')||'[]');
      log.push({id:crypto.randomUUID(),userId:user.userId,name:user.name,amount,created_at:new Date().toISOString()});
      DataStore.setItem('cerveceria_fridge_events',JSON.stringify(log));
    });
  }
};
