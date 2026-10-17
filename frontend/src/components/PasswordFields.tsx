import { useState } from 'react'
import { Button, Field, useToast } from './ui'
import { Icon } from './Icon'

/** Случайный пароль 14 символов: заглавные, строчные и цифры без похожих знаков (l, I, O, 0, 1) */
export function genPassword(): string {
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnpqrstuvwxyz', D = '23456789'
  const all = U + L + D
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length]
  const chars = [pick(U), pick(L), pick(D), ...Array.from({ length: 11 }, () => pick(all))]
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]] }
  return chars.join('')
}

/** Поле пароля для администратора: ввод своего пароля, «Сгенерировать», показ/скрытие, копирование и флажок «сменить при первом входе» */
export function PasswordFields({ value, onChange, mustChange, onMustChange, error, label = 'Пароль', hint }: {
  value: string; onChange: (v: string) => void; mustChange: boolean; onMustChange: (v: boolean) => void; error?: string; label?: string; hint?: string
}) {
  const [show, setShow] = useState(false)
  const toast = useToast()
  const short = value.length > 0 && value.length < 12
  return (
    <div className="stack">
      <Field label={label} error={error ?? (short ? 'Минимум 12 символов.' : undefined)} hint={hint ?? 'Минимум 12 символов. Каждому пользователю можно задать свой пароль.'}>
        <input type={show ? 'text' : 'password'} autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} />
      </Field>
      <div className="row">
        <Button type="button" small onClick={() => { onChange(genPassword()); setShow(true) }}>Сгенерировать</Button>
        <Button type="button" small onClick={() => setShow(!show)} aria-pressed={show}><Icon name={show ? 'eye-off' : 'eye'} size={16} /> {show ? 'Скрыть' : 'Показать'}</Button>
        <Button type="button" small disabled={!value} onClick={() => { navigator.clipboard?.writeText(value); toast('Пароль скопирован.') }}>Копировать</Button>
      </div>
      <label className="row small" style={{ flexWrap: 'nowrap' }}>
        <input type="checkbox" checked={mustChange} onChange={(e) => onMustChange(e.target.checked)} /> Потребовать смену пароля при первом входе
      </label>
    </div>
  )
}
