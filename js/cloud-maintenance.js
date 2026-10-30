const CloudMaintenance = {
  mount(host) {
    if(!Cloud.admin)return;
    const panel=document.createElement('section');
    panel.innerHTML='<h2>Historial antiguo en nube</h2><p>Solo permite limpiar el año completo más antiguo. Conserva catálogo, existencias, accesos y turnos actuales. Descarga y guarda el respaldo antes de continuar.</p><button id="history-preview">Revisar año más antiguo</button><div id="history-archive"></div><p role="status" id="history-status"></p>';
    host.append(panel);
    panel.querySelector('#history-preview').onclick=async()=>{
      const status=panel.querySelector('#history-status'),target=panel.querySelector('#history-archive');target.replaceChildren();
      try{
        status.textContent='Consultando…';
        const {data,error}=await Cloud.client.rpc('pos_history_archive',{p_business:CloudConfig.businessId});if(error)throw error;
        if(!data.year){status.textContent=data.message;return;}
        const total=data.data.sales.length+data.data.terminal_sales.length;
        status.textContent='Año '+data.year+' · '+total+' ventas · '+(data.data.shifts.length+data.data.terminal_shifts.length)+' cortes/turnos.';
        const download=document.createElement('button');download.textContent='Descargar respaldo de '+data.year;
        const input=document.createElement('input');input.placeholder='Escribe ELIMINAR '+data.year;input.setAttribute('aria-label','Confirmación del año a eliminar');
        const erase=document.createElement('button');erase.textContent='Eliminar ese historial de la nube';erase.className='secondary';erase.disabled=true;
        let downloaded=false;
        download.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({business_id:CloudConfig.businessId,exported_at:new Date().toISOString(),...data},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='historial-'+CloudConfig.environment+'-'+data.year+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);downloaded=true;erase.disabled=input.value!=='ELIMINAR '+data.year;};
        input.oninput=()=>erase.disabled=!downloaded||input.value!=='ELIMINAR '+data.year;
        erase.onclick=async()=>{
          if(!downloaded||!confirm('¿Guardaste el respaldo? Se eliminará de la nube el historial de '+data.year+'. Esta acción no se deshace desde la aplicación.'))return;
          erase.disabled=true;
          try{const result=await Cloud.client.rpc('pos_prune_history',{p_business:CloudConfig.businessId,p_year:data.year,p_fingerprint:data.fingerprint,p_confirmation:input.value});if(result.error)throw result.error;target.replaceChildren();status.textContent='Historial de '+data.year+' eliminado. El inventario actual se conservó.';await Cloud.refresh();}catch(e){status.textContent=e.message;erase.disabled=false;}
        };
        target.append(download,input,erase);
      }catch(e){status.textContent=e.message;}
    };
  }
};
