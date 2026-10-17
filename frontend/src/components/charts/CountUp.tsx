import { useCountUp } from './anim'

/** Число, которое плавно «набегает» до значения. format получает текущее значение и возвращает текст. */
export function CountUp({ value, format = (v) => String(Math.round(v)), placeholder = '—', ms }: { value: number | null | undefined; format?: (v: number) => string; placeholder?: string; ms?: number }) {
  const v = useCountUp(value, ms)
  return <>{v == null ? placeholder : format(v)}</>
}
