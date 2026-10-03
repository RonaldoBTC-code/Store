# Base de datos y configuración del backend

Medusa v2 (`store/apps/backend`) usa PostgreSQL 15. Este documento es la operación prevista antes de producción: conexión, secretos, migraciones, copias, datos personales y las bases que acompañan a las pasarelas. No sustituye el criterio de un asesor.

## Entornos

Local, staging y producción usan **bases distintas y credenciales distintas**. No se comparte `DATABASE_URL` entre ellas.

| Entorno | Base | SSL | Secretos |
| --- | --- | --- | --- |
| Local | Postgres en la máquina de quien desarrolla | Apagado | Pueden ser de desarrollo. No se commitean. |
| CI | Base efímera del pipeline. Este repo no arranca el servidor en CI. | Si el job no es producción, apagado. Si `NODE_ENV` es producción, SSL con verificación: no hay excepción por `CI`. | Si el job arranca el servidor en producción, hacen falta secretos reales. `CI=true` no los salta. |
| Staging | Instancia propia, datos que no son los de clientes reales | Igual que producción: verificación de certificado | Distintos de los de producción |
| Producción | Instancia propia | Verificación de certificado | Generados para producción. Nunca los de plantilla |

Una laptop no apunta a la base de producción. Staging no se restaura encima de producción ni al revés. Cada entorno tiene su usuario de base con permiso solo sobre su base.

## Variables

Plantilla: `store/apps/backend/.env.template`. Copiar a `.env` (no se versiona) y completar. Ningún valor real va al repositorio.

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Conexión de Medusa a Postgres. Obligatoria para arrancar en producción. Los parámetros TLS de la query se quitan antes de pasarla al driver. |
| `DATABASE_SSL` | Apagado explícito: `false`, `0`, `off`, `no`, `disable`, `disabled`. `require` y cualquier otro valor verifican el certificado. Vacía: apagado fuera de producción; encendido con verificación si `NODE_ENV` es producción. `CI` no cambia el defecto. |
| `DATABASE_CA_CERT` | Opcional. PEM (saltos de línea como `\n`) o ruta a un PEM, cuando el proveedor trae un CA propio. Solo se usa si SSL está encendido. No va en la URL. |
| `JWT_SECRET` | Firma de JWT. En producción no puede faltar, medir menos de 32 caracteres, ser un valor de plantilla ni coincidir con `COOKIE_SECRET`. |
| `COOKIE_SECRET` | Firma de cookies. La misma regla, y un valor distinto del de `JWT_SECRET`. |
| `NODE_ENV` | Producción si, recortado y en minúsculas, es `production` o `prod`. Ahí se exige el chequeo de secretos al arrancar y el SSL por defecto. |
| `UNSAFE_SKIP_STARTUP_CHECKS` | Solo `true` omite el chequeo de secretos y escribe una advertencia. No apaga el SSL. No usarlo en producción. |

Generar cada secreto, uno distinto del otro y de al menos 32 caracteres:

```bash
openssl rand -base64 48
```

Quedan rechazados, sin distinguir mayúsculas: `supersecret`, `changeme`, `secret`, `password` y el valor vacío de `.env.template`. También se rechazan si los dos secretos son iguales o si alguno tiene menos de 32 caracteres. El mensaje nombra la variable y la regla. No imprime el valor ni `DATABASE_URL`.

En producción, Ramoide configura al menos: `NODE_ENV=production` (o `prod`), `DATABASE_URL` de la base de producción, `DATABASE_SSL=require` (o vacío, que en ese caso enciende la verificación; cualquier valor distinto de un apagado explícito también la enciende), `DATABASE_CA_CERT` si el CA no es uno de los que ya confía Node, y `JWT_SECRET` y `COOKIE_SECRET` recién generados. No definir `UNSAFE_SKIP_STARTUP_CHECKS`.

El código no usa `rejectUnauthorized: false`. Si SSL está apagado, la conexión va sin SSL. Si está encendido, el certificado se verifica. Con `DATABASE_SSL=false` en producción el proceso sigue y escribe una advertencia, también sin la URL.

