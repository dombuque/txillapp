import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { tr } from '../lib/i18n';
import Icon, { type IconName } from './Icon';

const KEY = 'txill_profile_nudge';
/** Dias até voltar a lembrar, depois de cada "agora não": cada vez mais espaçado (e deixa de aparecer quando o perfil chega aos 100%). */
const GAPS = [1, 3, 7, 14, 30];

function read(): { next: number; n: number } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { next?: number; n?: number };
    return { next: Number(v.next) || 0, n: Number(v.n) || 0 };
  } catch {
    return { next: 0, n: 0 };
  }
}

const STEPS: Record<string, { icon: IconName; label: () => string; to: string }> = {
  photo: { icon: 'camera', label: () => tr('Pôr uma foto de perfil'), to: '/profile?edit=1' },
  bio: { icon: 'pencil', label: () => tr('Escrever uma bio'), to: '/profile?edit=1' },
  post: { icon: 'plus', label: () => tr('Fazer o primeiro post'), to: '/new' },
  follow: { icon: 'user-plus', label: () => tr('Seguir 3 pessoas'), to: '/search' },
  geleira: { icon: 'cheers', label: () => tr('Encher a geleira (3 gostos)'), to: '/geleira' },
};

/**
 * Lembrete para completar o perfil (foto, bio, primeiro post, seguir malta, geleira): aparece de tempos em tempos
 * (cada vez mais espaçado) até o perfil estar a 100%. "Agora não" adia.
 */
export default function ProfileNudge() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['completeness'], queryFn: api.completeness, staleTime: 5 * 60_000, retry: false });
  const [hidden, setHidden] = useState(false);
  const d = q.data;
  if (!d || d.percent >= 100 || hidden || Date.now() < read().next) return null;
  const missing = d.steps.filter((s) => !s.done).slice(0, 3);

  function later() {
    const st = read();
    const gap = GAPS[Math.min(st.n, GAPS.length - 1)];
    try {
      localStorage.setItem(KEY, JSON.stringify({ n: st.n + 1, next: Date.now() + gap * 86_400_000 }));
    } catch {
      /* sem armazenamento: só esconde nesta sessão */
    }
    setHidden(true);
  }

  return (
    <section aria-label={tr('Completa o teu perfil')} className="mx-4 mb-4 rounded-[24px] bg-white p-4 shadow-[0_2px_16px_rgba(0,0,0,0.09)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[17px] font-extrabold leading-tight">{tr('Falta pouco, malta!')}</p>
          <p className="mt-0.5 text-sm text-zinc-600">{tr('O teu perfil está a {v0}%. A malta agradece quando o completas.', { v0: d.percent })}</p>
        </div>
        <button type="button" onClick={later} aria-label={tr('Agora não')} className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-500 active:bg-zinc-100"><Icon name="x" size={18} /></button>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100" role="progressbar" aria-valuenow={d.percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.max(6, d.percent)}%` }} />
      </div>
      <ul className="mt-3 space-y-2">
        {missing.map((s) => {
          const m = STEPS[s.id];
          return (
            <li key={s.id}>
              <button type="button" onClick={() => navigate(m.to)} className="flex h-12 w-full items-center gap-3 rounded-2xl bg-zinc-50 px-3.5 text-left font-semibold text-zinc-900 active:scale-[0.99]">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-brand shadow-sm"><Icon name={m.icon} size={17} /></span>
                <span className="flex-1">{m.label()}</span>
                <span className="text-xl text-zinc-400" aria-hidden>›</span>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={later} className="mt-2 w-full py-2 text-sm font-semibold text-zinc-500">{tr('Agora não')}</button>
    </section>
  );
}
