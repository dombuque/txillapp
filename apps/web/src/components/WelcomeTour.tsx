import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tr } from '../lib/i18n';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import Icon, { type IconName } from './Icon';
import { btnPrimary } from './ui';

interface Step {
  /** Valor de data-tour do elemento a destacar; sem ele, o cartão aparece sozinho. */
  target?: string;
  icon: IconName;
  title: string;
  text: string;
}

const STEPS: Step[] = [
  { icon: 'sparkles', title: 'Bem-vindo ao Txillapp', text: 'Dois minutos e já sabes onde está tudo. Podes saltar quando quiseres.' },
  { target: 'home', icon: 'home', title: 'Início', text: 'O feed da malta e dos sítios onde andam. Toca outra vez no ícone para voltar ao topo e atualizar.' },
  { target: 'search', icon: 'search', title: 'Pesquisar', text: 'Aqui no canto de cima: procura pessoas, hashtags e sítios a bater perto de ti.' },
  { target: 'new', icon: 'plus', title: 'Publicar', text: 'Foto, vídeo ou só texto, com sítio e malta identificada. A tua vibe, tu mandas.' },
  { target: 'messages', icon: 'send', title: 'Mensagens', text: 'Conversas, grupos e notas de 24 horas. Manda fotos, voz, stickers e a tua localização.' },
  { target: 'reels', icon: 'film', title: 'Reels', text: 'Vídeos curtos a tocar sem parar. Brinda, comenta e presenteia sem sair do vídeo.' },
  { target: 'profile', icon: 'user', title: 'O teu perfil', text: 'Aqui moram as tuas publicações, as definições e a tua geleira.' },
  { icon: 'snowflake', title: 'Enche a tua geleira', text: 'Diz-nos as tuas vibes, bebidas, comidas e sítios favoritos. É assim que a malta fica a saber quem tu és.' },
];

interface Box { top: number; left: number; width: number; height: number }

/** Visita guiada para quem acabou de registar: cartão flutuante passo a passo, a destacar a barra de baixo. Só aparece uma vez. */
export default function WelcomeTour() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const privacy = useQuery({ queryKey: ['privacy'], queryFn: api.privacy, staleTime: 60_000 });
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const p = privacy.data;
  // Só depois de completar o perfil (para não empilhar com o pedido de data de nascimento e termos).
  const active = !!p && !p.welcomed && p.gender !== null && p.birthDateSet && p.termsAccepted;
  const step = STEPS[i];

  useLayoutEffect(() => {
    if (!active) return;
    const measure = () => {
      const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
      const r = el?.getBoundingClientRect();
      setBox(r && r.width > 0 && r.height > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [active, step.target]);

  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && void finish(false);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  if (!active) return null;

  async function finish(openGeleira: boolean) {
    qc.setQueryData(['privacy'], { ...p!, welcomed: true }); // fecha já; o servidor confirma a seguir
    api.setWelcomed().then((r) => qc.setQueryData(['privacy'], r)).catch(() => undefined);
    if (openGeleira) navigate('/geleira');
  }
  const last = i === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={tr('Visita guiada')}>
      {box ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-[20px] ring-2 ring-white transition-all duration-300 motion-reduce:transition-none"
          style={{ top: box.top - 6, left: box.left - 6, width: box.width + 12, height: box.height + 12, boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/55" />
      )}
      <div
        className={`absolute left-1/2 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-[24px] bg-white p-5 shadow-[0_8px_32px_rgba(0,0,0,0.3)] ${box ? 'bottom-[calc(7.5rem+env(safe-area-inset-bottom))]' : 'top-1/2 -translate-y-1/2'}`}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-50 text-brand"><Icon name={step.icon} size={22} /></span>
          <h2 className="text-xl font-extrabold leading-tight">{step.title}</h2>
        </div>
        <p className="mt-3 text-[16px] text-zinc-700">{step.text}</p>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1.5" aria-label={`Passo ${i + 1} de ${STEPS.length}`} role="img">
            {STEPS.map((_, n) => <span key={n} className={`h-1.5 rounded-full transition-all ${n === i ? 'w-5 bg-brand' : 'w-1.5 bg-zinc-300'}`} />)}
          </div>
          <div className="flex items-center gap-1">
            {!last && <button onClick={() => finish(false)} className="h-11 px-3 text-sm font-semibold text-zinc-600">{tr('Saltar')}</button>}
            {last ? (
              <>
                <button onClick={() => finish(false)} className="h-11 px-3 text-sm font-semibold text-zinc-600">{tr('Depois')}</button>
                <button onClick={() => finish(true)} className={`${btnPrimary} !px-5 !py-2.5`}>{tr('Encher agora')}</button>
              </>
            ) : (
              <button onClick={() => setI(i + 1)} className={`${btnPrimary} !px-5 !py-2.5`}>{tr('Seguinte')}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
