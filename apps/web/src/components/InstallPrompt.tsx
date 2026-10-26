import { useInstall } from '../lib/install';

const Share = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="inline align-[-4px]">
    <path d="M12 15V3M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </svg>
);
const PlusSquare = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="inline align-[-4px]">
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);

/**
 * Convite para instalar a app, no sítio onde a pessoa está (sem ter de procurar menus):
 *  • Android/Chrome: botão "Instalar" que abre o pedido do sistema;
 *  • iPhone/Safari: passos curtos (a Apple não deixa instalar com um botão);
 *  • iPhone noutro browser: pede para abrir no Safari.
 * Some quando já está instalada e volta só passados 7 dias se for dispensado.
 */
export default function InstallPrompt({ className = 'bottom-24' }: { className?: string }) {
  const { installed, canPrompt, iosHint, iosOpenInSafari, snoozed, install, snooze } = useInstall();
  if (installed || snoozed || !(canPrompt || iosHint || iosOpenInSafari)) return null;

  return (
    <aside
      role="region"
      aria-label="Instalar a app"
      className={`pointer-events-auto fixed inset-x-3 z-30 mx-auto max-w-md rounded-3xl bg-zinc-900 p-4 text-white shadow-[0_8px_32px_rgba(0,0,0,0.35)] ${className}`}
    >
      <div className="flex items-start gap-3">
        <img src="/icon-192.png" alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-2xl" />
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-bold leading-tight">Instala o Txillapp 📲</p>
          {canPrompt && <p className="mt-0.5 text-sm text-zinc-300">Ecrã inteiro, mais rápido e com o ícone no telemóvel.</p>}
          {iosHint && (
            <p className="mt-1 text-sm leading-relaxed text-zinc-200">
              Toca em <b>Partilhar</b> <Share /> e depois em <b>Adicionar ao ecrã principal</b> <PlusSquare />.
            </p>
          )}
          {iosOpenInSafari && <p className="mt-0.5 text-sm text-zinc-300">Para instalar no iPhone, abre este endereço no <b>Safari</b>.</p>}
        </div>
        <button onClick={snooze} aria-label="Agora não" className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl text-zinc-400 active:bg-white/10">
          ×
        </button>
      </div>
      {canPrompt && (
        <button onClick={install} className="mt-3 h-12 w-full rounded-full bg-brand text-[17px] font-bold active:scale-[0.98]">
          Instalar
        </button>
      )}
      {iosHint && (
        <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-zinc-400">
          A seta de Partilhar fica em baixo no ecrã <span aria-hidden>👇</span>
        </p>
      )}
    </aside>
  );
}
