import { useState, type CSSProperties, type ReactNode } from 'react';
import type { ProjectClip } from '@/lib/studio/project';
import { fmtS, speedLabel } from '@/lib/tchekaRules';

/**
 * As ações do clipe escolhido na linha do tempo (só web): Dividir (no cursor), Duplicar, Velocidade (nos vídeos; nas fotos
 * é a Duração), Som (nos vídeos: o som do próprio vídeo ligado ou calado e o volume dele), Apagar e Substituir (outro ficheiro no mesmo lugar, com o mesmo tempo e os mesmos efeitos).
 * Sem clipe escolhido, os botões ficam desligados e diz como escolher.
 */
export const STUDIO_SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;
const PHOTO_SECONDS = [1, 2, 3, 5, 8] as const;
const PHOTO_BEATS = [1, 2, 4, 8] as const;

const coral = '#d6334f';
const hot = '#ff4f6d';
const font = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

const svg = (d: ReactNode) => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);
const ICONS: Record<string, ReactNode> = {
  split: svg(<><circle cx="6" cy="6" r="2.6" /><circle cx="6" cy="18" r="2.6" /><path d="M8.2 7.6 20 18M8.2 16.4 20 6" /></>),
  dup: svg(<><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.4" /><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" /></>),
  speed: svg(<><path d="M4.2 17.5a8.5 8.5 0 1 1 15.6 0" /><path d="m12 13.2 4.2-4.6" /><circle cx="12" cy="13.6" r="1.3" /></>),
  time: svg(<><circle cx="12" cy="12.5" r="8" /><path d="M12 8.2v4.5l3 1.8M9.5 2.8h5" /></>),
  trash: svg(<><path d="M4.5 6.5h15M9.5 6.5V4.6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.9M6.5 6.5l.8 12.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8l.8-12.2" /><path d="M10.2 10.5v6M13.8 10.5v6" /></>),
  sound: svg(<><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></>),
  mute: svg(<><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="m16 9.5 5 5M21 9.5l-5 5" /></>),
  swap: svg(<><path d="M4 8.5h13.5l-3.5-3.5M20 15.5H6.5L10 19" /></>),
};

