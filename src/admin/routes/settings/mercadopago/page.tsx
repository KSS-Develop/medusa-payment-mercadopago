import { defineRouteConfig } from "@medusajs/admin-sdk"
import { CreditCard } from "@medusajs/icons"
import { Badge, Button, Container, Heading, Input, Label, Text } from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"

type Pais = { pais: string; conectada: boolean; conectable?: boolean; modo?: "oauth" | "propia" | null; webhook_url?: string; user_id?: string | null; live_mode?: boolean; expira_en?: string | null }

const NOMBRES: Record<string, string> = {
  AR: "Argentina", BR: "Brasil", CL: "Chile", CO: "Colombia", MX: "México", PE: "Perú", UY: "Uruguay",
}

// El admin de Medusa define __BACKEND_URL__ (vacío o "/" si se sirve desde el mismo backend).
declare const __BACKEND_URL__: string | undefined
const BASE = (typeof __BACKEND_URL__ === "string" ? __BACKEND_URL__ : "").replace(/\/$/, "")

const DOMINIOS: Record<string, string> = {
  AR: "com.ar", BR: "com.br", CL: "cl", CO: "com.co", MX: "com.mx", PE: "com.pe", UY: "com.uy",
}

// Guía para crear la aplicación propia en Mercado Pago y pegar sus llaves.
const Guia = ({ p, alGuardar }: { p: Pais; alGuardar: () => Promise<void> }) => {
  const [token, setToken] = useState("")
  const [secreto, setSecreto] = useState("")
  const [error, setError] = useState("")
  const [guardando, setGuardando] = useState(false)
  const panel = `https://www.mercadopago.${DOMINIOS[p.pais]}/developers/panel/app`
  const guardar = async () => {
    setGuardando(true)
    setError("")
    try {
      await pedir("/admin/mercadopago/propias", {
        method: "POST",
        body: JSON.stringify({ pais: p.pais, access_token: token, webhook_secret: secreto }),
      })
      setToken("")
      setSecreto("")
      await alGuardar()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGuardando(false)
    }
  }
  return (
    <div className="bg-ui-bg-subtle mt-3 rounded-md p-4">
      <ol className="text-ui-fg-subtle list-decimal space-y-1 pl-5 text-sm">
        <li>
          Entre a <a className="text-ui-fg-interactive" href={panel} target="_blank" rel="noreferrer">Mercado Pago Developers</a>{" "}
          con la cuenta de Mercado Pago de {NOMBRES[p.pais] ?? p.pais} que recibirá los pagos.
        </li>
        <li>«Crear aplicación» → Checkout Pro → tipo de API «Preferences» (en «Otros datos») → acepte y cree.</li>
        <li>En la aplicación, «Credenciales de producción»: copie el <b>Access Token</b> (empieza con APP_USR-).</li>
        <li>
          En «Webhooks» → «Configurar notificaciones», modo productivo: pegue esta URL, marque el evento <b>Pagos</b> y guarde:
          <div className="bg-ui-bg-base mt-1 select-all break-all rounded px-2 py-1 font-mono text-xs">{p.webhook_url}</div>
        </li>
        <li>Copie la <b>clave secreta</b> que aparece en Webhooks y pegue ambas aquí:</li>
      </ol>
      <div className="mt-3 grid gap-2">
        <Label size="small">Access Token de producción</Label>
        <Input type="password" placeholder="APP_USR-…" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        <Label size="small">Clave secreta de webhooks</Label>
        <Input type="password" value={secreto} onChange={(e) => setSecreto(e.target.value)} autoComplete="off" />
        {error && <Text size="small" className="text-ui-fg-error">{error}</Text>}
        <div>
          <Button size="small" isLoading={guardando} disabled={!token || !secreto} onClick={guardar}>
            Guardar y comprobar
          </Button>
        </div>
      </div>
    </div>
  )
}

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
  const [guia, setGuia] = useState<string | null>(null)
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
          Conecta la cuenta de Mercado Pago de cada país con un clic o con tu propia aplicación de Mercado Pago. Las llaves se guardan cifradas.
        </Text>
        {mensaje && <Text size="small" className="mt-2">{mensaje}</Text>}
      </div>
      {paises.map((p) => (
        <div key={p.pais} className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-x-3">
              <Text weight="plus">{NOMBRES[p.pais] ?? p.pais}</Text>
              {p.conectada ? (
                <Badge color="green">
                  {p.modo === "propia" ? "Aplicación propia" : "Conectada"}
                  {p.user_id ? ` · cuenta ${p.user_id}` : ""}
                  {p.live_mode === false ? " · prueba" : ""}
                </Badge>
              ) : (
                <Badge color="grey">Sin conectar</Badge>
              )}
            </div>
            <div className="flex items-center gap-x-2">
              {p.conectada ? (
                <Button variant="secondary" size="small" isLoading={ocupado === p.pais} disabled={!!ocupado} onClick={() => desconectar(p.pais)}>
                  Desconectar
                </Button>
              ) : (
                <>
                  <Button variant="secondary" size="small" onClick={() => setGuia(guia === p.pais ? null : p.pais)}>
                    {guia === p.pais ? "Cerrar" : "Usar mi aplicación"}
                  </Button>
                  {p.conectable && (
                    <Button size="small" isLoading={ocupado === p.pais} disabled={!!ocupado} onClick={() => conectar(p.pais)}>
                      Conectar con Mercado Pago
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
          {!p.conectada && guia === p.pais && (
            <Guia
              p={p}
              alGuardar={async () => {
                setGuia(null)
                setMensaje(`Mercado Pago ${NOMBRES[p.pais] ?? p.pais} configurado con su aplicación.`)
                await cargar()
              }}
            />
          )}
        </div>
      ))}
    </Container>
  )
}

export const config = defineRouteConfig({ label: "Mercado Pago", icon: CreditCard })

export default MercadoPagoPagina
