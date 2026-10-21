// Servicio de EmailJS para envío de respaldos de cortes de caja
// Requiere la librería de EmailJS cargada en el HTML (script)

const EmailService = {
  // Configuración de EmailJS
  config: {
    publicKey: 'TU_PUBLIC_KEY_AQUI', // Reemplazar con tu Public Key de EmailJS
    serviceId: 'TU_SERVICE_ID_AQUI', // Reemplazar con tu Service ID de EmailJS
    templateId: 'TU_TEMPLATE_ID_AQUI' // Reemplazar con tu Template ID de EmailJS
  },

  /**
   * Envía el resumen de un corte de caja por correo electrónico.
   * @param {Object} corte - Datos del corte de caja.
   * @param {string} emailDestino - Correo electrónico al que se desea enviar.
   * @param {string} [asunto] - Asunto opcional del correo.
   */
  async sendCorteRespaldo(corte, emailDestino, asunto = 'Respaldo de Corte de Caja') {
    try {
      // Validar que emailjs esté disponible
      if (typeof emailjs === 'undefined') {
        throw new Error('La librería de EmailJS no está cargada.');
      }

      // Preparar los parámetros del template
      const templateParams = {
        to_email: emailDestino,
        subject: asunto,
        corte_id: corte.id || 'N/A',
        fecha: corte.fecha || new Date().toISOString().split('T')[0],
        hora: corte.hora || new Date().toLocaleTimeString(),
        total_efectivo: corte.totalEfectivo || 0,
        total_tarjeta: corte.totalTarjeta || 0,
        total_general: corte.totalGeneral || 0,
        numero_transacciones: corte.transacciones ? corte.transacciones.length : 0,
        vendedor: corte.ventas || 'Sistema',
        productos: corte.productos ? JSON.stringify(corte.productos) : '[]'
      };

      // Enviar el correo
      const response = await emailjs.send(
        this.config.serviceId,
        this.config.templateId,
        templateParams,
        this.config.publicKey
      );

      console.log('Email de respaldo enviado correctamente:', response);
      return { success: true, response };
    } catch (error) {
      console.error('Error al enviar el email de respaldo:', error);
      return { success: false, error: error.message || error };
    }
  },

  /**
   * Configura las credenciales de EmailJS.
   * @param {Object} creds - Objeto con publicKey, serviceId y templateId.
   */
  setConfig(creds) {
    if (creds.publicKey) this.config.publicKey = creds.publicKey;
    if (creds.serviceId) this.config.serviceId = creds.serviceId;
    if (creds.templateId) this.config.templateId = creds.templateId;
  }
};

// Exportar para su uso en otros módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EmailService;
}