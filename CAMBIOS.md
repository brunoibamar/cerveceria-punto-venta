# Cambios para las pruebas en Android

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
