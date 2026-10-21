// Utilidades de animación de la interfaz (Dashboard V14)
// Entrada escalonada de tarjetas, fade-in de vistas y soporte de micro-interacciones.
// Las clases y los keyframes viven en css/styles.css.

const UIAnimations = {
  STEP_MS: 45,       // Retraso entre cada elemento de la cascada
  MAX_STAGGER: 12,   // Máximo de elementos con retraso individual
  CLEANUP_MS: 1100,  // Margen antes de retirar la animación de la cascada

  // Reproduce la entrada escalonada (slide-up) de los hijos de un contenedor.
  // La cascada se retira al terminar para no interferir con los renders posteriores.
  stagger(container) {
    try {
      if (!container) return;
      const items = Array.prototype.slice.call(container.children || []);
      if (!items.length) return;

      items.forEach((item, index) => {
        const delay = Math.min(index, this.MAX_STAGGER) * this.STEP_MS;
        item.style.animationDelay = delay + 'ms';
      });

      container.classList.add('animate-stagger');

      clearTimeout(this._staggerTimer);
      this._staggerTimer = setTimeout(() => {
        container.classList.remove('animate-stagger');
        items.forEach(item => { item.style.animationDelay = ''; });
      }, this.CLEANUP_MS);
    } catch (error) {
      console.error('[UIAnimations] Error en la entrada escalonada:', error);
    }
  },

  // Entrada escalonada del contenedor indicado dentro de una vista.
  // Espera a que el contenedor exista cuando la vista se renderiza de forma asíncrona.
  staggerIn(root, selector, attempts) {
    try {
      if (!root || !selector) return;
      const pending = typeof attempts === 'number' ? attempts : 10;
      const container = root.querySelector ? root.querySelector(selector) : null;

      if (!container) {
        if (pending > 0 && typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => this.staggerIn(root, selector, pending - 1));
        }
        return;
      }

      this.stagger(container);
    } catch (error) {
      console.error('[UIAnimations] Error en la entrada escalonada de la vista:', error);
    }
  },

  // Fade-in de un contenedor de vista: la animación se reinicia en cada cambio de pestaña
  fadeIn(element) {
    try {
      if (!element) return;
      element.classList.remove('animate-fade-in');
      void element.offsetWidth; // reflow: reinicia la animación
      element.classList.add('animate-fade-in');
    } catch (error) {
      console.error('[UIAnimations] Error en el fade-in:', error);
    }
  }
};

if (typeof window !== 'undefined') {
  window.UIAnimations = UIAnimations;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = UIAnimations;
}
