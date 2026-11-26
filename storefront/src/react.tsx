"use client"

// Componentes y hook de React. Sin estilos propios: aceptan className y exponen data-state para
// que cada tienda los vista con su sistema de diseño.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { completeMercadoPagoReturn, ensureMercadoPagoSession, MercadoPagoError } from "./nucleo.js"
import type { CarroMercadoPago, MercadoPagoPaymentSdk, MercadoPagoSdk, PedidoMercadoPago, ResultadoRetorno } from "./tipos.js"

const MENSAJE_GENERICO = "No pudimos abrir Mercado Pago. Inténtalo de nuevo."

function mensajeDe(e: unknown): string {
  if (e instanceof MercadoPagoError) return e.message
  return MENSAJE_GENERICO
}

// Redirección del navegador; se puede reemplazar (pruebas, apps embebidas).
function irA(url: string) {
  window.location.assign(url)
}

export interface UseMercadoPagoCheckoutOptions {
  cart: CarroMercadoPago
  sdk: MercadoPagoPaymentSdk
  providerId?: string
  onError?: (error: Error) => void
  navigate?: (url: string) => void
}

// Hook para usar el botón propio de la tienda: `pay()` asegura la sesión y redirige a Checkout Pro.
// `redirecting` queda en true tras redirigir, para que el botón no se pueda volver a pulsar.
export function useMercadoPagoCheckout({ cart, sdk, providerId, onError, navigate = irA }: UseMercadoPagoCheckoutOptions) {
  const [loading, setLoading] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const enCurso = useRef(false)

  // Al volver con «atrás» desde Mercado Pago, el navegador puede restaurar la página desde su caché
  // (bfcache) con el botón aún en «redirigiendo»: se libera.
  useEffect(() => {
    const alVolver = (e: PageTransitionEvent) => {
      if (!e.persisted) return
      enCurso.current = false
      setRedirecting(false)
      setLoading(false)
    }
    window.addEventListener("pageshow", alVolver)
    return () => window.removeEventListener("pageshow", alVolver)
  }, [])

  const pay = useCallback(async () => {
    if (enCurso.current) return
    enCurso.current = true
    setLoading(true)
    setError(null)
    try {
      const { approvalUrl } = await ensureMercadoPagoSession({ cart, sdk, providerId })
      setRedirecting(true)
      navigate(approvalUrl)
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      setError(mensajeDe(err))
      onError?.(err)
      enCurso.current = false
      setLoading(false)
    }
  }, [cart, sdk, providerId, onError, navigate])

  return { pay, loading: loading || redirecting, redirecting, error }
}

export interface MercadoPagoPaymentButtonProps {
  cart: CarroMercadoPago
  sdk: MercadoPagoPaymentSdk
  providerId?: string
  label?: ReactNode
  loadingLabel?: ReactNode
  onError?: (error: Error) => void
  disabled?: boolean
  className?: string
  // Muestra el error bajo el botón (por omisión, sí). Con false, úselo desde onError.
  showError?: boolean
  "data-testid"?: string
}

export function MercadoPagoPaymentButton({
  cart,
  sdk,
  providerId,
  label = "Pagar con Mercado Pago",
  loadingLabel = "Abriendo Mercado Pago…",
  onError,
  disabled,
  className,
  showError = true,
  "data-testid": testId = "mercadopago-payment-button",
}: MercadoPagoPaymentButtonProps) {
  const { pay, loading, error } = useMercadoPagoCheckout({ cart, sdk, providerId, onError })
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => void pay()}
        disabled={disabled || loading}
        aria-busy={loading}
        data-state={loading ? "loading" : error ? "error" : "idle"}
        data-testid={testId}
      >
        {loading ? loadingLabel : label}
      </button>
      {showError && error ? (
        <p role="alert" data-testid="mercadopago-payment-error">
          {error}
        </p>
      ) : null}
    </>
  )
}

export interface MercadoPagoReturnTexts {
  processing: ReactNode
  pending: ReactNode
  cashPending: ReactNode
  rejected: ReactNode
  error: ReactNode
  noCart: ReactNode
  retry: ReactNode
}

