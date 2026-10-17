import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, get, post, setCsrf, setUnauthorizedHandler } from '../api/client'
import { EXPIRED_KEY, SessionGuard } from './SessionGuard'

export interface Me {
  id: string
  email: string
  full_name: string
  phone?: string
  role: 'admin' | 'dispatcher' | 'engineer' | 'manager' | 'client'
  organization: { id: string; name: string; kind: string }
  must_change_password: boolean
}
interface AuthState {
  me: Me | null
  loading: boolean
  login: (email: string, password: string) => Promise<Me>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}
const Ctx = createContext<AuthState>(null as any)
export const useAuth = () => useContext(Ctx)

function markExpired(ttlSeconds: number) {
  try { sessionStorage.setItem(EXPIRED_KEY, String(Math.round(ttlSeconds / 60))) } catch { /* без хранилища */ }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [idleTtl, setIdleTtl] = useState(600)
  const meRef = useRef<Me | null>(null); meRef.current = me
  const qc = useQueryClient()

  const refresh = useCallback(async () => {
    try {
      const r = await get('/auth/me')
      setCsrf(r.csrf_token)
      if (r.session?.idle_ttl_seconds) setIdleTtl(r.session.idle_ttl_seconds)
      setMe(r.user)
    } catch {
      setMe(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // сервер завершил сеанс, пока пользователь был внутри: запоминаем, чтобы страница входа объяснила причину
    setUnauthorizedHandler(() => { if (meRef.current) markExpired(idleTtl); setMe(null); qc.clear() })
    refresh()
  }, [refresh, qc])

  const login = async (email: string, password: string) => {
    const r = await api('POST', '/auth/login', { body: { email, password } })
    setCsrf(r.csrf_token)
    if (r.session?.idle_ttl_seconds) setIdleTtl(r.session.idle_ttl_seconds)
    setMe(r.user)
    return r.user as Me
  }
  const logout = async () => {
    try { await post('/auth/logout') } catch { /* ignore */ }
    setMe(null)
    qc.clear()
  }
  const expire = useCallback(() => { markExpired(idleTtl); void logout() }, [idleTtl]) // eslint-disable-line react-hooks/exhaustive-deps
  return <Ctx.Provider value={{ me, loading, login, logout, refresh }}>{children}{me && !me.must_change_password && <SessionGuard ttlSeconds={idleTtl} onExpire={expire} />}</Ctx.Provider>
}
