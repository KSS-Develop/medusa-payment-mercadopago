import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CreditCard } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"

type Pais = { pais: string; conectada: boolean; conectable?: boolean; user_id?: string | null; live_mode?: boolean; expira_en?: string | null }

const NOMBRES: Record<string, string> = {
  AR: "Argentina", BR: "Brasil", CL: "Chile", CO: "Colombia", MX: "México", PE: "Perú", UY: "Uruguay",
}

// El admin de Medusa define __BACKEND_URL__ (vacío o "/" si se sirve desde el mismo backend).
declare const __BACKEND_URL__: string | undefined
const BASE = (typeof __BACKEND_URL__ === "string" ? __BACKEND_URL__ : "").replace(/\/$/, "")

const pedir = async (ruta: string, init?: RequestInit) => {
  const r = await fetch(BASE + ruta, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init })
  const b = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(b.message || `error ${r.status}`)
  return b
}

// «Mercado Pago» en Configuración: conecta la cuenta de cada país con un clic, sin copiar llaves.
const MercadoPagoPagina = () => {
  const [paises, setPaises] = useState<Pais[]>([])
  const [mensaje, setMensaje] = useState("")
  const [ocupado, setOcupado] = useState<string | null>(null)
  const canjeado = useRef(false)

  const cargar = () => pedir("/admin/mercadopago").then((b) => setPaises(b.paises)).catch((e) => setMensaje(e.message))

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const estado = q.get("mp_estado")
    const sobre = q.get("mp_sobre")
    const error = q.get("mp_error")
    const limpiar = () => window.history.replaceState(null, "", window.location.pathname)
    if (estado && sobre) {
      if (canjeado.current) return
      canjeado.current = true
      setOcupado("canje")
      pedir("/admin/mercadopago/canje", {
        method: "POST",
        body: JSON.stringify({ estado, sobre }),
      })
        .then((b) => setMensaje(`Mercado Pago ${NOMBRES[b.conexion.pais] ?? b.conexion.pais} conectado.`))
        .catch((e) => setMensaje(e.message))
        .finally(() => {
          limpiar()
          setOcupado(null)
          cargar()
        })
    } else {
      if (error) {
        setMensaje(`Mercado Pago no autorizó la conexión (${error}).`)
        limpiar()
      }
      cargar()
    }
  }, [])

  const conectar = async (pais: string) => {
    setOcupado(pais)
    setMensaje("")
    try {
      const b = await pedir("/admin/mercadopago", {
        method: "POST",
        body: JSON.stringify({ pais, vuelta: window.location.origin + window.location.pathname }),
      })
      window.location.assign(b.url)
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : String(e))
      setOcupado(null)
    }
  }

  const desconectar = async (pais: string) => {
    if (!window.confirm(`¿Desconectar Mercado Pago ${NOMBRES[pais] ?? pais}? Los pagos de ese país dejarán de funcionar.`)) return
    setOcupado(pais)
    try {
      await pedir(`/admin/mercadopago/${pais}`, { method: "DELETE" })
      await cargar()
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : String(e))
    } finally {
      setOcupado(null)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading level="h1">Mercado Pago</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Conecta la cuenta de Mercado Pago de cada país con un clic. Las llaves se guardan cifradas y se renuevan solas.
        </Text>
        {mensaje && <Text size="small" className="mt-2">{mensaje}</Text>}
      </div>
      {paises.map((p) => (
        <div key={p.pais} className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-x-3">
            <Text weight="plus">{NOMBRES[p.pais] ?? p.pais}</Text>
            {p.conectada ? (
              <Badge color="green">Conectada{p.user_id ? ` · cuenta ${p.user_id}` : ""}{p.live_mode === false ? " · prueba" : ""}</Badge>
            ) : (
              <Badge color="grey">Sin conectar</Badge>
            )}
          </div>
          {p.conectada ? (
            <Button variant="secondary" size="small" isLoading={ocupado === p.pais} disabled={!!ocupado} onClick={() => desconectar(p.pais)}>
              Desconectar
            </Button>
          ) : p.conectable ? (
            <Button size="small" isLoading={ocupado === p.pais} disabled={!!ocupado} onClick={() => conectar(p.pais)}>
              Conectar con Mercado Pago
            </Button>
          ) : (
            <Text size="small" className="text-ui-fg-subtle">Usa llaves propias en medusa-config (access_token)</Text>
          )}
        </div>
      ))}
    </Container>
  )
}

export const config = defineRouteConfig({ label: "Mercado Pago", icon: CreditCard })

export default MercadoPagoPagina
