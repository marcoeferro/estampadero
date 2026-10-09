# Facturación electrónica (ARCA mediante Facturante)

Cada pedido con el pago aprobado genera su comprobante. Si se registra un
reintegro, se emite la nota de crédito por el importe reintegrado.

## Cómo funciona

1. **Pago aprobado.** Cuando se aprueba el pago (`runOrderPaidEffects`), se
   crea la factura del pedido y se envía al proveedor. Esto pasa fuera de la
   respuesta del pago: si Facturante o ARCA no responden, el pedido sigue su
   curso y la factura queda **Pendiente**.
2. **Una sola factura por pedido.** La clave `order:<id>:invoice` es única en
   la base y además se envía al proveedor como clave de idempotencia.
3. **Reintentos.** Ante un error temporal se reintenta a los 1, 5, 15 y 30
   minutos, y después a las 1, 2, 4, 8, 12 y 24 horas. Agotados los
   reintentos queda **Con error** y se puede reintentar desde el panel.
4. **Autorización diferida.** Si ARCA autoriza más tarde, el comprobante queda
   **Esperando ARCA**. Facturante avisa a `/api/webhooks/facturante?token=...`
   y la tarea de conciliación (`/api/cron/reconcile-payments`) también lo
   consulta como respaldo.
5. **Notas de crédito.** La tarea de conciliación y la aprobación de una
   devolución comparan lo reintegrado con lo ya acreditado y emiten la
   diferencia, total o parcial. También cubre los reintegros informados por
   el medio de pago.
6. **Correo.** Con la factura emitida, el comprador recibe un correo con el
   enlace al pedido, desde donde la descarga.

## Tipo de comprobante

| Emisor (`INVOICING_ISSUER_TAX_CONDITION`) | Comprador | Comprobante |
| --- | --- | --- |
| MONOTRIBUTO | cualquiera | Factura C / Nota de crédito C |
| RESPONSABLE_INSCRIPTO | Responsable inscripto o monotributista (con CUIT) | Factura A |
| RESPONSABLE_INSCRIPTO | Consumidor final o exento | Factura B |

En el checkout el documento es obligatorio y la opción **Necesito factura A**
pide CUIT (con dígito verificador), razón social y condición frente al IVA.

## Productos de clubes

`INVOICING_CLUB_ITEMS_MODE` define qué importe factura el taller en los
pedidos con productos de clubes. Lo decide el contador:

- `TOTAL`: el taller factura el total del pedido.
- `STORE_SHARE`: de cada producto de club se factura solo la parte del taller,
  según el porcentaje del convenio guardado en el pedido.

## Puesta en marcha

1. Activar la cuenta en Facturante y pedir las credenciales del entorno de
   pruebas (usuario, hash y código de empresa).
2. **Pendiente:** completar `infrastructure/providers/facturante-provider.ts`
   con el armado del mensaje SOAP a partir del WSDL de
   `https://testing.facturante.com/api/comprobantes.svc?wsdl`. Desde este
   entorno de desarrollo no se pudo acceder al sitio de Facturante, así que el
   adaptador deja los comprobantes pendientes (con reintentos) hasta que se
   complete.
3. Cargar en Railway `INVOICING_PROVIDER=facturante`, las variables
   `FACTURANTE_*`, el punto de venta y la condición del emisor.
4. Configurar en Facturante el aviso a
   `https://<dominio>/api/webhooks/facturante?token=<FACTURANTE_WEBHOOK_SECRET>`.
5. Probar con `FACTURANTE_ENVIRONMENT=testing` y pasar a `production`.

Para probar todo el circuito sin Facturante usar `INVOICING_PROVIDER=simulated`.
Emite comprobantes marcados como prueba, sin validez fiscal. No usarlo en
producción.

## Panel

- **Pedidos → detalle:** estado de la factura y de las notas de crédito, la
  descarga y los botones *Reintentar ahora* y *Emitir factura* (para pedidos
  pagados sin factura).
- **Comprobantes:** listado con filtros por fecha, estado, tipo y búsqueda por
  cliente, documento, CAE o número.

No incluye: percepciones, comprobantes de exportación ni la facturación de
ventas anteriores a la puesta en marcha.
