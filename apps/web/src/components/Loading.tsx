import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Wordmark } from './ui';

/**
 * O carregamento do Txillapp: o ponto do "i" do logótipo a saltar como uma bola. Mesmo gesto em todo o lado,
 * só muda o tamanho. `size` é o diâmetro do ponto em px.
 */
export function PontoLoader({ size = 18, label = 'A carregar', className = '' }: { size?: number; label?: string; className?: string }) {
  return (
    <span role="status" aria-label={label} className={`relative inline-flex items-end justify-center ${className}`} style={{ fontSize: size, width: '1.6em', height: '2.4em' }}>
      <span className="ponto-sombra" aria-hidden />
      <span className="ponto" aria-hidden />
    </span>
  );
}

/** Bloco de carregamento no meio de uma lista ou de um ecrã (em vez de um texto "A carregar…"). */
export function LoadingBlock({ label = 'A carregar', className = 'py-10' }: { label?: string; className?: string }) {
  return (
    <div className={`flex justify-center ${className}`}>
      <PontoLoader size={20} label={label} />
    </div>
  );
}

/** Ecrã inteiro: o logótipo com o ponto do "i" a saltar. */
export function BrandLoader({ message }: { message?: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-white" aria-busy="true">
      <Wordmark className="h-14" loading />
      <p role="status" className="text-zinc-500">{message ?? 'A carregar a vibe…'}</p>
    </main>
  );
}

/**
 * Barra fina e coral no topo, acesa sempre que a app está a pedir ou a enviar alguma coisa ao servidor.
 * Só aparece se demorar mais de meio segundo, para não piscar em pedidos rápidos.
 */
export function TopLoader() {
  const busy = useIsFetching() + useIsMutating() > 0;
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!busy) return setShow(false);
    const t = setTimeout(() => setShow(true), 500);
    return () => clearTimeout(t);
  }, [busy]);
  if (!show) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden" role="progressbar" aria-label="A carregar" aria-busy="true">
      <div className="h-full w-2/5 rounded-full bg-brand" style={{ animation: 'barra 1.1s ease-in-out infinite' }} />
    </div>
  );
}

/** Esqueleto de uma publicação do feed. */
export function PostSkeleton() {
  return (
    <div className="mx-4 mb-6 rounded-[28px] bg-white p-5 shadow-[0_2px_16px_rgba(0,0,0,0.09)]" aria-hidden>
      <div className="flex items-center gap-3">
        <div className="skel h-[52px] w-[52px] rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="skel h-4 w-1/2 rounded-full" />
          <div className="skel h-3 w-1/3 rounded-full" />
        </div>
      </div>
      <div className="skel mt-5 h-4 w-3/4 rounded-full" />
      <div className="skel mt-4 h-40 rounded-xl" />
    </div>
  );
}

/** Esqueleto de linhas com avatar (listas de pessoas, notificações, mensagens). */
export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="px-4 py-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 py-2.5">
          <span className="skel h-12 w-12 shrink-0 rounded-full" />
          <span className="flex-1 space-y-2">
            <span className="skel block h-3.5 w-2/3 rounded-full" />
            <span className="skel block h-3 w-1/3 rounded-full" />
          </span>
        </li>
      ))}
    </ul>
  );
}
