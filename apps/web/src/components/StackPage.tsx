import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BackIcon } from './icons';

/**
 * Página própria em ecrã inteiro (como a Atividade do Instagram): seta de voltar e título no topo,
 * sem a barra de navegação de baixo. Para ecrãs a que se "entra" e de onde se "volta".
 */
export default function StackPage({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto min-h-dvh max-w-xl bg-white pb-8">
      <header className="sticky top-0 z-10 flex items-center gap-1 border-b border-zinc-100 bg-white/95 px-2 py-2 backdrop-blur">
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/', { replace: true }))}
          aria-label="Voltar"
          className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-900 transition active:bg-zinc-100"
        >
          <BackIcon />
        </button>
        <h1 className="text-[20px] font-extrabold">{title}</h1>
      </header>
      {children}
    </div>
  );
}
