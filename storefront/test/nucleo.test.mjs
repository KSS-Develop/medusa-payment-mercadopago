import assert from "node:assert/strict"
import { test } from "node:test"
import {
  completeMercadoPagoReturn,
  ensureMercadoPagoSession,
  getApprovalUrl,
  isMercadoPago,
} from "../dist/index.js"

const URL_MP = "https://www.mercadopago.cl/checkout/v1/redirect?pref_id=123-abc"

function carro({ sesiones = [], total = 15990 } = {}) {
  return {
    id: "cart_1",
    total,
    currency_code: "clp",
    payment_collection: { id: "pay_col_1", amount: total, currency_code: "clp", payment_sessions: sesiones },
  }
}

function sesion(extra = {}) {
  return {
    id: "payses_1",
    provider_id: "pp_mercadopago_cl",
    amount: 15990,
    currency_code: "clp",
    status: "pending",
    data: { session_id: "payses_1", approval_url: URL_MP, status: "pending" },
    ...extra,
  }
}

// SDK falso: `completar` y `estados` son colas de respuestas (una por intento).
function sdkFalso({ completar = [], estados = [], iniciar } = {}) {
  const llamadas = { complete: 0, retrieve: 0, initiate: [] }
  const sdk = {
    store: {
      payment: {
        async initiatePaymentSession(cart, body) {
          llamadas.initiate.push(body)
          return iniciar(cart, body)
        },
      },
      cart: {
        async complete(id) {
          llamadas.complete++
          const r = completar.length > 1 ? completar.shift() : completar[0]
          if (r instanceof Error) throw r
          return r
        },
        async retrieve(id, query) {
          llamadas.retrieve++
          assert.match(query.fields, /payment_sessions/)
          const c = estados.length > 1 ? estados.shift() : estados[0]
          return { cart: c }
        },
      },
    },
  }
  return { sdk, llamadas }
}

test("isMercadoPago reconoce el prefijo del proveedor", () => {
  assert.equal(isMercadoPago("pp_mercadopago_cl"), true)
  assert.equal(isMercadoPago("pp_mercadopago_br"), true)
  assert.equal(isMercadoPago("pp_stripe_stripe"), false)
  assert.equal(isMercadoPago("pp_system_default"), false)
  assert.equal(isMercadoPago(undefined), false)
  assert.equal(isMercadoPago(null), false)
})

test("getApprovalUrl toma la sesión de Mercado Pago y exige https", () => {
  assert.equal(getApprovalUrl(carro({ sesiones: [sesion()] })), URL_MP)
  assert.equal(
    getApprovalUrl(carro({ sesiones: [{ provider_id: "pp_stripe_stripe", data: { approval_url: URL_MP } }, sesion()] })),
    URL_MP
  )
  assert.equal(getApprovalUrl(carro({ sesiones: [sesion({ data: { approval_url: "javascript:alert(1)" } })] })), undefined)
  assert.equal(getApprovalUrl(carro({ sesiones: [sesion({ data: { approval_url: "http://x.cl" } })] })), undefined)
  assert.equal(getApprovalUrl(carro()), undefined)
  assert.equal(getApprovalUrl(null), undefined)
  assert.equal(getApprovalUrl(carro({ sesiones: [sesion()] }), "pp_mercadopago_br"), undefined)
})

test("ensureMercadoPagoSession reutiliza la sesión vigente del mismo monto", async () => {
  const { sdk, llamadas } = sdkFalso({ iniciar: () => assert.fail("no debía crear sesión") })
  const r = await ensureMercadoPagoSession({ cart: carro({ sesiones: [sesion()] }), sdk })
  assert.equal(r.approvalUrl, URL_MP)
  assert.equal(r.providerId, "pp_mercadopago_cl")
  assert.equal(llamadas.initiate.length, 0)
})

test("ensureMercadoPagoSession crea una sesión nueva si cambió el monto", async () => {
  const nueva = "https://www.mercadopago.cl/checkout/v1/redirect?pref_id=nueva"
  const { sdk, llamadas } = sdkFalso({
    iniciar: () => ({
      payment_collection: {
        payment_sessions: [sesion({ id: "payses_2", amount: 20990, data: { approval_url: nueva } })],
      },
    }),
  })
  const r = await ensureMercadoPagoSession({ cart: carro({ sesiones: [sesion()], total: 20990 }), sdk })
  assert.equal(r.approvalUrl, nueva)
  assert.deepEqual(llamadas.initiate, [{ provider_id: "pp_mercadopago_cl" }])
})

