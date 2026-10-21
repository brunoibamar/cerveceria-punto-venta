// Configuración general del negocio: tarjetas interactivas + modales flotantes
// Paleta "Midnight & Amber": fondo #12100E, tarjetas #1C1815, acento #E0A96D
//
// Cada tarjeta-botón abre un modal flotante CENTRADO (ventana emergente
// superpuesta con fondo difuminado) que contiene únicamente los campos del
// módulo elegido. Nada se despliega plano debajo de las tarjetas.

const SettingsManager = {
  containerId: 'settings-content',
  overlayId: 'settings-modal-overlay',

  // Descripción de cada modal: título, subtítulo y campos propios
  MODALS: {
    ticket: {
      title: 'Configuración de Ticket',
      subtitle: 'Personaliza el encabezado y el pie del ticket impreso.',
      icon: '🧾'
    },
    cold: {
      title: 'Cargo por Bebida Fría',
      subtitle: 'Importe que se suma al ticket por cada producto marcado como frío ❄️.',
      icon: '❄️'
    },
    fridge: {
      title: 'Refrigerador',
      subtitle: 'Capacidad de la nevera fría y control de piezas disponibles.',
      icon: '🧊'
    },
    email: {
      title: 'Correo de Respaldo (EmailJS)',
      subtitle: 'Credenciales usadas por “Corte de Caja → Enviar a correo”.',
      icon: '📧'
    },
    mp: {
      title: 'Mercado Pago',
      subtitle: 'Link de cobro que se codifica en el QR y se usa con NFC o terminal.',
      icon: '💳'
    },
    backup: {
      title: 'Respaldo de Seguridad (JSON)',
      subtitle: 'Descarga o restaura el respaldo completo del punto de venta.',
      icon: '💾'
    }
  },

  init(containerId) {
    this.containerId = containerId || this.containerId;
    this.render();
  },

  render() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    const settings = Database.getSettings();
    const currency = settings.currencySymbol || '$';

    container.innerHTML = `
      <header class="settings-header">
        <div>
          <h2 class="settings-title">⚙️ Ajustes</h2>
          <p class="settings-subtitle">Configura el negocio, la nevera, los cobros con tarjeta, los correos y los respaldos del punto de venta.</p>
        </div>
      </header>
      <div class="settings-grid">
        <button class="settings-card" data-modal="ticket">
          <span class="settings-card-icon">🧾</span>
          <span class="settings-card-title">Configuración de Ticket</span>
          <span class="settings-card-arrow">▸</span>
        </button>
        <button class="settings-card" data-modal="cold">
          <span class="settings-card-icon">❄️</span>
          <span class="settings-card-title">Cargo por Bebida Fría</span>
          <span class="settings-card-sub">${currency}${Number(settings.coldCharge || 0).toFixed(2)}</span>
          <span class="settings-card-arrow">▸</span>
        </button>
        <button class="settings-card" data-modal="fridge">
          <span class="settings-card-icon">🧊</span>
          <span class="settings-card-title">Refrigerador</span>
          <span class="settings-card-sub">${Number(settings.fridgeCapacity || 24)} piezas</span>
          <span class="settings-card-arrow">▸</span>
        </button>
        <button class="settings-card" data-modal="email">
          <span class="settings-card-icon">📧</span>
          <span class="settings-card-title">Correo de Respaldo (EmailJS)</span>
          <span class="settings-card-arrow">▸</span>
        </button>
        <button class="settings-card" data-modal="mp">
          <span class="settings-card-icon">💳</span>
          <span class="settings-card-title">Mercado Pago</span>
          <span class="settings-card-sub">${settings.mercadoPagoCobroUrl ? 'QR · NFC · Terminal' : 'Sin link de cobro'}</span>
          <span class="settings-card-arrow">▸</span>
        </button>
        <button class="settings-card" data-modal="backup">
          <span class="settings-card-icon">💾</span>
          <span class="settings-card-title">Respaldo de Seguridad (JSON)</span>
          <span class="settings-card-sub">Descargar · Importar</span>
          <span class="settings-card-arrow">▸</span>
        </button>
      </div>
    `;

    container.querySelectorAll('.settings-card').forEach(btn => {
      btn.addEventListener('click', () => this.openModal(btn.dataset.modal));
    });
  },

  // Abre el modal flotante del módulo indicado
  openModal(type) {
    const meta = this.MODALS[type];
    if (!meta) return;

    const settings = Database.getSettings();
    const currency = settings.currencySymbol || '$';

    const body = this.buildModalBody(type, settings, currency);

    // El modal vive fuera de la vista: siempre flota centrado sobre la app
    this.closeModal();

    const overlay = document.createElement('div');
    overlay.id = this.overlayId;
    overlay.className = 'settings-modal-backdrop';
    overlay.innerHTML = `
      <div class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
        <button type="button" class="settings-modal-close" id="settings-modal-close" aria-label="Cerrar">✕</button>
        <h3 class="settings-modal-title" id="settings-modal-title">${meta.icon} ${this.escapeHtml(meta.title)}</h3>
        <p class="settings-modal-sub">${this.escapeHtml(meta.subtitle)}</p>
        ${body}
        ${type !== 'backup' ? '<button type="button" class="settings-modal-save" id="settings-modal-save">Guardar</button>' : ''}
      </div>
    `;

    document.body.appendChild(overlay);
    this.bindModal(overlay, type);

    // Enfoca el primer campo del modal para escribir de inmediato
    setTimeout(() => {
      const firstField = overlay.querySelector('.settings-modal input:not([type="file"]), .settings-modal input[type="file"]');
      if (firstField) firstField.focus();
    }, 80);
  },

  // Campos exclusivos de cada módulo
  buildModalBody(type, settings, currency) {
    if (type === 'ticket') {
      return `
        <div class="modal-field">
          <label for="m-businessName">Nombre del negocio</label>
          <input type="text" id="m-businessName" value="${this.escapeAttr(settings.businessName || '')}" />
        </div>
        <div class="modal-field">
          <label for="m-ticketHeader">Encabezado del ticket</label>
          <input type="text" id="m-ticketHeader" value="${this.escapeAttr(settings.ticketHeader || '')}" />
        </div>
        <div class="modal-field">
          <label for="m-ticketFooter">Pie de página del ticket</label>
          <input type="text" id="m-ticketFooter" value="${this.escapeAttr(settings.ticketFooter || '')}" />
        </div>
      `;
    }

    if (type === 'cold') {
      return `
        <div class="modal-field">
          <label for="m-coldCharge">Cargo por Bebida Fría (${this.escapeHtml(currency)})</label>
          <input type="number" id="m-coldCharge" value="${Number(settings.coldCharge) || 0}" step="0.01" min="0" />
          <p class="form-hint">Se suma automáticamente al ticket por cada producto marcado como frío ❄️. Usa 0 si no aplica.</p>
        </div>
      `;
    }

    if (type === 'fridge') {
      return `
        <div class="modal-field">
          <label for="m-fridgeCapacity">Capacidad Máxima de la Nevera (piezas)</label>
          <input type="number" id="m-fridgeCapacity" value="${Number(settings.fridgeCapacity) || 24}" step="1" min="1" />
          <p class="form-hint">Cantidad máxima de piezas frías que puede contener la nevera. Se usa al rellenar automáticamente.</p>
        </div>
      `;
    }

    if (type === 'email') {
      return `
        <div class="modal-field">
          <label for="m-serviceId">Service ID</label>
          <input type="text" id="m-serviceId" value="${this.escapeAttr(settings.emailServiceId || settings.serviceId || '')}" />
        </div>
        <div class="modal-field">
          <label for="m-templateId">Template ID</label>
          <input type="text" id="m-templateId" value="${this.escapeAttr(settings.emailTemplateId || settings.templateId || '')}" />
        </div>
        <div class="modal-field">
          <label for="m-publicKey">Public Key</label>
          <input type="text" id="m-publicKey" value="${this.escapeAttr(settings.emailPublicKey || settings.publicKey || '')}" />
        </div>
        <p class="form-hint">Credenciales de EmailJS usadas por “Corte de Caja → Enviar a correo”.</p>
      `;
    }

    if (type === 'mp') {
      return `
        <div class="modal-field">
          <label for="m-mercadoPagoCobroUrl">Link o plantilla del cobro</label>
          <input type="text" id="m-mercadoPagoCobroUrl" value="${this.escapeAttr(settings.mercadoPagoCobroUrl || '')}" placeholder="https://www.mercadopago.com.mx/..." />
          <p class="form-hint">Es el link de cobro de tu cuenta de Mercado Pago. Admite las variables {amount}, {currency}, {reference} y {folio}. Si lo dejas vacío, el QR del modal de venta muestra una referencia local del cobro.</p>
        </div>
      `;
    }

    if (type === 'backup') {
      const today = new Date().toISOString().split('T')[0];
      return `
        <div class="modal-field">
          <button type="button" class="settings-modal-save" id="btn-export-backup">📥 Descargar Respaldo (.json)</button>
        </div>
        <div class="modal-field">
          <label for="input-import-backup">📤 Importar y Restablecer Respaldo</label>
          <input type="file" id="input-import-backup" accept="application/json,.json" />
          <p class="form-hint">Selecciona un archivo .json generado previamente. Se solicitará confirmación antes de restaurar.</p>
        </div>
        <p class="form-hint">El respaldo incluye productos, ventas, cortes de caja, promociones y configuración (${today}).</p>
      `;
    }

    return '';
  },

  // Eventos del modal flotante: cerrar, guardar y atajos de teclado
  bindModal(overlay, type) {
    const closeBtn = document.getElementById('settings-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeModal());
    }

    // Clic en el fondo oscuro: cierra el modal
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.closeModal();
    });

    if (type === 'backup') {
      const exportBtn = document.getElementById('btn-export-backup');
      if (exportBtn) {
        exportBtn.addEventListener('click', () => this.exportBackup());
      }
      const importInput = document.getElementById('input-import-backup');
      if (importInput) {
        importInput.addEventListener('change', (e) => this.importBackup(e));
      }
    } else {
      const saveBtn = document.getElementById('settings-modal-save');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => this.saveModal(type));
      }
    }

    if (!this._escapeBound) {
      this._escapeBound = true;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.getElementById(this.overlayId)) {
          this.closeModal();
        }
      });
    }
  },

  saveModal(type) {
    const settings = Database.getSettings();
    if (type === 'ticket') {
      settings.businessName = document.getElementById('m-businessName').value;
      settings.ticketHeader = document.getElementById('m-ticketHeader').value;
      settings.ticketFooter = document.getElementById('m-ticketFooter').value;
    } else if (type === 'cold') {
      const v = parseFloat(document.getElementById('m-coldCharge').value);
      settings.coldCharge = Number.isFinite(v) && v > 0 ? v : 0;
    } else if (type === 'fridge') {
      const v = parseInt(document.getElementById('m-fridgeCapacity').value, 10);
      settings.fridgeCapacity = Number.isFinite(v) && v > 0 ? v : 24;
    } else if (type === 'email') {
      settings.emailServiceId = document.getElementById('m-serviceId').value;
      settings.emailTemplateId = document.getElementById('m-templateId').value;
      settings.emailPublicKey = document.getElementById('m-publicKey').value;
    } else if (type === 'mp') {
      settings.mercadoPagoCobroUrl = document.getElementById('m-mercadoPagoCobroUrl').value.trim();
    }
    Database.saveSettings(settings);
    this.closeModal();
    this.render();
  },

  // Cierra y retira el modal flotante del DOM
  closeModal() {
    const overlay = document.getElementById(this.overlayId);
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  },

  exportBackup() {
    try {
      const backup = Database.exportBackup();
      const jsonStr = JSON.stringify(backup, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const dateStr = new Date().toISOString().split('T')[0];
      const link = document.createElement('a');
      link.href = url;
      link.download = `respaldo_pos_${dateStr}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      alert('Respaldo exportado correctamente');
    } catch (error) {
      alert('Error al exportar respaldo: ' + error.message);
    }
  },

  importBackup(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      alert('Por favor selecciona un archivo .json válido');
      event.target.value = '';
      return;
    }

    if (!confirm('¿Está seguro de restaurar el respaldo? Esto sobrescribirá todos los datos actuales (productos, ventas, cortes, promociones y configuración). Esta acción no se puede deshacer.')) {
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const backupData = JSON.parse(e.target.result);
        const success = Database.importBackup(backupData);
        if (success) {
          alert('Respaldo restaurado correctamente. La aplicación se recargará.');
          window.location.reload();
        }
      } catch (error) {
        alert('Error al importar respaldo: ' + error.message);
      } finally {
        event.target.value = '';
      }
    };
    reader.onerror = () => {
      alert('Error al leer el archivo');
      event.target.value = '';
    };
    reader.readAsText(file);
  },

  getSettings() {
    return Database.getSettings();
  },

  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  },

  escapeAttr(text) {
    return this.escapeHtml(text)
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
};

if (typeof window !== 'undefined') {
  window.SettingsManager = SettingsManager;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SettingsManager;
}
