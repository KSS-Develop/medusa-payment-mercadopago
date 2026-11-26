import { test } from "node:test"
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { firmaValida, leerFirma, plantilla } from "../src/lib/firma.ts"
import { accionWebhook, estadoSesion, pagoVigente } from "../src/lib/estado.ts"
import { iguales, redondear } from "../src/lib/monto.ts"
import { PAISES, esPais } from "../src/lib/pais.ts"

const secreto = "secreto-de-prueba"
const firmar = (dataId: string, requestId: string, ts: string) =>
  `ts=${ts},v1=${createHmac("sha256", secreto).update(plantilla(dataId, requestId, ts)).digest("hex")}`

test("firma válida según la plantilla de Mercado Pago", () => {
  const encabezado = firmar("191688094670", "req-1", "1704908010")
  assert.equal(firmaValida({ secreto, encabezado, requestId: "req-1", dataId: "191688094670" }), true)
})

test("firma con otro id, otro request-id o otro secreto se rechaza", () => {
  const encabezado = firmar("123", "req-1", "1")
  assert.equal(firmaValida({ secreto, encabezado, requestId: "req-1", dataId: "124" }), false)
  assert.equal(firmaValida({ secreto, encabezado, requestId: "req-2", dataId: "123" }), false)
  assert.equal(firmaValida({ secreto: "otro", encabezado, requestId: "req-1", dataId: "123" }), false)
})

test("firma ausente o mal formada se rechaza sin lanzar", () => {
  assert.equal(firmaValida({ secreto, encabezado: undefined, requestId: "r", dataId: "1" }), false)
  assert.equal(firmaValida({ secreto, encabezado: "basura", requestId: "r", dataId: "1" }), false)
  assert.equal(firmaValida({ secreto, encabezado: "ts=1,v1=zz", requestId: "r", dataId: "1" }), false)
  assert.equal(leerFirma("ts=1"), null)
})

test("plantilla: id alfanumérico en minúsculas y partes ausentes omitidas", () => {
  assert.equal(plantilla("ABC123", "r", "9"), "id:abc123;request-id:r;ts:9;")
  assert.equal(plantilla("555", undefined, "9"), "id:555;ts:9;")
})

test("estados de pago → sesión de Medusa", () => {
  assert.equal(estadoSesion("approved"), "captured")
  assert.equal(estadoSesion("authorized"), "authorized")
  assert.equal(estadoSesion("pending"), "pending")
  assert.equal(estadoSesion("in_process"), "pending")
  assert.equal(estadoSesion("rejected"), "error")
  assert.equal(estadoSesion("cancelled"), "canceled")
  assert.equal(estadoSesion(undefined), "pending")
  assert.equal(estadoSesion("refunded"), "error")
  assert.equal(estadoSesion("charged_back"), "error")
  assert.equal(pagoVigente("approved"), true)
  assert.equal(pagoVigente("rejected"), false)
})

test("estados de pago → acción del webhook", () => {
  assert.equal(accionWebhook("approved"), "captured")
  assert.equal(accionWebhook("authorized"), "authorized")
  assert.equal(accionWebhook("rejected"), "failed")
  assert.equal(accionWebhook("cancelled"), "canceled")
  assert.equal(accionWebhook("pending"), "not_supported")
  assert.equal(accionWebhook("refunded"), "not_supported")
})

test("montos: CLP sin decimales, BRL y ARS con dos", () => {
  assert.equal(redondear(19990.4, 0), 19990)
  assert.equal(redondear(19990.5, 0), 19991)
  assert.equal(redondear(49.999, 2), 50)
  assert.equal(redondear(10.5, 2), 10.5)
  assert.equal(redondear(1.005, 2), 1.01)
  assert.equal(iguales(15990, 15990.4, 0), true)
  assert.equal(iguales(15989, 15990, 0), false)
  assert.equal(iguales(15991, 15990, 0), false)
  assert.equal(redondear(1e-7, 2), 0)
  assert.equal(redondear(1.5e21, 0), 1.5e21)
})

test("países soportados", () => {
  assert.equal(PAISES.CL.moneda, "clp")
  assert.equal(PAISES.BR.site_id, "MLB")
  assert.equal(esPais("AR"), true)
  assert.equal(esPais("MX"), false)
})