`pg` 8.20.0 (el cliente que abre la conexión, vía Knex y MikroORM) y `pg` 8.23.0 mezclan la query de `DATABASE_URL` encima del objeto `ssl`. `pg-connection-string` 2.14.0, que es el que resuelve ese `pg` 8.20, interpreta `ssl`, `sslmode`, `sslcert`, `sslkey`, `sslrootcert`, `uselibpqcompat` y `sslnegotiation`. `ssl=0` deja el SSL en falso. `ssl=false` reemplaza el objeto por el string `"false"`. `sslmode=no-verify` deja `rejectUnauthorized: false`. `sslnegotiation=direct` fuerza SSL encendido. También se quita `sslpassword`: en estas versiones el parser no lo aplica al objeto, y no debe seguir en la URL. El resto de la cadena se conserva, incluidos usuario, contraseña y parámetros que no son TLS (`application_name`, por ejemplo). Si se quitó alguno, el proceso escribe una advertencia con los nombres. No escribe la URL, el usuario ni la contraseña.

El TLS queda solo en `DATABASE_SSL` y `DATABASE_CA_CERT`. Un `?sslmode=require` que traiga el proveedor se ignora. Si ese proveedor usa un CA propio, el PEM va en `DATABASE_CA_CERT`.

`PGSSLMODE` lo lee `pg` solo cuando `ssl` no viene en la config. Aquí `ssl` siempre está definido: `false`, o `{ rejectUnauthorized: true }` con el CA si hace falta. `PGSSLMODE=disable` no reemplaza ese objeto ni apaga la verificación. No se borra la variable del entorno.

## Arranque

Con `NODE_ENV` de producción (`production` o `prod`, da igual mayúsculas y espacios alrededor), el chequeo de secretos corre por defecto. Un comando desconocido, o una invocación sin argumentos, también lo ejecuta. `CI`, `GITHUB_ACTIONS` y el resto de variables de pipeline no lo saltan ni apagan el SSL por defecto.

La lista de excepciones es corta y explícita, tomada de la CLI de Medusa 2.21: `build`, `db:*` (`db:setup`, `db:create`, `db:migrate`, `db:migrate:scripts`, `db:migrate:search`, `db:rollback`, `db:generate`, `db:sync-links`), `exec`, `user` y `plugin:*` (`plugin:build`, `plugin:develop`, `plugin:publish`, `plugin:add`, `plugin:db:generate`). El subcomando es el primer argumento que no es una flag. `medusa exec start` no cuenta como `start`.

`UNSAFE_SKIP_STARTUP_CHECKS=true` es la única forma de omitir el chequeo de secretos en un comando que sí lo ejecuta. El SSL sigue el valor de `DATABASE_SSL` o el defecto de producción. Al arrancar se escribe una advertencia visible.

El build del backend tiene que poder completarse sin variables de producción. Migrar y sembrar tampoco exigen los secretos de arranque.

`register()` en `instrumentation.ts` repite el mismo chequeo cuando Medusa lo invoca.

## Migraciones

Desde `store/apps/backend`, con el `DATABASE_URL` de **ese** entorno:

```bash
pnpm exec medusa db:migrate
```

Antes, confirmar el host de la URL (local, staging o producción). No hace falta `JWT_SECRET` de producción para migrar: el chequeo de secretos no corre en este comando. Sí hace falta red y credencial válidas hacia esa base.

En producción, la migración corre como parte del despliegue, contra la base de producción, no desde una laptop.

## Seeds

Los seeds cargan datos de tienda. No forman parte de este cambio y no hay que duplicar los scripts de otro PR.

Cuando existan:

- Correrlos solo contra la base del entorno en el que se está.
- No poner cadenas de conexión ni contraseñas dentro del script.
- No ejecutarlos contra producción salvo una decisión explícita de quien opera. Un seed pensado para una base vacía puede pisar catálogo o regiones si se apunta al sitio equivocado.
- `medusa exec` no dispara el chequeo de secretos de arranque. Eso no autoriza a sembrar producción por accidente.

El usuario administrador no sale de un seed con contraseña de ejemplo. Se crea con correo y contraseña propios:

```bash
pnpm exec medusa user -e <tu-email> -p <tu-contraseña>
```

Esa contraseña no se escribe en el README, en este documento ni en el repositorio.

## Copias de seguridad

Hay dos caminos. Se elige uno por base y se anota cuál quedó en el proveedor. Las cifras de retención comercial que no salgan del contrato o de la ley se confirman con asesor; aquí no se inventa un número de años.

### Proveedor gestionado (preferido en producción)

Activar PITR (recuperación a un punto en el tiempo) en la instancia gestionada. Anotar la ventana de retención que da el plan contratado y quién puede restaurar. Las credenciales del proveedor no van al repo.

### Si no hay PITR: `pg_dump` diario cifrado

