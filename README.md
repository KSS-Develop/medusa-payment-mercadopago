# @ia-erp/medusa-payment-mercadopago

Mercado Pago **Checkout Pro** para **Medusa v2**: Chile, Brasil y Argentina en un solo paquete. Hecho por
[IA ERP](https://ia-erp.cl), desarrollador certificado de Mercado Pago (Partners Program, Checkout Pro).

- Un proveedor por país, cada uno con las credenciales de su cuenta (`mercadopago_cl`, `mercadopago_br`, `mercadopago_ar`).
- Checkout Pro muestra los medios de cada país: tarjetas y cuotas, débito, PIX en Brasil, efectivo donde exista.
- Webhooks verificados con la firma `x-signature` de Mercado Pago, sobre el webhook nativo de Medusa.
- Reembolsos totales y parciales, anulación de pagos pendientes, montos según los decimales de cada moneda (CLP sin decimales).
- Compra como invitado: no necesita cliente registrado.

> **English.** Mercado Pago Checkout Pro payment provider for Medusa v2 (Chile, Brazil and Argentina), one
> provider per country, signed webhooks (`x-signature`), full and partial refunds, amount and currency checks
> before authorizing. Built and maintained by IA ERP, a certified Mercado Pago Partners developer.

## Instalar

```bash
npm install @ia-erp/medusa-payment-mercadopago
```

```ts
// medusa-config.ts
modules: [
  {
    resolve: "@medusajs/medusa/payment",
    options: {
      providers: [
        {
          resolve: "@ia-erp/medusa-payment-mercadopago/providers/mercadopago",
          id: "cl",
          options: {
            country: "CL",
            access_token: process.env.MP_CL_ACCESS_TOKEN,       // APP_USR-… de la cuenta del vendedor
            webhook_secret: process.env.MP_CL_WEBHOOK_SECRET,   // «Clave secreta» de Webhooks en el panel
            return_url: `${process.env.STOREFRONT_URL}/checkout/mercadopago?session={session_id}`,
            statement_descriptor: "MI TIENDA",
            max_installments: 12,
          },
        },
        // Brasil y Argentina: el mismo proveedor con id "br"/"ar", country "BR"/"AR" y sus credenciales.
      ],
    },
  },
],
```

Luego habilite **Mercado Pago (`pp_mercadopago_cl`)** en la región de Chile desde el panel de Medusa. La región debe
cobrar en CLP (BRL para Brasil, ARS para Argentina).

### Opciones

| Opción | Obligatoria | Descripción |
|---|---|---|
| `country` | sí | `CL`, `BR` o `AR`. Fija la moneda admitida. |
| `access_token` | sí | Access Token de producción de la aplicación (empieza con `APP_USR-`). |
| `webhook_secret` | sí | Clave secreta de webhooks de la aplicación. |
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

## Seguridad del cobro

- Antes de autorizar, el pago debe estar aprobado, en la moneda del país y por el mismo monto de la sesión.
- Si el comprador reintenta tras un rechazo, se toma el pago aprobado más reciente de la misma sesión.
- Al borrarse una sesión (cambió el carro), su preferencia se vence: una pestaña vieja no puede cobrar un monto antiguo. Si el comprador ya había pagado esa sesión, queda un error en el log para revisarlo y reembolsarlo desde el panel de Mercado Pago.
- Si Medusa no logra crear el pedido de un pago cobrado, su compensación lo reembolsa con `refundPayment`.
- Un pago reembolsado o con contracargo nunca completa un carro.

## Storefront

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
