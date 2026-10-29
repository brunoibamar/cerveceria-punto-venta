/* Proyección de tickets locales para envío autenticado. No vuelve a descontar stock. */
const TerminalEvents = {
  KEY:'cerveceria_terminal_sales_outbox_v1',
  cents(value){return Math.round(Number(value||0)*100);},
  normalize(sale) {
    const ticket=Array.isArray(sale.items)&&sale.items.some(i=>i.quantity!==undefined)?SalesLog.buildTicket(sale):sale;
    const total=this.cents(ticket.total);
    const lines=(ticket.items||[]).map((i,index)=>({
      product_id:String(i.productId||'legacy:'+ticket.id+':'+index),quantity:Number(i.cantidad??i.quantity),cold:SalesLog.isColdItem(i),
      snapshot:{nombre:i.nombre||i.productName||'Producto',container_cents:this.cents(i.envaseCargo),cold_cents:this.cents(i.cargoFrio)},
      cost_cents:i.costoTotal===null||i.costoTotal===undefined?null:this.cents(i.costoTotal),
      base_cents:this.cents(Number(i.subtotal||0)+Number(i.cargoFrio||0)+Number(i.envaseCargo||0))
    }));
    const sum=lines.reduce((n,i)=>n+i.base_cents,0);let allocated=0;
    lines.forEach((i,index)=>{i.total_cents=index===lines.length-1?total-allocated:Math.round(total*(sum?i.base_cents/sum:1/lines.length));allocated+=i.total_cents;delete i.base_cents;});
    const payment=ticket.breakdown||sale.paymentBreakdown||{};
    return {id:String(ticket.id),shift_id:String(ticket.turnoId||'legacy'),created_at:ticket.fecha,
      cashier_id:String(ticket.cajeroId||'legacy:'+String(ticket.cajero||'Sin responsable')),cashier_name:ticket.cajero||'Sin responsable registrado',
      cashier_role:ticket.cajeroRol||'legacy',status:['cancelada','cancelado','anulada','anulado','cancelled','canceled','void'].includes(String(ticket.status||'').toLowerCase())?'cancelled':'completed',
      total_cents:total,payment:{cash_cents:this.cents(payment.efectivo),card_cents:this.cents(payment.tarjeta),transfer_cents:this.cents(payment.transferencia),method:ticket.paymentMethod||'efectivo',source:'local-terminal'},items:lines};
  },
  enqueue(sale) {
    const queue=JSON.parse(DataStore.getItem(this.KEY)||'{}');queue[sale.id]=this.normalize(sale);
    DataStore.setItem(this.KEY,JSON.stringify(queue));
  },
  collect(bootstrap=false) {
    const entries=new Map();
    if(bootstrap){
      for(const cut of Database.getCuts())for(const ticket of cut.tickets||[])entries.set(String(ticket.id),this.normalize(ticket));
      for(const sale of Database.getSales())entries.set(String(sale.id),this.normalize(sale));
    }
    for(const sale of Object.values(JSON.parse(DataStore.getItem(this.KEY)||'{}')))entries.set(sale.id,sale);
    return Array.from(entries.values());
  },
  acknowledge(sent) {
    const queue=JSON.parse(DataStore.getItem(this.KEY)||'{}');let changed=false;
    for(const sale of sent){if(JSON.stringify(queue[sale.id])===JSON.stringify(sale)){delete queue[sale.id];changed=true;}}
    if(changed)DataStore.setItem(this.KEY,JSON.stringify(queue));
  },
  shifts() {
    const shifts=new Map();
    for(const cut of Database.getCuts()){
      const id=String(cut.turnoId||cut.aperturaId||cut.id);
      const current=shifts.get(id)||{id,cashier_name:cut.usuario||'Cajero',opening_cents:this.cents(cut.montoApertura??cut.montoInicial),opened_at:cut.fechaApertura||cut.fecha,closed_at:null,counted_cents:null};
      if(cut.tipo==='cierre'){current.closed_at=cut.fechaCierre||cut.fecha;current.counted_cents=this.cents(cut.efectivoContado);}
      shifts.set(id,current);
    }
    return Array.from(shifts.values());
  }
};