Un job fuera del contenedor de la app, con un usuario de solo lectura si el proveedor lo permite:

1. `pg_dump` en formato custom (`-Fc`) de esa base, a un directorio que no es el del código.
2. Cifrar el archivo antes de sacarlo del servidor (por ejemplo `age` o `gpg`). La clave de cifrado vive en un gestor de secretos, no al lado del dump ni en git.
3. Copiar el cifrado a otro sitio (otro proyecto del proveedor, otro disco, otro responsable). Borrar el dump en claro.
4. Retención: conservar varias copias diarias y al menos una más antigua. El número exacto de días se confirma con asesor y con el contrato del proveedor. No se deja un único archivo.
5. Probar que el archivo cifrado se puede descifrar. Un dump que no abre no es un backup.

No versionar `*.dump` ni el directorio `backups/`. Los `.sql` de migración del código sí se versionan; un volcado de datos no.

La base de BTCPay es otra instancia. Entra en este mismo plan, por separado. El detalle está en [Pasarelas de pago](#pasarelas-de-pago).

## Prueba de restauración

Una copia que no se ha restaurado no cuenta. Con una cadencia fija (la fecha la acuerda quien opera; no se inventa aquí un plazo legal) se hace lo siguiente en un Postgres **nuevo**, nunca encima de producción:

1. Elegir un backup cifrado o un punto PITR anterior.
2. Descifrárlo si aplica y restaurarlo (`pg_restore` para un dump `-Fc`, o la herramienta del proveedor para PITR) en una instancia vacía.
3. Comprobar que la app arranca contra esa instancia con secretos de prueba, que hay tablas de Medusa y que un pedido o cliente de prueba conocido sigue ahí.
4. Repetir el ejercicio para la base de BTCPay: facturas y pagos de prueba visibles, en su propia instancia.
5. Anotar fecha, backup usado y resultado. Borrar la instancia de prueba y sus credenciales al terminar.
6. Si el descifrado o el restore fallan, eso es un incidente de la copia, no un éxito parcial.

La semilla Lightning y el static channel backup no salen de este restore de Postgres. Se prueban aparte, como dice la sección de pasarelas.

## Datos personales (LOPDP, Ecuador)

La Ley Orgánica de Protección de Datos Personales se publicó en el Registro Oficial, Quinto Suplemento, No. 459, de 26 de mayo de 2021. Lo que sigue es operación técnica alineada con principios que están en esa ley. El plazo concreto de conservación, la base legal de cada tratamiento y si hace falta un registro o un delegado **se confirman con asesor**. Este texto no fija años ni multas.

La cédula o el RUC del cliente se guarda en la metadata de la dirección de facturación. Es dato personal. También lo son nombre, correo, teléfono, dirección y el historial de pedidos. No hace falta copiar la cédula a otro sitio "por si acaso".

### Minimización

El artículo 10, letra e), pide datos pertinentes y limitados a lo estrictamente necesario para la finalidad. Para facturar y entregar en Ecuador se pide la cédula o el RUC en esa metadata de facturación, no en logs, no en analytics y no en un segundo almacén. No se agregan copias en el storefront más allá de lo que el checkout necesita enviar al backend.

Si un campo no hace falta para cobrar, entregar o cumplir una obligación que el asesor confirme, no se pide.

### Quién accede

Accede quien opera el pedido, la factura o el soporte de esa cuenta, con usuario propio en el admin y, si hace falta SQL, con un usuario de base distinto del de la aplicación. No hay una clave compartida en el chat. Producción no se consulta desde cuentas de desarrollo. Un acceso de soporte se limita a lo pedido y no se exporta la tabla entera "para revisarla".

El artículo 10, letra g), trata la confidencialidad: el dato no se usa para un fin distinto del que se recogió, salvo una causa prevista en la ley. Confirmar con asesor qué accesos de marketing o de proveedores entran en esa causa.

### Logs

Los logs de aplicación, de proxy y de Postgres no deben incluir la cédula, el RUC ni la metadata completa de la dirección. Un error de checkout registra un id de pedido o de carrito, no el documento. Lo mismo para trazas y para el mensaje con el que el proceso se niega a arrancar: ahí no va `DATABASE_URL` ni un secreto.

Si un log ya los capturó, se rota y se deja de hacerlo. No se pegan logs con datos de clientes en issues ni en pull requests.

### Conservación y borrado

