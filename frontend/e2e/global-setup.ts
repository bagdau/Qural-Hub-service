import { mkdirSync, writeFileSync } from 'node:fs'

export const USERS: Record<string, string> = {
  admin: 'admin@demo.alageum.test', dispatcher: 'dispatcher@demo.alageum.test', manager: 'manager@demo.alageum.test',
  eng1: 'engineer1@demo.alageum.test', eng2: 'engineer2@demo.alageum.test',
  cl1: 'client.metal@demo.alageum.test', cl2: 'client.agro@demo.alageum.test', cl3: 'client.logistics@demo.alageum.test',
}

/** Входим через API напрямую (минуя лимит входа Nginx) и сохраняем cookie сессии для каждой роли. */
export default async function globalSetup() {
  const api = process.env.API_URL ?? 'http://localhost:8000'
  const host = new URL(process.env.BASE_URL ?? 'http://localhost:8080').hostname
  const pw = process.env.E2E_PASSWORD
  if (!pw) throw new Error('Задайте E2E_PASSWORD (пароль demo-пользователей)')
  mkdirSync('./artifacts/.auth', { recursive: true })
  for (const [key, email] of Object.entries(USERS)) {
    const r = await fetch(`${api}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })
    if (!r.ok) throw new Error(`login ${email}: ${r.status} ${await r.text()}`)
    const m = /ash_session=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')
    if (!m) throw new Error('нет cookie сессии')
    writeFileSync(`./artifacts/.auth/${key}.json`, JSON.stringify({
      cookies: [{ name: 'ash_session', value: m[1], domain: host, path: '/', httpOnly: true, secure: false, sameSite: 'Lax', expires: -1 }], origins: [],
    }))
  }
}
