/* Actualiza únicamente archivos de aplicación. No elimina almacenamiento de negocio. */
(async function update(){
  const status=document.getElementById('status');
  try{
    if(!('serviceWorker' in navigator)){location.replace('./'+location.search);return;}
    const registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
    await registration.update();
    const waiting=registration.waiting||registration.installing;
    if(!waiting){location.replace('./'+location.search);return;}
    const timeout=setTimeout(()=>{status.textContent='La actualización sigue pendiente. Revisa la conexión y vuelve a intentarlo.';document.getElementById('retry').hidden=false;},20000);
    navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timeout);location.replace('./'+location.search);},{once:true});
    const activate=()=>{if(waiting.state==='installed')waiting.postMessage({type:'ACTIVATE_UPDATE'});if(waiting.state==='activated'){clearTimeout(timeout);location.replace('./'+location.search);}};
    waiting.addEventListener('statechange',activate);activate();
  }catch(error){status.textContent='No se pudo actualizar: '+error.message;document.getElementById('retry').hidden=false;}
  document.getElementById('retry').onclick=()=>location.reload();
})();