export const textosPorOmision: MercadoPagoReturnTexts = {
  processing: "Estamos confirmando tu pago con Mercado Pago…",
  pending:
    "Tu pago está en proceso. Te enviaremos un correo cuando se confirme; tu carro se mantiene mientras tanto.",
  cashPending:
    "Tu pago en efectivo quedó pendiente. Cuando lo pagues en el punto de pago, confirmaremos tu pedido y te avisaremos por correo.",
  rejected: "Mercado Pago rechazó el pago. Puedes volver al checkout e intentarlo con otro medio.",
  error: "No pudimos completar tu pedido. Si ya pagaste, no vuelvas a pagar: escríbenos y lo revisamos.",
  noCart:
    "No encontramos tu carro en este navegador. Si completaste el pago, recibirás la confirmación del pedido por correo.",
  retry: "Volver a revisar",
}

export type EstadoRetorno<P extends PedidoMercadoPago = PedidoMercadoPago> =
  | { type: "processing" }
  | { type: "no-cart" }
  | ResultadoRetorno<P>

export interface MercadoPagoReturnProps<P extends PedidoMercadoPago = PedidoMercadoPago> {
  sdk: MercadoPagoSdk<P>
  // Id del carro. Si no lo conoce el cliente (p. ej. está en una cookie httpOnly), use getCartId.
  cartId?: string | null
  getCartId?: () => Promise<string | null | undefined>
  onOrder: (order: P) => void
  attempts?: number
  delayMs?: number
  texts?: Partial<MercadoPagoReturnTexts>
  className?: string
  // Contenido extra según el estado (p. ej. un enlace de vuelta al checkout cuando hubo rechazo).
  children?: (estado: EstadoRetorno<P>) => ReactNode
}

// Página de retorno: completa el carro y muestra procesando / pendiente / error. Con el pedido creado
// llama a onOrder (redirija ahí a la confirmación).
export function MercadoPagoReturn<P extends PedidoMercadoPago = PedidoMercadoPago>({
  sdk,
  cartId,
  getCartId,
  onOrder,
  attempts,
  delayMs,
  texts,
  className,
  children,
}: MercadoPagoReturnProps<P>) {
  const t = { ...textosPorOmision, ...texts }
  const [estado, setEstado] = useState<EstadoRetorno<P>>({ type: "processing" })
  const [ronda, setRonda] = useState(0)
  // Las funciones de las props cambian en cada render del padre: se leen por referencia.
  const props = useRef({ sdk, cartId, getCartId, onOrder, attempts, delayMs })
  props.current = { sdk, cartId, getCartId, onOrder, attempts, delayMs }

  useEffect(() => {
    let vigente = true
    setEstado({ type: "processing" })
    ;(async () => {
      const p = props.current
      let id = p.cartId
      if (!id && p.getCartId) {
        try {
          id = await p.getCartId()
        } catch {
          id = undefined
        }
      }
      if (!id) {
        if (vigente) setEstado({ type: "no-cart" })
        return
      }
      const r = await completeMercadoPagoReturn<P>({ sdk: p.sdk, cartId: id, attempts: p.attempts, delayMs: p.delayMs })
      if (!vigente) return
      setEstado(r)
      if (r.type === "order") p.onOrder(r.order)
    })()
    return () => {
      vigente = false
    }
  }, [ronda])

  let texto: ReactNode
  switch (estado.type) {
    case "processing":
    case "order":
      texto = t.processing
      break
    case "pending":
      texto = estado.paymentStatusDetail === "pending_waiting_payment" ? t.cashPending : t.pending
      break
    case "error":
      texto = estado.reason === "rejected" ? t.rejected : t.error
      break
    case "no-cart":
      texto = t.noCart
      break
  }
  const puedeReintentar = estado.type === "pending" || (estado.type === "error" && estado.reason === "failed")

  return (
    <div className={className} data-state={estado.type} data-testid="mercadopago-return">
      <p role="status" aria-live="polite">
        {texto}
      </p>
      {puedeReintentar ? (
        <button type="button" onClick={() => setRonda((n) => n + 1)} data-testid="mercadopago-return-retry">
          {t.retry}
        </button>
      ) : null}
      {children?.(estado)}
    </div>
  )
}
