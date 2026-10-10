/**
 * Badge de status com tons semânticos.
 * tone: neutral | info | progress | success | warning | danger | accent
 */
const TONES = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-petrol-50 text-petrol-700 ring-petrol-100',
  progress: 'bg-accent-50 text-accent-800 ring-accent-100',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  accent: 'bg-accent-500 text-white ring-accent-500',
};

export default function StatusBadge({ tone = 'neutral', icon: Icon, children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset ${TONES[tone]} ${className}`}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      {children}
    </span>
  );
}
