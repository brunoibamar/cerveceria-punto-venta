// Envío del resumen del corte mediante EmailJS.
const EmailService = {
  config: Object.freeze({
    serviceId: 'service_mij9pos',
    templateId: 'template_dxhxffr',
    publicKey: 'kABVDciMNsPEg2y_-',
    // The EmailJS template uses this fixed recipient directly.
    destination: 'tonitocerveceriapunto@gmail.com'
  }),

  getTemplateParams(corte) {
    const round2 = SalesBreakdown.round2;
    const tickets = Array.isArray(corte.tickets) ? corte.tickets : [];
    const frio = SalesBreakdown.getColdItemsSummary(tickets);
    const promociones = SalesBreakdown.getVolumePromotionsSummary(tickets);
    const totalVentas = round2(Number(corte.totalVentas || 0));
    const descuentosPromociones = round2(Number(corte.descuentosPromociones || 0));
    const financial = SalesBreakdown.getFinancialSummary(tickets);
    const reinversion = financial.cost;
    const gananciaBruta = reinversion === null ? null : round2(totalVentas - financial.deposits - reinversion);
    const fecha = new Date(corte.fechaCierre || Date.now());

    return {
      fecha_hora: fecha.toLocaleString('es-MX', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
      turno_id: corte.turno || corte.corteNumero || 'N/A',
      capital_reinversion: reinversion === null ? 'Sin costos históricos completos' : reinversion,
      ganancias_libres: gananciaBruta === null ? 'Sin costos históricos completos' : gananciaBruta,
      nota_ganancias: 'Utilidad bruta estimada; no descuenta gastos operativos. Excluye los cargos de envases.',
      efectivo_caja: round2(Number(corte.montoApertura || 0) + Number(corte.ventasEfectivo || 0)),
      pagos_tarjeta: round2(Number(corte.ventasTarjeta || 0)),
      transferencia: round2(Number(corte.ventasTransferencia || 0)),
      total_ventas: totalVentas,
      transacciones: Number(corte.cantidadVentas || 0),
      piezas_frias_cant: frio.piezasCant,
      piezas_frias_monto: frio.piezasMonto,
      cartones_frios_cant: frio.cartonesCant,
      cartones_frios_monto: frio.cartonesMonto,
      promociones_cant: promociones.cantidad,
      promociones_monto: promociones.monto
    };
  },

  async sendCorteRespaldo(corte) {
    if (typeof DemoMode !== 'undefined' && DemoMode) return { success: false, error: 'El envío de correos está deshabilitado en la demostración.' };
    if (!corte) {
      return { success: false, error: 'No se recibieron datos del corte de caja.' };
    }
    if (typeof emailjs === 'undefined') {
      return { success: false, error: 'La librería EmailJS no está disponible.' };
    }

    try {
      const templateParams = this.getTemplateParams(corte);
      emailjs.init(this.config.publicKey);
      const response = await emailjs.send(
        'service_mij9pos',
        'template_dxhxffr',
        templateParams
      );
      return { success: true, response: response.text };
    } catch (error) {
      const message = error && (error.text || error.message);
      return {
        success: false,
        error: typeof message === 'string' ? message : 'No se pudo enviar el correo de respaldo.'
      };
    }
  }
};
