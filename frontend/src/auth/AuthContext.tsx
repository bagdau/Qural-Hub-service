import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, get, post, setCsrf, setUnauthorizedHandler } from '../api/client'

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const qc = useQueryClient()

  const refresh = useCallback(async () => {
    try {
      const r = await get('/auth/me')
      setCsrf(r.csrf_token)
      setMe(r.user)
    } catch {
      setMe(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => { setMe(null); qc.clear() })
    refresh()
  }, [refresh, qc])

  const login = async (email: string, password: string) => {
    const r = await api('POST', '/auth/login', { body: { email, password } })
    setCsrf(r.csrf_token)
    setMe(r.user)
    return r.user as Me
  }
  const logout = async () => {
    try { await post('/auth/logout') } catch { /* ignore */ }
    setMe(null)
    qc.clear()
  }
  return <Ctx.Provider value={{ me, loading, login, logout, refresh }}>{children}</Ctx.Provider>
}