El artículo 10, letra i), dice que los datos se conservan el tiempo necesario para la finalidad y que el responsable fija plazos de supresión o de revisión. La ley no deja en este repo un número de años para pedidos o para la cédula. **Confirmar con asesor** el plazo de la tienda y si una norma tributaria obliga a guardar la factura más tiempo que el dato de marketing. Hasta esa confirmación no se borra a ciegas la contabilidad ni se conserva "para siempre" el documento de identidad.

El artículo 15 reconoce el derecho de eliminación cuando se cumple alguna de sus causales (entre otras: el dato ya cumplió la finalidad, venció el plazo de conservación o el titular revoca el consentimiento). El mismo artículo da al responsable **quince días** desde la solicitud para suprimir el dato, de forma gratuita. Confirmar con asesor si una solicitud concreta choca con un deber de conservar la factura; en ese caso se elimina o se bloquea lo que ya no hace falta (por ejemplo la cédula en metadata) y se documenta qué se retuvo y por qué.

Borrado operativo, cuando el asesor confirme que toca:

- Borrar o anonimizar la metadata de cédula/RUC en la dirección de facturación y el resto de datos del cliente que ya no tengan finalidad.
- Incluir las copias: el siguiente backup ya no debe ser la única forma de seguir tratándolos. Las copias viejas se caen solas al vencer su retención; no se restaura un backup viejo encima de producción para "recuperar" un cliente que pidió borrado.
- El borrado en la base de Medusa no borra la base de BTCPay ni los registros que PayPhone guarde como proveedor. Esos tratamientos se atienden con el mismo criterio, cada uno en su sistema. Confirmar con asesor el alcance frente a encargados.

## Pasarelas de pago

Esta sección no implementa cobros. Describe cómo se operan los datos cuando la tienda cobre.

La tienda cobrará con:

- **PayPhone**
- **BTCPay Server autoalojado**, para Bitcoin en cadena y para Lightning

### Bases separadas

BTCPay tiene su **propia** base Postgres, distinta de la de Medusa. Otro host o al menos otra base, otro usuario y otra `DATABASE_URL`. No se reutiliza la base de Medusa ni sus credenciales.

Esa base entra en el plan de backups y en la prueba de restauración:

- Si el Postgres de BTCPay es gestionado, PITR propio, con su ventana y sus credenciales.
- Si no, `pg_dump` diario cifrado, la misma disciplina que la de Medusa (cifrado, copia fuera del servidor, retención, clave fuera del repo).
- La prueba periódica restaura la base de BTCPay en una instancia vacía y comprueba facturas y pagos de prueba. Restaurar solo Medusa no recupera BTCPay, y al revés tampoco.

PayPhone es un proveedor externo: la tienda no administra su base. Sí hay que poder cruzar un cobro local con el id que devuelve PayPhone. Esos registros locales viven en la base de Medusa y viajan con su backup.

### Lightning: semilla y static channel backup

El nodo Lightning (el que usa BTCPay) guarda fondos de canales fuera de un simple dump SQL. Hay dos materiales que no están reemplazados por el backup de Postgres:

- la **semilla** del nodo
- el **static channel backup (SCB)**, que cambia cuando cambian los canales

Cada vez que cambien, se copian **cifrados** a un almacén fuera de ese servidor. No van al repositorio, ni a una imagen de contenedor, ni a un ticket, ni a los logs. Perderlos implica perder los fondos de los canales. El `pg_dump` de BTCPay no alcanza para recuperarlos.

La prueba de ese backup es aparte de la de Postgres: comprobar que el archivo cifrado abre y que el SCB corresponde al nodo actual. El procedimiento fino de restaurar canales depende de la versión de BTCPay y del nodo; se sigue la documentación de ese software y de quien opera el nodo, no un atajo inventado aquí. **Confirmar con asesor** y con quien opere el nodo antes de ensayar una restauración que mueva fondos.

### Idempotencia de transacciones

Los registros de transacciones de pago tienen que ser **únicos por (proveedor, id externo)**.

- Proveedor: por ejemplo `payphone` o `btcpay`.
- Id externo: el identificador que manda la pasarela (transacción de PayPhone, factura de BTCPay), no uno generado solo en la tienda.

Así un webhook repetido no inserta un segundo cobro. La unicidad es de la fila de la transacción, no del pedido: un pedido puede tener intentos, pero el mismo par proveedor + id externo aparece una sola vez. Esta restricción queda pendiente de la implementación de pagos; este cambio no crea la tabla.
