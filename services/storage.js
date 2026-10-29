// Un solo documento por operación: setItem es atómico. Las claves antiguas quedan intactas.
const DataStore = {
  KEY: 'cerveceria_state_v2', RECOVERY: 'cerveceria_recovery_v2', draft: null,
  read() {
    const raw = AppStorage.getItem(this.KEY);
    if (!raw) return {};
    try { const data = JSON.parse(raw); if (!data || Array.isArray(data) || typeof data !== 'object') throw Error(); return data; }
    catch { throw new Error('Los datos guardados no se pueden leer. Usa Recuperar datos en el inicio; no borres el almacenamiento.'); }
  },
  getItem(key) {
    const data = this.draft || this.read();
    return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : AppStorage.getItem(key);
  },
  setItem(key, value) { return this.atomic(() => { this.draft[key] = value; }); },
  removeItem(key) { return this.setItem(key, null); },
  atomic(callback) {
    if (typeof WriteGuard !== 'undefined' && !WriteGuard.ready) throw new Error('Esta pestaña no tiene permiso de escritura.');
    if (this.draft) return callback();
    const before = this.read(); this.draft = { ...before };
    try {
      const result = callback();
      const next = JSON.stringify(this.draft);
      const previous = AppStorage.getItem(this.KEY);
      // Si falta espacio, se aborta antes de modificar el estado principal.
      if (previous) AppStorage.setItem(this.RECOVERY, previous);
      AppStorage.setItem(this.KEY, next);
      this.mirrorQueue = (this.mirrorQueue || Promise.resolve()).then(() => this.mirror(next));
      if(typeof window!=='undefined' && typeof CustomEvent!=='undefined') window.dispatchEvent(new CustomEvent('pos:data-saved'));
      return result;
    } finally { this.draft = null; }
  },
  async mirror(data) {
    if (typeof DemoMode !== 'undefined' && DemoMode) return;
    try {
      const db = await this.openRecovery();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readwrite');
        tx.objectStore('snapshots').put({ id: 'latest', data, savedAt: new Date().toISOString() });
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      }); db.close();
    } catch (error) { console.warn('No se pudo actualizar la copia de recuperación:', error); }
  },
  openRecovery() {
    return new Promise((resolve,reject) => {
      const request = indexedDB.open('cerveceria-recovery', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('snapshots', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  },
  async recover() {
    let raw = AppStorage.getItem(this.RECOVERY);
    if (!raw) {
      const db = await this.openRecovery();
      raw = await new Promise((resolve,reject) => { const r = db.transaction('snapshots').objectStore('snapshots').get('latest'); r.onsuccess = () => resolve(r.result && r.result.data); r.onerror = () => reject(r.error); });
      db.close();
    }
    if (!raw) throw new Error('No existe una copia local. Restaura un respaldo JSON.');
    JSON.parse(raw); AppStorage.setItem(this.KEY, raw);
  }
};
