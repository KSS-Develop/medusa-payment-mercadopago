// Verificación de la firma de los webhooks de Mercado Pago (encabezado x-signature).
// https://www.mercadopago.cl/developers/es/docs/your-integrations/notifications/webhooks
// Plantilla firmada: "id:{data.id};request-id:{x-request-id};ts:{ts};" con HMAC-SHA256 y la clave secreta
// de la aplicación. Si data.id es alfanumérico va en minúsculas. Las partes ausentes se omiten.
import { createHmac, timingSafeEqual } from "node:crypto"

export type PartesFirma = { ts: string; v1: string }

export function leerFirma(encabezado: string | undefined): PartesFirma | null {
  if (!encabezado) return null
  let ts = ""
  let v1 = ""
  for (const parte of encabezado.split(",")) {
    const i = parte.indexOf("=")
    if (i < 0) continue
    const clave = parte.slice(0, i).trim()
    const valor = parte.slice(i + 1).trim()
    if (clave === "ts") ts = valor
    if (clave === "v1") v1 = valor
  }
  return ts && v1 ? { ts, v1 } : null
}

export function plantilla(dataId: string | undefined, requestId: string | undefined, ts: string): string {
  let s = ""
  if (dataId) s += `id:${/^[0-9]+$/.test(dataId) ? dataId : dataId.toLowerCase()};`
  if (requestId) s += `request-id:${requestId};`
  s += `ts:${ts};`
  return s
}

export function firmaValida(args: {
  secreto: string
  encabezado: string | undefined
  requestId: string | undefined
  dataId: string | undefined
}): boolean {
  const partes = leerFirma(args.encabezado)
  if (!partes) return false
  const esperado = createHmac("sha256", args.secreto)
    .update(plantilla(args.dataId, args.requestId, partes.ts))
    .digest("hex")
  const a = Buffer.from(esperado, "hex")
  const b = Buffer.from(partes.v1, "hex")
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}
