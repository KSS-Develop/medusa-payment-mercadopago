// Intermediario OAuth de Mercado Pago para tiendas Medusa con @ia-erp/medusa-payment-mercadopago.
//
// 1. GET  /inicio?pais&vuelta&estado&desafio  → página que muestra a qué tienda se conectará la cuenta; al
//    POST /inicio (confirmación)                  confirmar, redirige a la autorización de Mercado Pago del país.
// 2. GET  /vuelta?code&state                  → canjea el código con el client_secret de IA ERP y vuelve a la tienda
//                                               con las llaves cifradas (sólo este Worker las puede descifrar).
// 3. POST /canje {sobre, verificador}         → la tienda (servidor a servidor) entrega el verificador cuyo SHA-256 es
//                                               el desafío del paso 1 y recibe sus llaves.
// 4. POST /renovar {pais, refresh_token, sello} → renueva el access_token (vence a los 180 días). El sello
//                                               (HMAC entregado en /canje) impide renovar con un refresh_token ajeno.
// Sin almacenamiento: todo lo que viaja por el navegador va cifrado con AES-GCM y con vencimiento.

export interface Env {
  ORIGEN: string
  RUTA: string
  MP_APPS: string
  CLAVE_ESTADO: string
}

const PAISES: Record<string, string> = {
  AR: "com.ar", BR: "com.br", CL: "cl", CO: "com.co", MX: "com.mx", PE: "com.pe", UY: "com.uy",
}

type App = { id: string; secret: string }
type Estado = { p: string; v: string; e: string; d: string; x: number; n?: string }
type Sobre = { t: Record<string, unknown>; d: string; x: number }

const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const deB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))

// Dos claves derivadas de CLAVE_ESTADO: una para cifrar y otra para sellar.
async function derivada(env: Env, uso: string): Promise<ArrayBuffer> {
  const base = deB64u(env.CLAVE_ESTADO)
  const datos = new Uint8Array(base.length + uso.length + 1)
  datos.set(new TextEncoder().encode(uso + ":"), 0)
  datos.set(base, uso.length + 1)
  return crypto.subtle.digest("SHA-256", datos)
}
async function clave(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", await derivada(env, "aes"), "AES-GCM", false, ["encrypt", "decrypt"])
}
async function cifrar(env: Env, datos: unknown, uso: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const c = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(uso) },
    await clave(env),
    new TextEncoder().encode(JSON.stringify(datos))
  )
  return b64u(iv) + "." + b64u(c)
}
async function descifrar<T>(env: Env, texto: string, uso: string): Promise<T | null> {
  try {
    const [iv, c] = texto.split(".")
    const p = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: deB64u(iv), additionalData: new TextEncoder().encode(uso) },
      await clave(env),
      deB64u(c)
    )
    return JSON.parse(new TextDecoder().decode(p)) as T
  } catch {
    return null
  }
}
async function sha256(texto: string): Promise<string> {
  return b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)))
}
async function sello(env: Env, refresh: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", await derivada(env, "hmac"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return b64u(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode("renovar:" + refresh)))
}
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const NOMBRES: Record<string, string> = {
  AR: "Argentina", BR: "Brasil", CL: "Chile", CO: "Colombia", MX: "México", PE: "Perú", UY: "Uruguay",
}
function confirmacion(pais: string, host: string, token: string, accion: string, nonce: string): Response {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conectar Mercado Pago</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a}
.t{font-size:1.1rem;background:#f4f4f5;border-radius:.5rem;padding:.75rem 1rem;word-break:break-all}button{background:#009ee3;color:#fff;border:0;border-radius:.5rem;padding:.75rem 1.25rem;font-size:1rem;cursor:pointer}
small{color:#666}</style></head><body><h1>Conectar Mercado Pago ${esc(NOMBRES[pais] ?? pais)}</h1>
<p>Vas a conectar tu cuenta de Mercado Pago con esta tienda, que podrá cobrar y reembolsar en tu nombre:</p><p class="t"><b>${esc(host)}</b></p>
<p>Continúa sólo si iniciaste esto desde el panel de administración de <b>${esc(host)}</b>. Si alguien te envió este enlace, ciérralo.</p>
<form method="post" action="${esc(accion)}"><input type="hidden" name="t" value="${esc(token)}"><button>Continuar a Mercado Pago</button></form>
<p><small>Conexión ofrecida por IA ERP para el plugin @ia-erp/medusa-payment-mercadopago.</small></p></body></html>`
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY",
      // Ata la confirmación al navegador que vio esta página: el POST exige la misma cookie.
      "set-cookie": `mp_conf=${nonce}; Path=/mercadopago/oauth; Max-Age=900; HttpOnly; Secure; SameSite=Strict`,
            "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'`,
    },
  })
}

// Una aplicación por país: Mercado Pago no deja cobrar con una cuenta conectada a una aplicación de otro país
// («A conta do vendedor é de outro país»).
function app(env: Env, pais: string): App | null {
  const apps = JSON.parse(env.MP_APPS) as Record<string, App>
  return PAISES[pais] ? apps[pais] ?? null : null
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })

// La tienda sólo puede pedir volver a una URL https (o localhost en desarrollo).
function vueltaValida(v: string): boolean {
  try {
    const u = new URL(v)
    return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))
  } catch {
    return false
  }
}