test("ensureMercadoPagoSession usa el providerId indicado y falla sin proveedor", async () => {
  const { sdk, llamadas } = sdkFalso({
    iniciar: () => ({ payment_collection: { payment_sessions: [sesion({ provider_id: "pp_mercadopago_ar" })] } }),
  })
  await ensureMercadoPagoSession({ cart: carro(), sdk, providerId: "pp_mercadopago_ar" })
  assert.deepEqual(llamadas.initiate, [{ provider_id: "pp_mercadopago_ar" }])
  await assert.rejects(ensureMercadoPagoSession({ cart: carro(), sdk }), /no tiene Mercado Pago/)
})

test("completeMercadoPagoReturn devuelve el pedido al primer intento", async () => {
  const { sdk, llamadas } = sdkFalso({ completar: [{ type: "order", order: { id: "order_1" } }] })
  const r = await completeMercadoPagoReturn({ sdk, cartId: "cart_1", delayMs: 0 })
  assert.deepEqual(r, { type: "order", order: { id: "order_1" } })
  assert.equal(llamadas.complete, 1)
})

test("completeMercadoPagoReturn reintenta mientras el pago está pendiente", async () => {
  const noAutorizado = Object.assign(new Error("Session: payses_1 was not authorized with the provider."), {
    status: 400,
  })
  const { sdk, llamadas } = sdkFalso({
    completar: [noAutorizado, noAutorizado, { type: "order", order: { id: "order_1" } }],
    estados: [carro({ sesiones: [sesion()] })],
  })
  const r = await completeMercadoPagoReturn({ sdk, cartId: "cart_1", attempts: 5, delayMs: 0 })
  assert.equal(r.type, "order")
  assert.equal(llamadas.complete, 3)
})

test("completeMercadoPagoReturn informa pendiente (efectivo) al agotar los intentos", async () => {
  const efectivo = carro({
    sesiones: [sesion({ data: { approval_url: URL_MP, status: "pending", status_detail: "pending_waiting_payment" } })],
  })
  const { sdk, llamadas } = sdkFalso({ completar: [new Error("not authorized")], estados: [efectivo] })
  const r = await completeMercadoPagoReturn({ sdk, cartId: "cart_1", attempts: 3, delayMs: 0 })
  assert.deepEqual(r, { type: "pending", paymentStatus: "pending", paymentStatusDetail: "pending_waiting_payment" })
  assert.equal(llamadas.complete, 3)
})

test("completeMercadoPagoReturn usa el carro de la respuesta 200 con error de autorización", async () => {
  const { sdk, llamadas } = sdkFalso({
    completar: [
      {
        type: "cart",
        cart: carro({ sesiones: [sesion()] }),
        error: { message: "Payment authorization failed", type: "payment_authorization_error" },
      },
    ],
  })
  const r = await completeMercadoPagoReturn({ sdk, cartId: "cart_1", attempts: 2, delayMs: 0 })
  assert.equal(r.type, "pending")
  assert.equal(llamadas.retrieve, 0)
})

test("completeMercadoPagoReturn corta de inmediato si Mercado Pago rechazó el pago", async () => {
  const rechazado = carro({ sesiones: [sesion({ status: "error", data: { status: "rejected" } })] })
  const { sdk, llamadas } = sdkFalso({ completar: [new Error("not authorized")], estados: [rechazado] })
  const r = await completeMercadoPagoReturn({ sdk, cartId: "cart_1", attempts: 5, delayMs: 0 })
  assert.equal(r.type, "error")
  assert.equal(r.reason, "rejected")
  assert.equal(llamadas.complete, 1)
})

test("completeMercadoPagoReturn sin carro o sin sesión de Mercado Pago es error", async () => {
  const { sdk } = sdkFalso({ completar: [new Error("x")], estados: [carro()] })
  assert.equal((await completeMercadoPagoReturn({ sdk, cartId: "", delayMs: 0 })).type, "error")
  const r = await completeMercadoPagoReturn({ sdk, cartId: "cart_1", delayMs: 0 })
  assert.equal(r.type, "error")
  assert.equal(r.reason, "failed")
})

test("completeMercadoPagoReturn sin retrieve y sin datos queda pendiente, sin perder el carro", async () => {
  const { sdk } = sdkFalso({ completar: [new Error("409 Cart is already being completed")] })
  delete sdk.store.cart.retrieve
  const r = await completeMercadoPagoReturn({ sdk, cartId: "cart_1", attempts: 2, delayMs: 0 })
  assert.deepEqual(r, { type: "pending" })
})

test("completeMercadoPagoReturn espera delayMs entre intentos", async () => {
  const { sdk } = sdkFalso({ completar: [new Error("x")], estados: [carro({ sesiones: [sesion()] })] })
  const inicio = Date.now()
  await completeMercadoPagoReturn({ sdk, cartId: "cart_1", attempts: 3, delayMs: 30 })
  assert.ok(Date.now() - inicio >= 55)
})
