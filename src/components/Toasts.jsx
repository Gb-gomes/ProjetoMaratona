import { CircleCheck, CircleAlert, Info, TriangleAlert, X } from 'lucide-react';

const STYLE = {
  success: { icon: CircleCheck, cls: 'border-emerald-200 bg-white', ic: 'text-emerald-600' },
  error: { icon: CircleAlert, cls: 'border-red-200 bg-white', ic: 'text-red-600' },
  warning: { icon: TriangleAlert, cls: 'border-amber-200 bg-white', ic: 'text-amber-600' },
  info: { icon: Info, cls: 'border-petrol-100 bg-white', ic: 'text-petrol-500' },
};

/** Pilha de notificações. As mensagens são anunciadas por leitores de tela. */
export default function Toasts({ toasts, onDismiss }) {
  return (
    <div className="pointer-events-none fixed right-4 top-16 z-[2000] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2 max-lg:left-[max(0.75rem,env(safe-area-inset-left))] max-lg:right-[max(0.75rem,env(safe-area-inset-right))] max-lg:top-[calc(3.5rem+1px+env(safe-area-inset-top)+0.5rem)] max-lg:w-auto max-lg:max-w-none" aria-live="polite" role="status">
      {toasts.map((t, i) => {
        const s = STYLE[t.type] ?? STYLE.info;
        const Icon = s.icon;
        // Celular: só as 2 mais recentes, para não cobrir a tela.
        const older = i < toasts.length - 2 ? 'max-lg:hidden' : '';
        return (
          <div key={t.id} className={`pointer-events-auto flex items-start gap-2.5 rounded-md border px-3 py-2.5 shadow-lg ${s.cls} ${older}`}>
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${s.ic}`} aria-hidden="true" />
            <p className="flex-1 text-[13px] leading-snug text-petrol-900 max-lg:self-center max-lg:text-[14px]">{t.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 max-lg:-my-2 max-lg:-mr-2 max-lg:grid max-lg:h-11 max-lg:w-11 max-lg:place-items-center"
              aria-label="Fechar notificação"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