async function tokenMp(cuerpo: Record<string, string>): Promise<Response> {
  return fetch("https://api.mercadopago.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(cuerpo),
  })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const ruta = url.pathname.startsWith(env.RUTA) ? url.pathname.slice(env.RUTA.length) : url.pathname
    const vuelta = `${env.ORIGEN}${env.RUTA}/vuelta`

    if (req.method === "GET" && ruta === "/paises") {
      const apps = JSON.parse(env.MP_APPS) as Record<string, App>
      return json({ paises: Object.keys(PAISES).filter((p) => apps[p]) })
    }

    if (req.method === "GET" && ruta === "/inicio") {
      const pais = (url.searchParams.get("pais") ?? "").toUpperCase()
      const v = url.searchParams.get("vuelta") ?? ""
      const e = url.searchParams.get("estado") ?? ""
      const d = url.searchParams.get("desafio") ?? ""
      const a = app(env, pais)
      if (!PAISES[pais] || !a || !vueltaValida(v) || e.length < 16 || d.length < 32) {
        return json({ error: "parametros_invalidos" }, 400)
      }
      const n = b64u(crypto.getRandomValues(new Uint8Array(18)))
      const t = await cifrar(env, { p: pais, v, e, d, n, x: Date.now() + 15 * 60_000 } satisfies Estado, "confirmar")
      return confirmacion(pais, new URL(v).host, t, `${env.ORIGEN}${env.RUTA}/inicio`, n)
    }

    if (req.method === "POST" && ruta === "/inicio") {
      const sitio = req.headers.get("sec-fetch-site")
      if (sitio && sitio !== "same-origin") return json({ error: "confirmacion_desde_otro_sitio" }, 403)
      const form = await req.formData().catch(() => null)
      const c = await descifrar<Estado>(env, String(form?.get("t") ?? ""), "confirmar")
      const cookie = /(?:^|;\s*)mp_conf=([A-Za-z0-9_-]+)/.exec(req.headers.get("cookie") ?? "")?.[1]
      const a = c ? app(env, c.p) : null
      if (!c || c.x < Date.now() || !a || !c.n || !cookie || !iguales(cookie, c.n)) {
        return json({ error: "confirmacion_invalida_o_vencida" }, 400)
      }
      const pais = c.p
      const state = await cifrar(env, { ...c, x: Date.now() + 15 * 60_000 } satisfies Estado, "estado")
      const auth = new URL(`https://auth.mercadopago.${PAISES[pais]}/authorization`)
      auth.searchParams.set("client_id", a.id)
      auth.searchParams.set("response_type", "code")
      auth.searchParams.set("platform_id", "mp")
      auth.searchParams.set("state", state)
      auth.searchParams.set("redirect_uri", vuelta)
      return Response.redirect(auth.toString(), 302)
    }

    if (req.method === "GET" && ruta === "/vuelta") {
      const st = await descifrar<Estado>(env, url.searchParams.get("state") ?? "", "estado")
      if (!st || st.x < Date.now()) return json({ error: "estado_invalido_o_vencido" }, 400)
      const destino = new URL(st.v)
      destino.searchParams.set("mp_estado", st.e)
      const code = url.searchParams.get("code")
      const a = app(env, st.p)
      if (!code || !a) {
        destino.searchParams.set("mp_error", url.searchParams.get("error") ?? "sin_codigo")
        return Response.redirect(destino.toString(), 302)
      }
      const r = await tokenMp({
        client_id: a.id, client_secret: a.secret, grant_type: "authorization_code", code, redirect_uri: vuelta,
      })
      const t = (await r.json()) as Record<string, unknown>
      if (!r.ok || typeof t.access_token !== "string") {
        destino.searchParams.set("mp_error", String(t.error ?? t.message ?? "canje_fallido"))
        return Response.redirect(destino.toString(), 302)
      }
      const sobre = await cifrar(env, {
        t: {
          pais: st.p, access_token: t.access_token, refresh_token: t.refresh_token, public_key: t.public_key,
          user_id: t.user_id, expires_in: t.expires_in, live_mode: t.live_mode, scope: t.scope,
        },
        d: st.d,
        x: Date.now() + 10 * 60_000,
      } satisfies Sobre, "sobre")
      destino.searchParams.set("mp_sobre", sobre)
      return Response.redirect(destino.toString(), 302)
    }

    if (req.method === "POST" && ruta === "/canje") {
      const b = (await req.json().catch(() => ({}))) as { sobre?: string; verificador?: string }
      const s = b.sobre ? await descifrar<Sobre>(env, b.sobre, "sobre") : null
      if (!s || s.x < Date.now()) return json({ error: "sobre_invalido_o_vencido" }, 400)
      if (!b.verificador || !iguales(await sha256(b.verificador), s.d)) return json({ error: "verificador_incorrecto" }, 403)
      const rt = s.t.refresh_token
      return json({ ...s.t, sello: typeof rt === "string" ? await sello(env, rt) : undefined })
    }

    if (req.method === "POST" && ruta === "/renovar") {
      const b = (await req.json().catch(() => ({}))) as { pais?: string; refresh_token?: string; sello?: string }
      const a = app(env, (b.pais ?? "").toUpperCase())
      if (!a || typeof b.refresh_token !== "string" || typeof b.sello !== "string") return json({ error: "parametros_invalidos" }, 400)
      if (!iguales(await sello(env, b.refresh_token), b.sello)) return json({ error: "sello_incorrecto" }, 403)
      const r = await tokenMp({ client_id: a.id, client_secret: a.secret, grant_type: "refresh_token", refresh_token: b.refresh_token })
      const t = (await r.json()) as Record<string, unknown>
      if (!r.ok) return json({ error: t.error ?? "renovacion_fallida" }, 502)
      return json({
        access_token: t.access_token, refresh_token: t.refresh_token, public_key: t.public_key,
        user_id: t.user_id, expires_in: t.expires_in, live_mode: t.live_mode,
        sello: typeof t.refresh_token === "string" ? await sello(env, t.refresh_token) : undefined,
      })
    }

    return json({ error: "no_encontrado" }, 404)
  },
}
