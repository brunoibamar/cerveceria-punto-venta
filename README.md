# Cervecería POS · versión 3.2

## Integración de nube en pruebas

La entrada `nube.html` conecta con Supabase para inventario compartido, turnos,
ventas y supervisión. Consulta [supabase/README.md](supabase/README.md) para el alcance y la configuración.
La entrada principal conserva su operación local. Desde Ajustes → Vincular ventas e inventario puedes
autorizar el envío automático de tickets, turnos y stock con cualquier cajero. El alta recupera también
los tickets guardados en los cortes de esa instalación. La nube requiere conexión para actualizarse;
sin conexión la terminal conserva una cola pendiente. No mezcles cajas independientes sobre el mismo inventario.

## Abrir

Ejecuta `iniciar.ps1` en PowerShell y abre http://localhost:4173. También puedes usar Node.js 20 o posterior: `npm start`.
No abras index.html con doble clic: los NIP protegidos, el bloqueo entre pestañas y el uso sin conexión necesitan localhost o HTTPS.

La vista de prueba está en http://localhost:4173/?demo=1. Inicia con un único producto, Mega Corona, y el NIP inicial del administrador. Usa memoria y se reinicia al recargar o al pulsar Reiniciar; no la uses para inventario real. No envía correos ni procesa cobros reales. No comparte datos con la operación normal.

En una instalación sin cuentas se crea Administrador con NIP inicial 1234. Solo se asigna una vez: no funciona como clave maestra ni sustituye un NIP que ya haya sido cambiado. Las cuentas existentes mantienen sus accesos. Cámbialo en Ajustes → Gestión de Contraseñas.

El administrador entra únicamente con su NIP en el teclado numérico táctil de la pantalla, sin escribir nombre de usuario. Se admiten los NIP de cuatro a ocho dígitos que ya estuvieran configurados. Si hay varias cuentas administradoras deben tener NIP distintos.

Los empleados escriben nombre y contraseña. El administrador crea, desactiva y restablece sus accesos desde Gestión de Contraseñas. Las contraseñas nuevas tienen de ocho a 128 caracteres y se guardan como hashes; no se muestran en texto. Los empleados de versiones anteriores conservan su clave anterior como contraseña hasta que el administrador la actualice. Una cuenta administradora antigua que todavía use contraseña puede migrarse desde la opción Recuperar cuenta anterior del teclado, conservando todos sus datos.

El nombre, identificador y rol de la sesión autenticada se guardan en cada venta. El historial muestra «Atendió» y el detalle de reportes muestra «Responsable». El administrador dispone además de un resumen por responsable para el periodo seleccionado, incluyendo turnos abiertos y cerrados y excluyendo cancelaciones. Los registros antiguos sin responsable se indican como «Sin responsable registrado», sin atribuirlos a otra persona.

Una dirección distinta (localhost frente a 127.0.0.1, otro puerto o dominio) tiene almacenamiento independiente.

## Qué cambió

- Credenciales locales con PBKDF2 SHA-256, sal aleatoria y 210000 iteraciones. Se validan NIP y rol administrador, o nombre, contraseña y rol empleado; cinco errores consecutivos pausan los intentos un minuto en la pestaña actual. El administrador usa un teclado táctil propio, sin campos de texto. La consulta del NIP del administrador se limita al administrador autenticado y usa una copia cifrada con AES-GCM y una clave aleatoria local.
- Empleados: ventas y reportes. Administradores: además inventario, surtidos, ajustes, respaldo y usuarios. Pueden desactivar cuentas ajenas.
- Apertura y sesión, venta e inventario, corte y archivo de ventas, y restauración se guardan conjuntamente. Si falla el guardado, no se confirma una operación parcial.
- El stock se comprueba al confirmar la venta y suma líneas frías y naturales del mismo producto. Los carritos de ventas confirmadas se eliminan en la misma operación.
- El hielo y el vapor se aplican individualmente a cada partida marcada como Frío, incluso si el cargo por frío está en cero. El contenedor general del ticket, los encabezados, los totales y las partidas al tiempo permanecen sin efectos. El estado se actualiza al editar cada partida y respeta la reducción de movimiento del dispositivo.
- Las tarjetas de Surtidos y el formulario de conteo muestran **Inventario esperado**: inventario inicial + surtidos − estimado de ventas del ciclo, expresado en paquetes y piezas. Es una guía de consulta: no rellena el conteo físico ni altera el cierre o los resultados de auditoría. Los saldos negativos permanecen visibles para revisión. Reutiliza el rango de fechas del estimado existente; si se abre el ciclo a mitad de un día, ese estimado puede incluir ventas anteriores a su apertura dentro de la misma fecha.
- Una sola pestaña puede operar por dirección y perfil de navegador. Otras pestañas muestran un bloqueo recuperable al cerrar la primera. Esto no sincroniza dispositivos ni otros perfiles.
- Tarjeta: finalizar el cobro registra la declaración del cajero sin referencia obligatoria ni ventana adicional, incluidos pagos mixtos con efectivo. No representa verificación bancaria automática. Transferencias: se conserva la referencia y verificación manual. Se registran intentos pendientes, cancelados y confirmados; el mismo intento no puede confirmar dos ventas.
- El QR requiere el enlace del negocio. No existe un enlace de cobro predeterminado. Generar un QR no confirma la recepción de dinero.
- Los descuentos reflejan ahorro real. Las ventas guardan su costo histórico para reportar costo de lo vendido y utilidad bruta estimada. No se vuelve a restar un descuento ya incluido en el total. Los cargos por envases se excluyen de la utilidad; los gastos operativos todavía no están modelados. Si faltan costos históricos se indica, sin asumir ganancia cero.
- Un turno de un día anterior bloquea nuevas ventas y solicita revisar su corte, tanto al recuperar la ventana como al iniciar. No se inventa un conteo físico ni se cierra caja silenciosamente. Se eliminó el aviso de cierre automático que no funcionaba.
- Exportar, imprimir o enviar un resumen no cierra ni registra anticipadamente el corte. Confirmar el corte sí lo guarda y termina la sesión.
- En el primer inicio se carga únicamente Mega Corona: Corona, 1L, código 100211; venta por pieza $50, costo $26, envase por pieza $10; cartón de 12, costo $320, venta $470, envase por cartón $10; stock 149 cartones + 11 piezas (1799 piezas) y mínimo 5. No se crean ventas, cortes ni ciclos de prueba. La inicialización se marca una sola vez: no sobrescribe cambios, no repone un producto eliminado y no modifica instalaciones existentes. Solo el catálogo de ejemplos antiguo íntegro e intacto sin historial puede reemplazarse conservadoramente por esta semilla. Si hay modificaciones, historial o productos mezclados se conserva todo. Reiniciar está disponible únicamente en la vista de pruebas en memoria; no borra datos de la operación real.
- Los estilos se dividieron por sección manteniendo la cascada original. Historial, cortes y escáner están separados del módulo principal de ventas.

