import { Icon } from './Icon'

/** Квадратная кнопка-значок с подсказкой и доступным именем (для строк таблиц) */
export function IconButton({ icon, label, onClick, tone, disabled }: { icon: string; label: string; onClick: () => void; tone?: 'danger'; disabled?: boolean }) {
  return (
    <button type="button" className={`ibtn ${tone ?? ''}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={18} />
    </button>
  )
}