export function TimelineActions({ clip, duration, rhythm, locked, onSplit, onDuplicate, onSpeed, onPhoto, onDelete, onReplace, onSound }: {
  clip: ProjectClip | null;
  /** Quanto o clipe dura na sequência. */
  duration: number;
  /** Ao ritmo: as fotos mudam nas batidas. */
  rhythm: boolean;
  locked: boolean;
  onSplit: () => void;
  onDuplicate: () => void;
  onSpeed: (s: number) => void;
  onPhoto: (p: { seconds?: number; beats?: number }) => void;
  onDelete: () => void;
  onReplace: (f: File) => void;
  /** Vídeos: o som do próprio vídeo (ligado ou calado e o volume, de 0 a 1). */
  onSound?: (v: { on?: boolean; volume?: number }) => void;
}) {
  const [panelOf, setPanelOf] = useState<'time' | 'sound' | null>(null);
  const panel = panelOf === 'time';
  const soundPanel = panelOf === 'sound';
  const soundOn = clip?.sound !== false;
  const volume = clip?.volume ?? 1;
  const off = locked || !clip;
  const isVideo = !!clip?.video;
  const btn = (id: string, label: string, icon: string, onClick: (() => void) | null, opts: { active?: boolean; danger?: boolean; children?: ReactNode; short?: string } = {}) => (
    <button
      key={id}
      type="button"
      aria-label={label}
      title={label}
      disabled={off}
      onClick={onClick ?? undefined}
      style={{
        position: 'relative', flex: '1 0 auto', minWidth: 58, maxWidth: 96, height: 58, border: 'none', borderRadius: 14, padding: '0 6px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: off ? 'default' : 'pointer',
        background: opts.active ? 'rgba(255,79,109,0.16)' : 'transparent', color: off ? 'rgba(255,255,255,0.3)' : opts.danger ? '#ff8095' : opts.active ? hot : '#f4f4f5',
        fontFamily: font, fontSize: 14, fontWeight: 700, overflow: 'hidden',
        boxShadow: opts.active ? `inset 0 0 0 1px ${hot}` : 'none',
      }}
    >
      {ICONS[icon]}
      <span style={{ whiteSpace: 'nowrap' }}>{opts.short ?? label}</span>
      {opts.children}
    </button>
  );
  const chip = (on: boolean, label: string, onClick: () => void, aria?: string) => (
    <button
      key={label}
      type="button"
      aria-label={aria ?? label}
      aria-pressed={on}
      disabled={locked}
      onClick={onClick}
      style={{ height: 44, minWidth: 44, padding: '0 10px', borderRadius: 999, border: on ? 'none' : '1px solid rgba(255,255,255,0.14)', background: on ? `linear-gradient(135deg, ${hot}, ${coral})` : 'rgba(255,255,255,0.06)', color: '#fff', fontFamily: font, fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums', cursor: 'pointer', flex: '0 0 auto', boxShadow: on ? '0 0 14px rgba(255,79,109,0.45)' : 'none' }}
    >
      {label}
    </button>
  );
  // As velocidades cabem numa linha (compactas) na coluna de 400 px e no telemóvel; o resto passa para a linha seguinte.
  const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 4, rowGap: 6, padding: '8px 16px 2px', alignItems: 'center' };

  return (
    <div style={{ fontFamily: font }}>
      <div role="toolbar" aria-label="Ações do clipe" style={{ display: 'flex', justifyContent: 'flex-start', gap: 2, padding: '6px 10px 0', overflowX: 'auto', scrollbarWidth: 'none' } as CSSProperties}>
        {btn('split', 'Dividir', 'split', onSplit)}
        {btn('dup', 'Duplicar', 'dup', onDuplicate)}
        {btn('speed', isVideo || !clip ? 'Velocidade' : 'Duração', isVideo || !clip ? 'speed' : 'time', () => setPanelOf((v) => (v === 'time' ? null : 'time')), { active: panel && !off })}
        {isVideo ? btn('sound', soundOn ? `Som do vídeo: ligado, ${Math.round(volume * 100)}%` : 'Som do vídeo: calado', soundOn ? 'sound' : 'mute', () => setPanelOf((v) => (v === 'sound' ? null : 'sound')), { active: soundPanel && !off, short: soundOn ? 'Som' : 'Calado' }) : null}
        {btn('del', 'Apagar', 'trash', onDelete, { danger: true })}
        {btn('swap', 'Substituir', 'swap', null, {
          children: off ? null : (
            <input
              type="file"
              accept="image/*,video/*"
              aria-label="Substituir o clipe por outro ficheiro"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onReplace(f); }}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
            />
          ),
        })}
      </div>
      {!clip ? (
        <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, textAlign: 'center', padding: '4px 16px 0' }}>Toca num clipe da linha do tempo para o editar</div>
      ) : soundPanel && isVideo ? (
        <div style={row} aria-label="Som do vídeo">
          {chip(soundOn, soundOn ? 'Ligado' : 'Calado', () => onSound?.({ on: !soundOn }), soundOn ? 'Calar o som do vídeo' : 'Ligar o som do vídeo')}
          <input
            type="range" min={0} max={100} step={5} value={Math.round(volume * 100)} disabled={locked}
            aria-label="Volume do som do vídeo"
            onChange={(e) => onSound?.({ volume: Number(e.target.value) / 100, ...(soundOn ? {} : { on: true }) })}
            style={{ flex: '1 1 120px', minWidth: 120, height: 44, accentColor: hot, opacity: soundOn ? 1 : 0.45 }}
          />
          <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, whiteSpace: 'nowrap', minWidth: 44, fontVariantNumeric: 'tabular-nums' }}>{soundOn ? `${Math.round(volume * 100)}%` : 'calado'}</span>
          {clip.hasAudio === false ? <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, width: '100%' }}>Este vídeo não tem som.</span> : null}
        </div>
      ) : panel ? (
        isVideo ? (
          <div style={row} aria-label="Velocidade do clipe">
            {STUDIO_SPEEDS.map((s) => chip(clip.speed === s, speedLabel(s), () => onSpeed(s), `Velocidade ${speedLabel(s)}`))}
            <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, whiteSpace: 'nowrap', paddingLeft: 2 }}>fica com {fmtS(duration)} s</span>
          </div>
        ) : rhythm ? (
          <div style={row} aria-label="Batidas da foto">
            {PHOTO_BEATS.map((b) => chip(clip.beats === b, `${b}♪`, () => onPhoto({ beats: b }), `${b} ${b === 1 ? 'batida' : 'batidas'}`))}
            <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, whiteSpace: 'nowrap', paddingLeft: 4 }}>{fmtS(duration)} s ao ritmo</span>
          </div>
        ) : (
          <div style={row} aria-label="Duração da foto">
            {PHOTO_SECONDS.map((s) => chip(Math.abs(clip.seconds - s) < 0.01, `${s} s`, () => onPhoto({ seconds: s }), `${s} segundos`))}
            <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, whiteSpace: 'nowrap', paddingLeft: 4 }}>ou arrasta as pontas</span>
          </div>
        )
      ) : null}
    </div>
  );
}
