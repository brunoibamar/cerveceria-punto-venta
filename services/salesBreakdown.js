// Cálculos compartidos de frío y promociones para cortes y reportes.
const SalesBreakdown = {
  round2(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 0;
    return Math.round(amount * 100) / 100;
  },

  getVolumePromotionsSummary(transacciones) {
    let cantidad = 0;
    let monto = 0;
    let piezas = 0;

    (Array.isArray(transacciones) ? transacciones : []).forEach(ticket => {
      (Array.isArray(ticket && ticket.items) ? ticket.items : []).forEach(item => {
        if (!item) return;
        const promo = item.promoVolumenAplicada;
        const precio = Number(promo && promo.precio);
        if (!Number.isFinite(precio) || precio <= 0) return;

        cantidad += 1;
        monto += precio;
        piezas += Number(promo.cantidad || item.cantidad || item.quantity || 1);
      });
    });

    return {
      cantidad: cantidad,
      monto: this.round2(monto),
      piezas: piezas
    };
  },

  getColdItemBreakdown(item) {
    if (!item) {
      return { piezasCant: 0, piezasMonto: 0, cartonesCant: 0, cartonesMonto: 0 };
    }
    const cantidad = Number(item.cantidad || item.quantity || 0);
    const cargoFrio = Number(item.cargoFrio) || 0;
    const unidadesPorCarton = Number(item.unidadesPorCarton || 0);
    const hasPromotion = Number(item.promoVolumenAplicada && item.promoVolumenAplicada.precio) > 0;
    const hasCompleteCarton = !hasPromotion && (
      Boolean(item.isCarton || item.carton || item.charola)
      || (unidadesPorCarton > 0 && cantidad >= unidadesPorCarton)
    );
    const cartonUnits = hasCompleteCarton
      ? (unidadesPorCarton > 0 ? Math.floor(cantidad / unidadesPorCarton) * unidadesPorCarton : cantidad)
      : 0;
    const coldRate = cantidad > 0 ? cargoFrio / cantidad : 0;
    const cartonesMonto = this.round2(coldRate * cartonUnits);

    return {
      piezasCant: Math.max(0, cantidad - cartonUnits),
      piezasMonto: this.round2(cargoFrio - cartonesMonto),
      cartonesCant: cartonUnits,
      cartonesMonto: cartonesMonto
    };
  },

  getColdItemsSummary(transacciones) {
    const resumen = {
      piezasCant: 0,
      piezasMonto: 0,
      cartonesCant: 0,
      cartonesMonto: 0
    };

    (Array.isArray(transacciones) ? transacciones : []).forEach(ticket => {
      (Array.isArray(ticket && ticket.items) ? ticket.items : []).forEach(item => {
        if (!item) return;
        const cargoFrio = Number(item.cargoFrio) || 0;
        if (cargoFrio <= 0) return;

        const detalle = this.getColdItemBreakdown(item);
        resumen.cartonesCant += detalle.cartonesCant;
        resumen.cartonesMonto += detalle.cartonesMonto;
        resumen.piezasCant += detalle.piezasCant;
        resumen.piezasMonto += detalle.piezasMonto;
      });
    });

    resumen.piezasMonto = this.round2(resumen.piezasMonto);
    resumen.cartonesMonto = this.round2(resumen.cartonesMonto);
    return resumen;
  }
};
