/** Логотип Alageum Service Hub: белое кольцо и ветроустановка на красном поле (вектор, чёткий в любом размере) */
export function Logo({ size = 38, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Alageum Service Hub">
      <rect width="100" height="100" rx="22" fill="#D91C2B" />
      <circle cx="50" cy="50" r="42.2" fill="none" stroke="#fff" strokeWidth="3.6" />
      <path d="M23.4 22.7C33 29.2 42 33.8 50 34.6C58 33.8 67 29.2 76.6 22.7C66 27.6 58 32.2 50 38.2C42 32.2 34 27.6 23.4 22.7Z" fill="#fff" />
      <path d="M49.2 37H50.8L53.6 89.5H46.4Z" fill="#fff" />
    </svg>
  )
}
