# @ia-erp/medusa-payment-mercadopago

[![npm](https://img.shields.io/npm/v/@ia-erp/medusa-payment-mercadopago)](https://www.npmjs.com/package/@ia-erp/medusa-payment-mercadopago) [![CI](https://github.com/KSS-Develop/medusa-payment-mercadopago/actions/workflows/ci.yml/badge.svg)](https://github.com/KSS-Develop/medusa-payment-mercadopago/actions/workflows/ci.yml)

Mercado Pago **Checkout Pro** para **Medusa v2**: Argentina, Brasil, Chile, Colombia, México, Perú y Uruguay en un solo paquete. Hecho por
[IA ERP](https://ia-erp.cl), desarrollador certificado de Mercado Pago (Partners Program, Checkout Pro).

- Un proveedor por país, cada uno con las credenciales de su cuenta (`mercadopago_cl`, `mercadopago_br`, `mercadopago_ar`, …).
- Checkout Pro muestra los medios de cada país: tarjetas y cuotas, débito, PIX en Brasil, efectivo donde exista.
- Webhooks verificados con la firma `x-signature` de Mercado Pago, sobre el webhook nativo de Medusa.
- Reembolsos totales y parciales, anulación de pagos pendientes, montos según los decimales de cada moneda (CLP sin decimales).
- Compra como invitado: no necesita cliente registrado.

> **English.** Mercado Pago Checkout Pro payment provider for Medusa v2 (Argentina, Brazil, Chile, Colombia, Mexico, Peru and Uruguay), one
> provider per country, signed webhooks (`x-signature`), full and partial refunds, amount and currency checks
> before authorizing. Built and maintained by IA ERP, a certified Mercado Pago Partners developer.

## Starters listos

- **Next.js** (Medusa DTC Starter con Mercado Pago, backend y tienda): https://github.com/KSS-Develop/medusa-mercadopago-starter-nextjs
- **Astro 7** (backend Medusa y tienda liviana renderizada en el servidor): https://github.com/KSS-Develop/medusa-mercadopago-starter-astro

## Instalar

```bash
npm install @ia-erp/medusa-payment-mercadopago
```

```ts
// medusa-config.ts
plugins: [{ resolve: "@ia-erp/medusa-payment-mercadopago", options: {} }],
modules: [
  // Guarda las cuentas conectadas (llaves cifradas con MP_CONEXION_CLAVE o, si falta, JWT_SECRET).
  { resolve: "@ia-erp/medusa-payment-mercadopago/modules/mercadopago-conexion" },
  {
    resolve: "@medusajs/medusa/payment",
    options: {
      providers: [
        // Un proveedor por país. El id debe ser el código del país en minúsculas.
        {
          resolve: "@ia-erp/medusa-payment-mercadopago/providers/mercadopago",
          id: "cl",
          options: {
            country: "CL",
            return_url: `${process.env.STOREFRONT_URL}/cl/checkout/mercadopago?session={session_id}`,
          },
        },
      ],
    },
  },
],
```

Variables de entorno del backend:

- `MP_CONEXION_CLAVE`: clave aleatoria (al menos 24 caracteres) para cifrar las llaves guardadas. Si cambia, hay que
  volver a conectar las cuentas.
- `MEDUSA_BACKEND_URL`: URL pública del backend (`https://…`), a la que Mercado Pago envía los avisos de pago. Si
  falta, se usa el host desde el que se conectó la cuenta.

Luego `npx medusa db:migrate`, y en el admin:

1. **Configuración → Mercado Pago → Conectar con Mercado Pago** en el país. Se inicia sesión en Mercado Pago, se
   autoriza y listo: las llaves quedan guardadas cifradas y se renuevan solas. No hay que copiar nada ni configurar
   webhooks: cada pago avisa al backend que conectó la cuenta.
2. **Configuración → Regiones →** la región del país → habilitar **Mercado Pago (`pp_mercadopago_cl`)**. Cada región
   cobra en la moneda de su país.

«Conectar con Mercado Pago» está disponible en los países donde IA ERP tiene su aplicación de Mercado Pago (Mercado
Pago no deja cobrar con una cuenta de un país conectada a una aplicación de otro). En los demás países use llaves
propias (abajo); el admin lo indica junto a cada país.

La autorización pasa por `https://ia-erp.cl/mercadopago/oauth`, que primero muestra a qué tienda se conectará la
cuenta y guarda el secreto de la aplicación de IA ERP en Mercado Pago (no
almacena llaves: viajan cifradas y sólo las descifra la tienda que inició la conexión). Su código
está en `broker/`.

### Con la aplicación propia de la tienda (todos los países)

En **Configuración → Mercado Pago → Usar mi aplicación** el admin muestra, para cada país, los pasos para crear una
aplicación en Mercado Pago Developers con la cuenta de la tienda, la URL de webhook que hay que pegar en su panel y
dos campos: **Access Token** de producción y **clave secreta de webhooks**. Al guardar se comprueba con Mercado Pago
que la llave funcione y que la cuenta sea del país elegido; las llaves quedan cifradas y los avisos de pago exigen la
firma. Sirve en todos los países, sin depender de la aplicación de IA ERP, y la comisión del Partners Program se
cuenta igual porque el plugin envía el Integrator ID de IA ERP en cada pago.

### Llaves en medusa-config (sin admin)

También se pueden poner `access_token` (`APP_USR-…`) y `webhook_secret` en las opciones del proveedor y configurar el
webhook en el panel de Mercado Pago (ver «Webhook»); en ese caso el módulo `mercadopago-conexion` es opcional.

### Opciones

| Opción | Obligatoria | Descripción |
|---|---|---|
| `country` | sí | `AR` (ARS), `BR` (BRL), `CL` (CLP), `CO` (COP), `MX` (MXN), `PE` (PEN) o `UY` (UYU). Fija la moneda admitida. |
| `access_token` | no | Access Token propio (`APP_USR-…`). Sin él se usa la cuenta conectada desde el admin. |
| `webhook_secret` | no | Clave secreta de webhooks de su aplicación; con ella se exige la firma `x-signature`. |
| `notification_url` | no | URL del webhook enviada en cada preferencia (se le agrega `source_news=webhooks`). Lo recomendado es configurarla en el panel; ver «Webhook». |
| `return_url` | sí | Página del storefront a la que vuelve el comprador; `{session_id}` se reemplaza. |
| `failure_url`, `pending_url` | no | Páginas para pago rechazado o pendiente (por omisión, `return_url`). |
| `statement_descriptor` | no | Texto del cargo en el estado de cuenta. |
| `max_installments` | no | Máximo de cuotas (12 por omisión). |
| `excluded_payment_methods`, `excluded_payment_types` | no | Por ejemplo `["visa"]` o `["ticket"]`. |
| `integrator_id` | no | Integrator ID del Partners Program (por omisión, el de IA ERP). |

## Webhook

En el panel de Mercado Pago (Tus integraciones → la aplicación → Webhooks) configure la URL de producción
`https://<backend>/hooks/payment/mercadopago_cl` con el evento **Pagos** y copie la clave secreta en
`webhook_secret`. Medusa responde 200 y procesa el aviso unos segundos después; el pago aprobado completa el carro
aunque el comprador no vuelva a la tienda.

## Probado

Compras reales en el ambiente de pruebas de Mercado Pago (Checkout Pro, comprador de prueba de cada país), noviembre de 2026:

| País | Pago con tarjeta | Otros casos |
|---|---|---|
| Chile | CLP, aprobado | certificación Checkout Pro |
| Brasil | BRL 129,90, aprobado | |
| Argentina | ARS 15.999,50, aprobado | 3 cuotas con interés (el comprador paga 19.149,80; se valida el precio de 15.999,50); Rapipago queda pendiente |
| México | MXN 499,99 en 3 cuotas, aprobado | |
| Colombia | COP 89.900, aprobado | |
| Perú | PEN 149,90, aprobado | |
| Uruguay | UYU 1.290,50, aprobado | |

En todos se verificó la autorización (monto y moneda) y el aviso firmado. Los reembolsos y anulaciones no se pueden
probar con cuentas de prueba: Mercado Pago los rechaza con «Unauthorized use of live credentials».

## Seguridad del cobro

- Antes de autorizar, el pago debe estar aprobado, en la moneda del país y por el mismo monto de la sesión.
- Si el comprador reintenta tras un rechazo, se toma el pago aprobado más reciente de la misma sesión.
- Al borrarse una sesión (cambió el carro), su preferencia se vence: una pestaña vieja no puede cobrar un monto antiguo. Si el comprador ya había pagado esa sesión, queda un error en el log para revisarlo y reembolsarlo desde el panel de Mercado Pago.
- Si Medusa no logra crear el pedido de un pago cobrado, su compensación lo reembolsa con `refundPayment`.
- Un pago reembolsado o con contracargo nunca completa un carro.

## Storefront

Para el starter oficial de Next.js use [`@ia-erp/medusa-mercadopago-storefront`](./storefront): botón de pago y
página de retorno listos. Si arma su propio storefront:


1. Cree la sesión de pago con el proveedor `pp_mercadopago_cl` (SDK de Medusa: `sdk.store.payment.initiatePaymentSession`).
2. Redirija al comprador a `payment_session.data.approval_url`.
3. En la página de `return_url`, complete el carro (`sdk.store.cart.complete`). Si el pago aún figura pendiente,
   muestre «procesando» y reintente: el webhook lo confirmará.

## Datos guardados en la sesión

`session_id`, `preference_id`, `approval_url`, `currency_code`, `amount`, `payment_id`, `status`, `status_detail` y
`refund_id`. No incluye credenciales: la sesión es visible para el storefront.

## Desarrollo

```bash
npm install
npm test        # pruebas de firma, estados y montos
npm run build   # medusa plugin:build
```

Licencia MIT. Soporte: support@ia-erp.cl.
