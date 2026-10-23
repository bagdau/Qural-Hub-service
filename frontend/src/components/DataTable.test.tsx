import { render, screen } from '@testing-library/react'
import { DataTable } from './DataTable'
import { titleFor } from '../routes'

describe('DataTable', () => {
  const rows = [{ id: '1', name: 'КТП-160', qty: 3 }, { id: '2', name: 'ТМ-1000/10', qty: 5 }]
  it('подписывает ячейки для режима «карточки» на телефоне и скрывает подпись у колонки действий', () => {
    render(<DataTable rows={rows} rowKey={(r) => r.id} columns={[
      { header: 'Название', cell: (r) => r.name },
      { header: 'Количество', cell: (r) => r.qty },
      { header: '', bare: true, cell: () => <button>Открыть</button> },
    ]} />)
    expect(screen.getByText('КТП-160').closest('td')).toHaveAttribute('data-label', 'Название')
    expect(screen.getAllByText('3')[0].closest('td')).toHaveAttribute('data-label', 'Количество')
    const action = screen.getAllByRole('button', { name: 'Открыть' })[0].closest('td')!
    expect(action).not.toHaveAttribute('data-label')
    expect(action).toHaveClass('nolabel')
  })
  it('строка с обработчиком доступна с клавиатуры', () => {
    const open = vi.fn()
    render(<DataTable rows={rows} rowKey={(r) => r.id} onRowClick={open} columns={[{ header: 'Название', cell: (r) => r.name }]} />)
    const row = screen.getByText('ТМ-1000/10').closest('tr')!
    row.focus()
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(open).toHaveBeenCalledWith(rows[1])
  })
})

describe('titleFor', () => {
  it('подбирает заголовок вкладки по адресу, включая адреса с параметрами', () => {
    expect(titleFor('/equipment')).toBe('Оборудование · Qural Hub')
    expect(titleFor('/equipment/8c1d0b3e-0000-4000-8000-000000000001/qr')).toBe('QR-код оборудования · Qural Hub')
    expect(titleFor('/нет-такой')).toBe('Qural Hub')
  })
})
