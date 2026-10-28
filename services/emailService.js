// Envío del resumen del corte mediante EmailJS.
const EmailService = {
  config: Object.freeze({
    serviceId: 'service_1576q89',
    templateId: 'template_dkl2n9i',
    publicKey: 'SqbjTPIS_U8CAwQTw',
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
    const capitalNeto = round2(totalVentas - descuentosPromociones);
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
      capital_reinversion: capitalNeto,
      ganancias_libres: capitalNeto,
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
    if (!corte) {
      return { success: false, error: 'No se recibieron datos del corte de caja.' };
    }
    if (typeof emailjs === 'undefined') {
      return { success: false, error: 'La librería EmailJS no está disponible.' };
    }

    try {
      const templateParams = this.getTemplateParams(corte);
      const response = await emailjs.send(
        this.config.serviceId,
        this.config.templateId,
        templateParams,
        { publicKey: this.config.publicKey }
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
