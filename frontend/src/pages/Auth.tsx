import { FormEvent, useState } from 'react'
import { DataTable } from '../components/DataTable'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { ApiError, del, get, post } from '../api/client'
import { Button, Empty, Field, Skeleton, errText, useToast } from '../components/ui'
import { fmtDateTime, ROLE } from '../lib/format'

export function LoginPage() {
  const { me, login, loading } = useAuth()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!loading && me && !me.must_change_password) return <Navigate to={safeNext(sp.get('next'))} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const u = await login(email.trim(), password)
      nav(u.must_change_password ? '/change-password' : safeNext(sp.get('next')), { replace: true })
    } catch (ex) {
      if (ex instanceof ApiError && ex.code === 'ACCOUNT_LOCKED') {
        setErr(`Вход временно заблокирован${ex.details?.locked_until ? ' до ' + fmtDateTime(ex.details.locked_until) : ''}.`)
      } else setErr(errText(ex))
    } finally { setBusy(false) }
  }
  return (
    <div className="login-wrap">
      <form className="card login-card stack" onSubmit={submit} aria-labelledby="t">
        <div><h1 id="t">Alageum Service Hub</h1><p className="muted" style={{ margin: 0 }}>Учёт оборудования и сервисное обслуживание</p></div>
        {err && <div className="banner err" role="alert">{err}</div>}
        <Field label="Email"><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Пароль"><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button variant="primary" type="submit" loading={busy} style={{ width: '100%' }}>Войти</Button>
        <p className="hint">Регистрация недоступна. Учётную запись выдаёт администратор.</p>
      </form>
    </div>
  )
}
const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/')

export function ChangePasswordPage() {
  const { me, refresh, loading } = useAuth()
  const nav = useNavigate()
  const toast = useToast()
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('')
  const [errs, setErrs] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false)
  if (loading) return null
  if (!me) return <Navigate to="/login" replace />
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (pw !== pw2) { setErrs({ new_password2: 'Пароли не совпадают.' }); return }
    setBusy(true); setErrs({})
    try {
      await post('/auth/change-password', { current_password: cur, new_password: pw })
      toast('Пароль изменён.'); await refresh(); nav('/', { replace: true })
    } catch (ex) {
      if (ex instanceof ApiError) setErrs({ ...ex.fieldErrors(), ...(ex.status === 401 ? { current_password: ex.message } : {}) })
      else toast(errText(ex), true)
    } finally { setBusy(false) }
  }
  return (
    <div className="login-wrap">
      <form className="card login-card stack" onSubmit={submit}>
        <h1>{me.must_change_password ? 'Смена временного пароля' : 'Смена пароля'}</h1>
        {me.must_change_password && <div className="banner info">Для продолжения работы задайте собственный пароль.</div>}
        <Field label="Текущий (временный) пароль" error={errs.current_password}><input type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="Новый пароль" error={errs.new_password} hint="Не менее 12 символов."><input type="password" autoComplete="new-password" required minLength={12} value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="Повторите новый пароль" error={errs.new_password2}><input type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        <Button variant="primary" type="submit" loading={busy}>Сохранить пароль</Button>
      </form>
    </div>
  )
}

export function ProfilePage() {
  const { me, logout } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => get('/auth/sessions') })
  const revoke = useMutation({ mutationFn: (id: string) => del(`/auth/sessions/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['sessions'] }); toast('Сессия завершена.') } })
  const nav = useNavigate()
  if (!me) return null
  return (
    <div className="stack">
      <h1>Профиль</h1>
      <div className="card">
        <div className="grid cols-2">
          <div><div className="muted small">ФИО</div>{me.full_name}</div>
          <div><div className="muted small">Роль</div>{ROLE[me.role]}</div>
          <div><div className="muted small">Email</div>{me.email}</div>
          <div><div className="muted small">Организация</div>{me.organization.name}</div>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <Button onClick={() => nav('/change-password')}>Сменить пароль</Button>
          <Button onClick={logout}>Выйти</Button>
        </div>
      </div>
      <div className="card">
        <h2>Активные сессии</h2>
        {sessions.isLoading ? <Skeleton /> : !sessions.data?.length ? <Empty title="Нет активных сессий" /> : (
          <DataTable bare rows={sessions.data} rowKey={(s: any) => s.id} columns={[
            { header: 'Начало', cell: (s: any) => fmtDateTime(s.created_at) },
            { header: 'Последняя активность', cell: (s: any) => fmtDateTime(s.last_seen_at) },
            { header: 'Устройство', className: 'small', cell: (s: any) => <>{s.user_agent?.slice(0, 60)}{s.is_current && ' (это устройство)'}</> },
            { header: '', bare: true, cell: (s: any) => !s.is_current && <Button small onClick={() => revoke.mutate(s.id)}>Завершить</Button> },
          ]} />
        )}
      </div>
    </div>
  )
}
