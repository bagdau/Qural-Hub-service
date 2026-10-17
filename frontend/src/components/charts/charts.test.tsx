import { render, screen, fireEvent } from '@testing-library/react'
import { CountUp } from './CountUp'
import { Pie3D } from './Pie3D'
import { Columns3D } from './Columns3D'
import { Gauge } from './Gauge'

// «Уменьшить движение»: диаграммы сразу показывают итоговое состояние (так же ведут себя при отключённой анимации в системе)
beforeAll(() => {
  window.matchMedia = ((q: string) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null })) as any
})

describe('графики дашборда', () => {
  it('CountUp показывает точное итоговое значение и «—» при отсутствии данных', () => {
    const { rerender } = render(<CountUp value={85.7} format={(v) => `${v.toFixed(1)}%`} />)
    expect(screen.getByText('85.7%')).toBeInTheDocument()
    rerender(<CountUp value={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('Pie3D: секторы по значениям, легенда с процентами, выбор по нажатию и по клавиатуре', () => {
    const onSelect = vi.fn()
    const { container } = render(<Pie3D ariaLabel="Заявки по статусам" onSelect={onSelect}
      data={[{ key: 'new', label: 'Новая', value: 3, color: '#0ea5e9' }, { key: 'closed', label: 'Закрыта', value: 1, color: '#64748b' }, { key: 'x', label: 'Пусто', value: 0, color: '#999999' }]} />)
    expect(screen.getByRole('img', { name: 'Заявки по статусам' })).toBeInTheDocument()
    expect(container.querySelectorAll('.pslice')).toHaveLength(2)                // нулевое значение не рисуется
    const btn = screen.getByRole('button', { name: 'Новая: 3' })
    expect(btn).toHaveTextContent('75%')
    fireEvent.click(btn)
    expect(onSelect).toHaveBeenCalledWith('new')
    expect(screen.getByText('Всего')).toBeInTheDocument()
  })

  it('Pie3D: при отсутствии данных рисует пустой диск и не падает', () => {
    const { container } = render(<Pie3D ariaLabel="пусто" data={[{ key: 'a', label: 'A', value: 0, color: '#123456' }]} />)
    expect(container.querySelectorAll('.pslice')).toHaveLength(0)
    expect(container.querySelector('svg ellipse')).toBeTruthy()
  })

  it('Columns3D: колонки с подписями и текстовая альтернатива для дикторов', () => {
    const { container } = render(<Columns3D ariaLabel="Загрузка инженеров" unit=""
      data={[{ key: 'a', label: 'Инж. Демо-1', value: 3, ghost: 4, color: '#0d7a5f', note: '75%' }, { key: 'b', label: 'Инж. Демо-2', value: 4, ghost: 4, color: '#d92d20', note: '100%' }]} />)
    expect(container.querySelectorAll('.col3')).toHaveLength(2)
    expect(screen.getByText('Инж. Демо-1: 3 из 4, 75%')).toBeInTheDocument()
  })

  it('Gauge: подпись и значение ограничены диапазоном 0–100', () => {
    render(<Gauge value={250} color="#0d7a5f" label="Тест" />)
    expect(screen.getByRole('img', { name: 'Тест' })).toBeInTheDocument()
  })
})
