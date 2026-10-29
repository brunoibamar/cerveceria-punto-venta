// Cotización visual; el servidor recalcula precios y valida el total al confirmar.
const CloudPricing = {
  cents(value) { return Math.round((Number(value) || 0) * 100); },
  quote(product, quantity, cold, missing, settings = {}) {
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Cantidad inválida');
    const p = product.data;
    const pack = Math.max(0, Number(p.unidadesPorCarton) || 0);
    const full = pack > 0 && Number(p.precioCarton) > 0 ? Math.floor(quantity / pack) : 0;
    const loose = quantity - full * pack;
    const base = this.cents(full * Number(p.precioCarton || 0) + loose * Number(p.precioVenta ?? p.precio ?? 0));
    const extra = (cold ? quantity * this.cents(settings.coldCharge) : 0) +
      (missing ? this.cents(full * Number(p.cobroExtraEnvaseFaltanteCarton || 0) + loose * Number(p.cobroExtraEnvaseFaltantePieza || 0)) : 0);
    return base + extra;
  }
};
if (typeof module !== 'undefined') module.exports = CloudPricing;
