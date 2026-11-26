// Cifrado de las llaves guardadas en la base de datos (AES-256-GCM).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

export function claveDesde(secreto: string): Buffer {
  return createHash("sha256").update(secreto).digest()
}

export function cifrar(clave: Buffer, texto: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", clave, iv)
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()])
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), datos.toString("base64url")].join(".")
}

export function descifrar(clave: Buffer, sobre: string): string {
  const [v, iv, tag, datos] = sobre.split(".")
  if (v !== "v1" || !iv || !tag || !datos) throw new Error("formato de cifrado desconocido")
  const d = createDecipheriv("aes-256-gcm", clave, Buffer.from(iv, "base64url"))
  d.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([d.update(Buffer.from(datos, "base64url")), d.final()]).toString("utf8")
}
