// Caché completa, acotada al proyecto y con actualizaciones coherentes por versión.
const CACHE_NAME = 'cerveceria-pos-v3.5.0';
const SYNC_ASSETS=['./manifest-production.json','./js/fridge.js','./js/cloud-maintenance.js','./entornos.html','./css/modules/cloud-link.css','./services/scanner-engine.js','./services/inventory-cloud.js','./services/terminal-events.js','./services/cloud-config.js','./vendor/supabase-2.118.0.min.js'];
// Activación solicitada desde la página de actualización; no recarga cajas abiertas.
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
const ASSETS = ['./','./index.html','./css/styles.css','./css/modules/security.css','./css/modules/ticket-frost.css','./css/modules/base.css','./css/modules/inventory.css','./css/modules/reports.css','./css/modules/settings.css','./css/modules/shell.css','./css/modules/login.css','./css/modules/pos.css','./css/modules/payment.css','./css/modules/settings-modal.css','./css/modules/cash-reports.css','./css/modules/mobile.css','./css/modules/qr-and-overrides.css','./js/app.js','./js/animations.js','./js/login.js','./js/sales.js','./js/pos.js','./js/pos-cash-cut.js','./js/pos-scanner.js','./js/inventory.js','./js/reports.js','./js/settings.js','./db/database.js','./services/runtime.js','./services/storage.js','./services/auth.js','./services/operations.js','./services/salesLog.js','./services/salesBreakdown.js','./services/emailService.js','./vendor/zxing-0.21.3.min.js','./vendor/emailjs-4.4.1.min.js','./vendor/chart-4.4.6.min.js','./assets/ticket-ice-realistic.png','./assets/ticket-cold-vapor.png','./manifest.json', ...[72,96,128,144,192,512].map(n=>'./assets/icon-'+n+'x'+n+'.png')];
self.addEventListener('install',event=>{ event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll([...ASSETS,...SYNC_ASSETS]))); });
self.addEventListener('activate',event=>{ event.waitUntil((async()=>{ for(const key of await caches.keys()) if(key.startsWith('cerveceria-pos-') && key!==CACHE_NAME) await caches.delete(key); await self.clients.claim(); })()); });
self.addEventListener('fetch',event=>{
  const request=event.request; const url=new URL(request.url);
  if(request.method!=='GET' || url.origin!==self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    const cached=await cache.match(request, {ignoreSearch:request.mode==='navigate'});
    if(cached) return cached;
    try { return await fetch(request); }
    catch { if(request.mode==='navigate') return await cache.match('./index.html'); return new Response('Recurso no disponible sin conexión',{status:503}); }
  })());
});
