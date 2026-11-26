import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { MERCADOPAGO_CONEXION } from "../../../modules/mercadopago-conexion"
import type MercadoPagoConexionService from "../../../modules/mercadopago-conexion/service"
import { PAISES, esPais } from "../../../lib/pais"
import { origenBackend, urlWebhook } from "../../../lib/origen"

// Estado de las conexiones por país (sin llaves).
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const s = req.scope.resolve<MercadoPagoConexionService>(MERCADOPAGO_CONEXION)
  const [estados, conectables] = await Promise.all([s.estados(), s.conectables()])
  res.json({
    paises: Object.keys(PAISES).map((pais) => ({
      ...(estados.find((e) => e.pais === pais) ?? { pais, conectada: false }),
      conectable: conectables.includes(pais),
      // Para la guía de la aplicación propia: la URL que se pega en Webhooks del panel de Mercado Pago.
      webhook_url: urlWebhook(origenBackend(req), pais),
    })),
  })
}

// Inicia «Conectar con Mercado Pago»: devuelve la URL del intermediario (que muestra a qué tienda se conecta).
export const POST = async (req: MedusaRequest<{ pais?: unknown; vuelta?: unknown }>, res: MedusaResponse) => {
  const { pais, vuelta } = req.body ?? {}
  if (typeof pais !== "string" || !esPais(pais.toUpperCase()) || typeof vuelta !== "string" || !URL.canParse(vuelta)) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "pais o vuelta inválidos")
  }
  const s = req.scope.resolve<MercadoPagoConexionService>(MERCADOPAGO_CONEXION)
  res.json({ url: await s.iniciar(pais.toUpperCase(), vuelta) })
}
