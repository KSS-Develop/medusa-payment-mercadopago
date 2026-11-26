# @ia-erp/medusa-mercadopago-storefront

Botón de pago y página de retorno de **Mercado Pago Checkout Pro** para storefronts de **Medusa v2** hechos con
React o Next.js. Es la parte del navegador del proveedor
[`@ia-erp/medusa-payment-mercadopago`](https://www.npmjs.com/package/@ia-erp/medusa-payment-mercadopago).

- `MercadoPagoPaymentButton` y `useMercadoPagoCheckout`: aseguran la sesión de pago del carro y llevan al comprador a Checkout Pro.
- `completeMercadoPagoReturn` y `MercadoPagoReturn`: al volver, completan el carro; si el pago sigue pendiente (efectivo, o
  Mercado Pago todavía no lo informa) reintentan y, si no se acredita, lo dicen sin perder el carro.
- `isMercadoPago` y `getApprovalUrl`: utilidades para el checkout.
- Sin estilos ni dependencias: sólo `react` (18 o superior) y `@medusajs/js-sdk` (2.11 o superior) como peer dependencies.

> **English.** Storefront helpers (React button, return page and utilities) for the Mercado Pago Checkout Pro
> provider for Medusa v2. Texts default to Spanish and can be overridden.

## Cómo funciona

1. El comprador elige Mercado Pago en el checkout. Medusa crea la sesión `pp_mercadopago_<país>` y el proveedor guarda en
   `payment_session.data` la `approval_url` de Checkout Pro.
2. El botón reutiliza esa sesión si sigue vigente y cobra el total actual del carro; si no, crea otra
   (`sdk.store.payment.initiatePaymentSession`). Luego redirige a `approval_url`.
3. El comprador paga y Mercado Pago lo devuelve a la `return_url` configurada en el backend (con `{session_id}` reemplazado
   y los parámetros que agrega Mercado Pago: `payment_id`, `status`, `external_reference`, `preference_id`…).
4. La página de retorno completa el carro (`sdk.store.cart.complete`). Medusa sólo crea el pedido con el pago aprobado:
   - aprobado: devuelve el pedido y se redirige a la confirmación;
   - pendiente (cupón de efectivo, transferencia, pago aún no visible): se reintenta `attempts` veces cada `delayMs` y, si
     sigue igual, se muestra «pendiente» con el carro intacto;
   - rechazado: se informa al tiro, para que el comprador vuelva a pagar.
5. El webhook del backend completa el carro cuando el pago se acredita, aunque el comprador no vuelva a la tienda.

## Instalar

```bash
npm install @ia-erp/medusa-mercadopago-storefront
```

## Uso con el SDK de Medusa

Con un `sdk` de `@medusajs/js-sdk` en el navegador basta pasarlo tal cual:

```tsx
"use client"
import { MercadoPagoPaymentButton } from "@ia-erp/medusa-mercadopago-storefront"

<MercadoPagoPaymentButton cart={cart} sdk={sdk} onError={(e) => console.error(e)} />
```

```tsx
"use client"
import { MercadoPagoReturn } from "@ia-erp/medusa-mercadopago-storefront"

<MercadoPagoReturn sdk={sdk} cartId={cartId} onOrder={(order) => router.replace(`/order/${order.id}`)} />
```

`sdk` también puede ser un objeto propio con la misma forma (`store.payment.initiatePaymentSession`,
`store.cart.complete` y, opcional, `store.cart.retrieve`): así se usan server actions, como en el starter de Next.js.

## Integración en el starter de Next.js de Medusa

Probado sobre [`medusajs/nextjs-starter-medusa`](https://github.com/medusajs/nextjs-starter-medusa) (commit `9818886`,
Next.js 15, abril de 2026): `tsc --noEmit` del starter pasa con estos cambios. El starter hace todas las llamadas a Medusa
con server actions (`src/lib/data/*`) porque la cookie del carro (`_medusa_cart_id`) y la de sesión son `httpOnly`; la
integración sigue ese mismo camino.

> **Ojo:** esas cookies son `SameSite=Strict`, así que **no llegan** en la redirección desde Mercado Pago: la página de
> retorno no puede leer el carro al renderizar en el servidor. Por eso el carro se completa desde el navegador, con server
> actions que sí reciben las cookies.

### 0. Backend: `return_url`

En `medusa-config.ts` del backend, la `return_url` de cada país apunta a la página nueva, con el código de país del
starter en la ruta:

```ts
{
  resolve: "@ia-erp/medusa-payment-mercadopago/providers/mercadopago",
  id: "cl",
  options: {
    country: "CL",
    access_token: process.env.MP_CL_ACCESS_TOKEN,
    webhook_secret: process.env.MP_CL_WEBHOOK_SECRET,
    return_url: `${process.env.STOREFRONT_URL}/cl/checkout/mercadopago?session={session_id}`,
  },
},
```

Sin el código de país también funciona (el middleware del starter redirige conservando los parámetros), pero con él se
ahorra una redirección. Habilite el proveedor en la región desde el panel de Medusa.

### 1. Instalar el paquete en el starter

```bash
yarn add @ia-erp/medusa-mercadopago-storefront   # o npm install
```

### 2. `src/lib/constants.tsx`: nombre del medio de pago y `isMercadoPago`

Agregue una entrada por país en `paymentInfoMap` (el selector de medios de pago muestra el `provider_id` crudo si no la
encuentra) y reexporte `isMercadoPago` junto a `isStripeLike` e `isManual`:

```tsx
export const paymentInfoMap: Record<string, { title: string; icon: React.JSX.Element }> = {
  // …entradas existentes…
  pp_mercadopago_cl: {
    title: "Mercado Pago",
    icon: <CreditCard />,
  },
  // pp_mercadopago_ar, pp_mercadopago_br… si vende en otros países
}

export { isMercadoPago } from "@ia-erp/medusa-mercadopago-storefront/core"
```

La entrada `/core` no carga React: sirve en código de servidor.

### 3. `src/lib/data/mercadopago.ts` (nuevo): server actions

```ts
"use server"

import { CAMPOS_ESTADO_CARRO } from "@ia-erp/medusa-mercadopago-storefront/core"
import type { RespuestaCompletar } from "@ia-erp/medusa-mercadopago-storefront/core"
import { sdk } from "@lib/config"
import { HttpTypes } from "@medusajs/types"
import { revalidateTag } from "next/cache"
import { getAuthHeaders, getCacheTag, getCartId, removeCartId } from "./cookies"

// La cookie del carro es SameSite=Strict: no llega en la redirección desde Mercado Pago, pero sí en
// estas server actions, que el navegador llama desde la propia tienda.
export async function getMercadoPagoCartId() {
  return (await getCartId()) ?? null
}

// Completa el carro. No lanza: un error de server action llega sin mensaje en producción.
export async function completeMercadoPagoCart(
  cartId: string
): Promise<RespuestaCompletar<HttpTypes.StoreOrder>> {
  const headers = { ...(await getAuthHeaders()) }
  try {
    const res = await sdk.store.cart.complete(cartId, {}, headers)
    revalidateTag(await getCacheTag("carts"))
    if (res.type === "order") {
      revalidateTag(await getCacheTag("orders"))
      if ((await getCartId()) === cartId) await removeCartId()
    }
    return res
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo completar el carro"
    return { type: "cart", cart: null, error: { message } }
  }
}

// Estado de la sesión de pago, sin caché, para distinguir un pago pendiente de uno rechazado.
export async function retrieveMercadoPagoCart(cartId: string) {
  const headers = { ...(await getAuthHeaders()) }
  return sdk.store.cart.retrieve(cartId, { fields: CAMPOS_ESTADO_CARRO }, headers)
}
```

### 4. `src/lib/mercadopago.ts` (nuevo): el «sdk» de los componentes

```ts
import type { MercadoPagoSdk } from "@ia-erp/medusa-mercadopago-storefront/core"
import { initiatePaymentSession } from "@lib/data/cart"
import { completeMercadoPagoCart, retrieveMercadoPagoCart } from "@lib/data/mercadopago"
import { HttpTypes } from "@medusajs/types"

// «SDK» para los componentes de Mercado Pago hecho con server actions: usan las cookies del comprador
// (carro y sesión) y revalidan la caché del starter, como el resto del checkout.
export const mercadoPagoSdk: MercadoPagoSdk<HttpTypes.StoreOrder> = {
  store: {
    payment: { initiatePaymentSession },
    cart: {
      complete: completeMercadoPagoCart,
      retrieve: retrieveMercadoPagoCart,
    },
  },
}
```

`initiatePaymentSession` es la server action que ya trae el starter en `src/lib/data/cart.ts`.

### 5. `src/modules/checkout/components/payment-button/index.tsx`: el botón

Importe el hook y el adaptador, agregue el caso al `switch` de `PaymentButton` y el componente (usa el `Button` y el
`ErrorMessage` del starter, para que se vea igual que los demás):

```tsx
import { useMercadoPagoCheckout } from "@ia-erp/medusa-mercadopago-storefront"
import { isManual, isMercadoPago, isStripeLike } from "@lib/constants"
import { mercadoPagoSdk } from "@lib/mercadopago"
```

```tsx
  switch (true) {
    case isStripeLike(paymentSession?.provider_id):
      // …
    case isMercadoPago(paymentSession?.provider_id):
      return (
        <MercadoPagoPaymentButton
          notReady={notReady}
          cart={cart}
          data-testid={dataTestId}
        />
      )
    case isManual(paymentSession?.provider_id):
      // …
  }
```

```tsx
const MercadoPagoPaymentButton = ({
  cart,
  notReady,
  "data-testid": dataTestId,
}: {
  cart: HttpTypes.StoreCart
  notReady: boolean
  "data-testid"?: string
}) => {
  // Asegura la sesión de Mercado Pago del carro y redirige a Checkout Pro. El pedido se crea al
  // volver (página /checkout/mercadopago) o por el webhook del backend.
  const { pay, loading, error } = useMercadoPagoCheckout({
    cart,
    sdk: mercadoPagoSdk,
  })

  return (
    <>
      <Button
        disabled={notReady}
        isLoading={loading}
        onClick={() => pay()}
        size="large"
        data-testid={dataTestId}
      >
        Pagar con Mercado Pago
      </Button>
      <ErrorMessage
        error={error}
        data-testid="mercadopago-payment-error-message"
      />
    </>
  )
}
```

No hace falta tocar el paso de pago (`src/modules/checkout/components/payment/index.tsx`): para proveedores que no son
Stripe ya crea la sesión al pulsar «Continue to review».

### 6. `src/modules/checkout/components/mercadopago-return/index.tsx` (nuevo): el panel de retorno

```tsx
"use client"

import { MercadoPagoReturn } from "@ia-erp/medusa-mercadopago-storefront"
import { getMercadoPagoCartId } from "@lib/data/mercadopago"
import { mercadoPagoSdk } from "@lib/mercadopago"
import { Heading } from "@medusajs/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { useRouter } from "next/navigation"

export default function MercadoPagoReturnPanel({
  countryCode,
}: {
  countryCode: string
}) {
  const router = useRouter()

  return (
    <div className="flex flex-col items-center gap-y-4 text-center">
      <Heading level="h1" className="text-2xl-regular">
        Pago con Mercado Pago
      </Heading>
      <MercadoPagoReturn
        sdk={mercadoPagoSdk}
        getCartId={getMercadoPagoCartId}
        onOrder={(order) => {
          const pais =
            order.shipping_address?.country_code?.toLowerCase() || countryCode
          router.replace(`/${pais}/order/${order.id}/confirmed`)
        }}
        className="flex flex-col items-center gap-y-4 txt-medium text-ui-fg-subtle"
      >
        {(estado) =>
          estado.type === "error" ? (
            <LocalizedClientLink
              href="/checkout?step=payment"
              className="txt-medium-plus text-ui-fg-interactive hover:underline"
            >
              Volver al checkout
            </LocalizedClientLink>
          ) : null
        }
      </MercadoPagoReturn>
    </div>
  )
}
```

### 7. `src/app/[countryCode]/(checkout)/checkout/mercadopago/page.tsx` (nuevo): la página

```tsx
import MercadoPagoReturnPanel from "@modules/checkout/components/mercadopago-return"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Pago con Mercado Pago",
}

// Mercado Pago vuelve aquí (return_url del backend) con ?session=… y sus propios parámetros
// (payment_id, status, external_reference…). El panel completa el carro desde el navegador.
export default async function MercadoPagoReturnPage(props: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await props.params

  return (
    <div className="content-container py-12">
      <MercadoPagoReturnPanel countryCode={countryCode} />
    </div>
  )
}
```

Queda bajo el layout del checkout (`app/[countryCode]/(checkout)/layout.tsx`) y la confirmación es la del starter
(`/[countryCode]/order/[id]/confirmed`).

## API

### `MercadoPagoPaymentButton`

| Prop | Tipo | Descripción |
|---|---|---|
| `cart` | carro de Medusa | Con `payment_collection.payment_sessions` (el starter ya los trae). |
| `sdk` | `@medusajs/js-sdk` o adaptador | Usa `store.payment.initiatePaymentSession(cart, { provider_id })`. |
| `providerId` | `string` | Por omisión, el de la primera sesión `pp_mercadopago_…` del carro. |
| `label`, `loadingLabel` | `ReactNode` | «Pagar con Mercado Pago» / «Abriendo Mercado Pago…». |
| `onError` | `(error: Error) => void` | Error al crear la sesión o sin `approval_url`. |
| `disabled`, `className`, `showError`, `data-testid` | | `showError={false}` oculta el mensaje bajo el botón. |

`useMercadoPagoCheckout({ cart, sdk, providerId?, onError?, navigate? })` hace lo mismo para un botón propio y devuelve
`{ pay, loading, redirecting, error }`. `navigate` reemplaza a `window.location.assign`.

### `completeMercadoPagoReturn({ sdk, cartId, attempts = 5, delayMs = 2500 })`

Devuelve una de:

- `{ type: "order", order }`: pedido creado (también si el webhook ya lo había creado: completar es idempotente).
- `{ type: "pending", paymentStatus?, paymentStatusDetail? }`: el pago no se acreditó tras los intentos; el carro sigue
  igual. `paymentStatusDetail: "pending_waiting_payment"` es un cupón de efectivo por pagar.
- `{ type: "error", reason: "rejected" | "failed", message }`: `rejected` si Mercado Pago rechazó o anuló el pago
  (sin agotar los intentos); `failed` si el carro no se pudo completar por otro motivo.

Tras cada intento fallido lee el carro (`store.cart.retrieve` con `CAMPOS_ESTADO_CARRO`) para distinguir pendiente de
rechazado. Si el adaptador no tiene `retrieve`, al agotar los intentos responde `pending`.

### `MercadoPagoReturn`

| Prop | Tipo | Descripción |
|---|---|---|
| `sdk` | `@medusajs/js-sdk` o adaptador | Igual que arriba, con `store.cart.complete` y `retrieve`. |
| `cartId` / `getCartId` | `string` / `() => Promise<string \| null>` | El carro, o cómo obtenerlo (cookie `httpOnly`). Sin carro muestra `noCart`. |
| `onOrder` | `(order) => void` | Pedido creado: redirija a la confirmación. |
| `attempts`, `delayMs` | `number` | Se pasan a `completeMercadoPagoReturn`. |
| `texts` | `Partial<MercadoPagoReturnTexts>` | `processing`, `pending`, `cashPending`, `rejected`, `error`, `noCart`, `retry`. Español por omisión (`textosPorOmision`). |
| `className` | `string` | El contenedor lleva `data-state` = `processing`, `order`, `pending`, `error` o `no-cart`. |
| `children` | `(estado) => ReactNode` | Contenido extra según el estado (p. ej. volver al checkout). |

En `pending` y en `error` por otro motivo que un rechazo muestra el botón «Volver a revisar», que reintenta.

### Utilidades

- `isMercadoPago(providerId)`: `true` para `pp_mercadopago_…`.
- `getApprovalUrl(cart, providerId?)`: URL de Checkout Pro de la sesión de Mercado Pago del carro (sólo `https`).
- `ensureMercadoPagoSession({ cart, sdk, providerId? })`: lo que hace el botón, sin React; devuelve `{ approvalUrl, providerId, session }`.
- `getMercadoPagoSession(cart, providerId?)`, `resolveMercadoPagoProvider(cart, providerId?)`, `CAMPOS_ESTADO_CARRO`.

Todo lo que no es React está también en `@ia-erp/medusa-mercadopago-storefront/core`.

## Limitaciones

- Si el comprador vuelve en otro navegador (por ejemplo, la app de Mercado Pago abre el navegador por omisión del
  teléfono), no está la cookie del carro: la página muestra `noCart` y el pedido lo crea el webhook al acreditarse el pago.
- Un pago pendiente no reserva stock: si el carro cambia antes de que se acredite, el backend no autoriza el monto antiguo
  (ver «Seguridad del cobro» en el README del proveedor).

## Desarrollo

```bash
npm install
npm test        # compila, revisa los tipos contra @medusajs/js-sdk y corre las pruebas (node --test)
npm run build   # tsc → dist/ (ESM + .d.ts)
```

Licencia MIT. Hecho por [IA ERP](https://ia-erp.cl), desarrollador certificado de Mercado Pago. Soporte: support@ia-erp.cl.