## Respaldo y recuperación

En Ajustes → Respaldo descarga el JSON al terminar la jornada y conserva una copia fuera del equipo. El formato v2 contiene productos, ventas, cortes, promociones, ajustes, ciclos y surtidos, enlace de cobro, conteo global de nevera, intentos de pago y usuarios con hashes de sus credenciales, copias cifradas de los NIP de administrador y su clave local de recuperación. No contiene NIP en texto ni una sesión activa. La clave incluida permite al administrador volver a consultar los NIP tras restaurar: trata el archivo como privado.

La restauración valida el archivo antes de cambiar datos y conserva una copia anterior descargable en Ajustes → Recuperación. Acepta respaldos v1 completos; estos no contienen ciclos, por lo que se limpia ese historial en lugar de mezclarlo con el del equipo actual. Después de restaurar hay que iniciar sesión de nuevo. Los usuarios v2 se restauran con los NIP o credenciales que tenían al exportar; v1 conserva las cuentas locales. Las cuentas administradoras de respaldos antiguos sin NIP se migran después de validar su contraseña anterior; las de empleados conservan su clave como contraseña.

El estado principal sigue siendo un documento localStorage escrito de una vez. Se conserva la versión anterior y se actualiza en segundo plano una copia adicional en IndexedDB. Si el estado principal no puede leerse, el inicio ofrece recuperar la copia local. La copia de IndexedDB puede estar ligeramente atrasada. El límite de almacenamiento del navegador continúa aplicando: si falta espacio, se rechaza el guardado y se informa.

Las copias en el mismo navegador no sobreviven necesariamente a borrar todos sus datos, desinstalar el navegador o perder el equipo. No sustituyen el JSON externo.

## Uso sin conexión y actualizaciones

Escáner ZXing 0.21.3, Chart.js 4.4.6 y EmailJS 4.4.1 están incluidos en vendor. El service worker guarda el conjunto de archivos de una versión. Para preparar el modo sin conexión abre primero la aplicación con el servidor disponible. Una actualización se activa al cerrar todas las pestañas de la versión anterior y volver a abrir. Las ventas, inventario, QR configurado y gráficas son locales. Correo, Mercado Pago y operaciones bancarias requieren conexión. La cámara requiere permiso del usuario y hardware compatible; no se activó en las pruebas.

## Configuración externa pendiente

Esta versión es local. La autorización se aplica en la aplicación y no constituye una barrera ante alguien que controle el equipo o modifique los datos del navegador. Para autorización resistente a manipulación, varias cajas/dispositivos, copias remotas y confirmación automática de Mercado Pago se necesita un servidor, base central y credenciales del negocio. No se añadió un servidor de pagos ni se desplegó un servicio externo.

EmailJS conserva la configuración existente en services/emailService.js. No se enviaron correos de prueba. Su plantilla debe mostrar el campo nota_ganancias y usar el texto «Utilidad bruta estimada» para el antiguo campo ganancias_libres; editar una plantilla remota requiere acceso a esa cuenta.

serve.cjs es únicamente un servidor estático local de vista previa, accesible en este equipo. No es una base central ni un servidor de producción.

## Verificación

Ejecuta `npm test` o `node --test tests/core.test.cjs tests/inventory-expected.test.cjs`. Las pruebas usan almacenamiento simulado, sin tocar datos reales. Cubren autenticación, permisos, stock combinado, costos históricos, importación v1/v2, fallos de escritura, recuperación, corte, pagos e inventario esperado. Las pruebas que simulan fallos muestran mensajes esperados en consola.

La cámara física, impresora, confirmación bancaria y entrega real de correo requieren comprobación en el equipo y servicios del negocio.
# Espacios de operación (3.5.0)

Abrir `entornos.html` para elegir **Pruebas** o **Negocio real**. El enlace habitual conserva las pruebas existentes; el negocio real se abre con `?env=production` y comienza vacío. Sus administradores deben configurar NIP, empleados y catálogo y autorizar la terminal una sola vez desde sus propios Ajustes. Instalar la aplicación desde ese enlace conserva el destino real.

El empleado opera Ventas y Refri. Las promociones configuradas se cobran automáticamente y no son editables. El refrigerador es un indicador general de llenado; reponerlo no aumenta inventario.

En Ajustes → Historial antiguo en nube, un administrador puede revisar y respaldar el año completo más antiguo y eliminarlo mediante confirmación escrita. El respaldo anual es un archivo de archivo histórico, no un respaldo completo de configuración para restaurar con el importador local. No se borra nada automáticamente.
