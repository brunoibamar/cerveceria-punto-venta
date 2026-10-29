# Caja compartida: primera etapa de integración

Proyecto: `cerveceria-toñito`, referencia `qhxsqyyytbxlnfxfhzcb`.
Entrada independiente: `/nube.html`. La entrada `/` continúa siendo el POS local.
El login local ofrece «Entrar como supervisor», que abre `/nube.html?mode=supervisor`
en otra ventana y no requiere el bloqueo de caja. Este modo muestra únicamente supervisión,
exige una membresía administradora y bloquea comandos en su interfaz; no crea un rol nuevo
ni reduce los permisos propios de la cuenta administradora en el servidor.
Incluye Inventario de consulta, Reportes por fecha e Historial paginado de 50 tickets.
Los agregados de reportes se calculan en PostgreSQL sobre todas las ventas del período,
sin limitarse a los 500 tickets del resumen. Incluyen piezas por producto y empleado,
formas de pago, costo histórico y utilidad bruta estimada sin cargos de envase.
La semilla Mega Corona se cargó una vez en el catálogo vacío de nube para esta simulación.
No se crearon ventas simuladas en el negocio: las pruebas SQL se revierten por completo.
Entrar usa contraseña, sin enviar enlaces; crear la cuenta requiere confirmar el correo una vez.
No existe sincronización automática entre ambos: no alternar entre ellos para una misma operación.

## Vinculación opcional de inventario (3.3)

En el POS local normal, Ajustes → Vincular inventario con nube autoriza una instalación como origen.
Después de iniciar sesión con una cuenta administradora remota, la primera publicación usa el catálogo local.
Los cambios posteriores de productos, stock y ciclos se envían automáticamente. No se ejecuta en modo demo.
El envío se limita a la sesión local de administrador: tras cerrar o recargar se autoriza nuevamente.
La sesión remota se mantiene solo en memoria y se cierra cuando deja de estar activo el administrador local.
No se implementó acceso persistente por token anónimo ni se guarda una sesión administradora en el POS.
El envío requiere conexión; una cola local persistente conserva reintentos con el mismo UUID.
Se comprueban las revisiones de todos los productos antes de modificar datos. Si otra caja cambia la nube,
se detiene el envío, sin sobrescribirla; el administrador debe revisar y decidir si vuelve a publicar.
No hay mezcla automática entre dos instalaciones locales. Una instalación ajena no puede asumir el vínculo.
La función transaccional queda en `inventory-sync.sql`; las pruebas de conflicto y reintento están en `verify.sql`.
Esta vinculación publica inventario y ciclos; no convierte ventas locales en ventas normalizadas de nube.
Los reportes de ventas siguen usando tickets de la caja compartida. El inventario actualizado sí se muestra al supervisor.

## Estado

Se crearon y aplicaron las tablas, políticas RLS, operaciones transaccionales y consulta en vivo.
La identidad administradora está preautorizada en una tabla privada del proyecto.
La primera persona administradora debe crear su acceso en `nube.html`, confirmar el correo y entrar.
No se guardó una contraseña predeterminada ni se enviaron correos desde herramientas administrativas.

La interfaz permite catálogo y stock compartidos, separación de stock frío, ventas por pieza/cartón,
cargos de frío/envase, verificación manual de pago electrónico, apertura/cierre de una caja principal,
resumen diario por cajero, últimas 500 ventas y supervisión mediante Realtime y consulta cada 15 segundos.
Tarjeta no pide referencia ni casilla de verificación: el servidor registra la declaración del cajero.
Las transferencias mantienen referencia y verificación manual. No hay validación bancaria automática.
Cada pestaña usa una sesión de Supabase y un espacio de autenticación independientes.
Cerrar sesión usa `scope: local`; no cierra turnos ni revoca las sesiones de otros dispositivos.
Un administrador puede supervisar sin abrir caja. Solo el responsable cierra su turno.
Los empleados se autorizan por correo y crean su propia contraseña; la identidad del cajero la fija el servidor.

No es todavía la migración completa de las pantallas locales: promociones avanzadas, ciclos de auditoría,
importación de respaldos, impresión, escáner y reportes históricos locales siguen en la versión local.
La copia local no se subió ni se sobreescribió. El NIP local no se convierte en una contraseña remota.
El producto de prueba se carga explícitamente y una sola vez desde Ajustes de nube sobre un catálogo vacío.

## Integridad

Las tablas no aceptan escritura directa de `authenticated` ni acceso de `anon`.
Las funciones públicas invocan operaciones privadas con validación de auth.uid y membresía activa.
Una venta se recalcula en el servidor y guarda conjuntamente ticket, partidas, stock y movimientos.
El negocio se bloquea durante la transacción: las operaciones concurrentes se serializan.
Una revisión evita que una edición de inventario sobreescriba una venta posterior.
Cada solicitud tiene UUID y payload persistido: reintentar una respuesta perdida no duplica operaciones.
Los importes son centavos enteros. Las notificaciones no sustituyen la lectura del estado central.
No se confirma operación sin conexión. Una solicitud ambigua permanece pendiente para reintento explícito.

## Fuentes SQL y pruebas

`schema.sql`, `commands.sql` y `snapshot.sql` son fuentes del esquema inicial, no archivos de migración CLI.
El historial de migraciones aplicado está en Supabase. No ejecutar estos scripts de creación otra vez sobre el mismo proyecto.
`verify.sql` crea identidades y datos temporales dentro de una transacción y termina con ROLLBACK.
Comprueba permisos, aislamiento, responsable real, venta por cartón, reintento idempotente,
stock/revisión desactualizados, reversión y cálculo del corte. No envía emails.

Antes de activar esta etapa como entrada principal hay que verificar el correo del propietario,
probar dos dispositivos con identidades reales y completar la migración de las funciones locales necesarias.
En Supabase Authentication → URL Configuration, establecer como Site URL la URL pública del proyecto
y agregar `/nube.html` a Redirect URLs para las confirmaciones de correo.
