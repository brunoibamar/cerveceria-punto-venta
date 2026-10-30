# Cambios para las pruebas en Android

## Versión 3.4: venta local y supervisor unidos

- Ajustes → Vincular ventas e inventario autoriza la terminal una vez con una sesión técnica de Supabase Auth.
  Esa identidad no es administradora ni lectora del negocio; solo puede entregar datos de su instalación.
  La sesión humana del administrador se cierra al terminar el alta. No se guardan su contraseña ni su sesión.
- Las ventas locales guardan el envío pendiente dentro de la misma operación que el ticket y el stock.
  Se envían con administrador o empleado, después del corte y al volver a abrir el POS, sin publicar cada venta.
- Los envíos incluyen cantidades en piezas, precios y costos históricos, forma de pago, responsable y turnos.
  El saldo enviado ya contiene el descuento local: el servidor no descuenta otra vez las piezas.
- El alta recupera tickets del historial y de cortes anteriores del dispositivo. Los UUID y las claves de origen
  evitan duplicados, incluso si una respuesta se pierde o se repite el alta de la misma instalación.
- El supervisor integra los tickets de terminal con los de caja compartida en reportes e historial y muestra
  cuándo llegó el último envío. El administrador puede revocar la terminal desde Ajustes de nube.
- Sin internet no existe actualización en vivo: los datos quedan pendientes en el dispositivo y se reintentan.
  Si otra caja modifica el inventario de nube, el envío se detiene para revisar el conflicto.
- `actualizar.html` instala la versión actual sin borrar inventario, ventas ni accesos locales.

Las notas de versiones anteriores siguientes describen etapas previas de la integración.

## Versión 3.3: presentación, inventario vinculado y cámara

- Panel remoto con tarjetas, acentos ámbar, tablas y jerarquía visual adaptada a Android.
- Ajustes → Vincular inventario con nube permite autorizar un dispositivo como origen del catálogo.
  La primera publicación requiere iniciar sesión como administrador de nube y aceptar publicar el catálogo local.
  Las modificaciones posteriores de productos, existencias y ciclos se envían automáticamente con internet.
  El envío opera durante la sesión local de administrador y requiere autorizar de nuevo tras cerrar o recargar.
  No se conserva una sesión administradora de nube ni se habilita escritura sin autenticación.
  Una cola persistente conserva envíos pendientes. Los conflictos con cambios remotos se detienen para revisión.
- La vinculación no se permite en `?demo=1`. No transfiere contraseñas locales ni tickets de ventas locales.
  Si no se ha vinculado el teléfono, el supervisor conserva el inventario previo de nube.
- El lector reutiliza un único stream y prueba luminancia normal e invertida con enfoque continuo cuando se admite.
  Mantiene el flash de Inventario y avisa si varios productos comparten el mismo código de barras.
- Pruebas sintéticas verifican EAN-13 normal/invertido y reintentos del espejo; es necesaria prueba física en Android.
  Validación de esta versión: 66 pruebas locales aprobadas y comprobación SQL de conflictos/reintentos con reversión.

## Accesos y operación local

- Administrador con NIP táctil y empleados con nombre y contraseña.
- Gestión de accesos desde Ajustes y responsable registrado en las ventas.
- Mega Corona como único producto inicial de pruebas, sin sobrescribir cambios posteriores.
- Inventario esperado en la captura del conteo: inicial + surtidos − estimado de ventas.
- Hielo y vapor por partida marcada como Frío, sin afectar otras partidas ni el ticket completo.
- Tarjeta y pagos mixtos con tarjeta sin referencia obligatoria ni ventana adicional de verificación.
  Las transferencias mantienen la verificación manual. No hay validación bancaria automática.

## Caja compartida y Supabase

- Entrada `nube.html`, con autenticación directa mediante Supabase Auth.
- Acceso «Entrar como supervisor» desde el login y desde el aviso de caja abierta en otra pestaña.
- Alta con confirmación inicial de correo, entrada posterior con contraseña y recuperación de contraseña.
- Sesiones independientes; cerrar sesión en un dispositivo no cierra el turno de caja.
- Catálogo, stock y turnos guardados en PostgreSQL. Mega Corona cargada una vez para esta prueba.
- Ventas transaccionales: ticket, partidas, inventario y movimientos se guardan conjuntamente.
- Reintentos con identificador único para evitar ventas duplicadas.
- Permisos por negocio y validaciones en el servidor; solo se publica la clave pública del proyecto.
- Actualizaciones en vivo con Realtime y consulta periódica de respaldo.

## Supervisor

- Inventario de consulta con cartones/piezas, existencias frías y aviso de stock bajo.
- Historial con productos, cantidades, temperatura, cajero y desglose de pago; 50 tickets por página.
- Reportes por fecha, piezas vendidas por producto, ventas por empleado y productos por empleado.
- Ventas, formas de pago, costos históricos y utilidad bruta estimada sin cargos de envase.
- Los agregados abarcan todo el período, sin limitarse a los tickets del resumen.
- El modo supervisor muestra consultas; la cuenta administradora conserva sus permisos en el servidor.

## Alcance actual

La entrada principal sigue siendo el POS local. Sus ventas, inventario e historial no se transfieren
automáticamente a la nube. La integración compartida es una entrada de pruebas separada.
Promociones avanzadas, ciclos de auditoría, importación de respaldos, impresión y escáner locales
todavía no están migrados a la interfaz de nube. No alternar ambas cajas para una misma operación.

La nube requiere internet para confirmar operaciones. Guardar datos allí no sustituye una política
de respaldos: se debe conservar el respaldo local mientras se completa la migración.

## Comprobación en Android

1. Abrir la versión publicada y comprobar el acceso «Entrar como supervisor».
2. Entrar al supervisor con una cuenta ya confirmada y comprobar Inventario, Reportes e Historial.
3. En la caja compartida (`nube.html`, sin `mode=supervisor`), abrir turno y registrar una venta.
4. Comprobar desde otro dispositivo que disminuyó el stock y aparecen piezas y cajero en el reporte.
5. Probar tarjeta sin texto obligatorio y comprobar que el ticket aparece una sola vez.
6. Revisar los controles y tablas en orientación vertical y horizontal.

En `?demo=1`, las pruebas son solo memoria y se reinician al recargar; no actualizan Supabase.

## Validación realizada

63 pruebas locales aprobadas. Las pruebas SQL con reversión verificaron permisos, aislamiento por
negocio, precios por cartón, responsable, reintentos, existencias, revisiones, cortes y reportes paginados.
La comprobación física de Android y de dos dispositivos con cuentas reales queda a cargo de la prueba operativa.
# Corrección de activación de terminal

- Corregida la credencial interna aleatoria de la terminal: ahora usa 69 bytes, dentro del límite de 72 de Supabase Auth. Antes la creación era rechazada y ninguna venta llegaba a la nube, aunque el administrador ingresara correctamente.
- No cambia la contraseña del administrador ni borra ventas o inventario. Reintentar la vinculación desde Ajustes activa el envío pendiente.
- Prueba de regresión comprueba longitud, formato y generación independiente de 100 credenciales.

