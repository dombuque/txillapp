import { createElement, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  ADJUSTS, DEFAULT_TRANSITION, filterById, RAMPS, rampSpeedAt, REVERSE_MAX_S, sanitizeFx, TRANSITION_MAX_S, TRANSITION_MIN_S, TRANSITIONS,
  type AdjustKey, type ClipFx, type RampId, type TransitionId,
} from '@/lib/studio/effects';
import { fmtS } from '@/lib/tchekaRules';
import { Icon, type IconName } from '../Icon';
import { FxFilterStrip, type FrameGrab } from './FxFilterStrip';
import { fx as ui, FxAction, FxChip, FxRow, FxSegment, FxSlider, fxc } from './FxUi';

const dom = createElement as (tag: string, props?: Record<string, unknown>, ...kids: unknown[]) => ReactNode;

/** Um clipe como o painel o vê. */
export interface FxClip { key: string; video: boolean; uri: string; fx?: ClipFx; /** segundos no vídeo final */ dur: number; /** segundos do corte */ trimLen: number; start: number }
export type FxTarget = number | 'all';
export interface ReverseState { status: 'ready' | 'working' | 'too-long' | 'error' | null; progress: number }

type Sub = 'filtros' | 'ajustes' | 'transicoes' | 'tempo';
const SUBS: { id: Sub; label: string }[] = [{ id: 'filtros', label: 'Filtros' }, { id: 'ajustes', label: 'Ajustes' }, { id: 'transicoes', label: 'Transição' }, { id: 'tempo', label: 'Tempo' }];
const ADJ_ICON: Record<AdjustKey, IconName> = { brightness: 'sun', contrast: 'moon', saturation: 'water', temperature: 'flame', hue: 'sparkles', sharpen: 'bolt', vignette: 'eye', grain: 'grid' };
const TR_GLYPH: Partial<Record<TransitionId, string>> = {
  corte: '✂', fundido: '◐', 'deslizar-esquerda': '←', 'deslizar-direita': '→', 'deslizar-cima': '↑', 'deslizar-baixo': '↓',
  zoom: '⤢', desfoque: '◌', girar: '↻', flash: '✦', brilho: '☀', glitch: '▚',
};
const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;

/** O separador «Efeitos»: filtros com miniaturas ao vivo, ajustes, transições por junção e o tempo (rampas, inverter, congelar). */
export function FxPanel({ clips, sel, onSelect, setFx, grab, playing, frameKey, onPreviewJunction, onFreeze, freezing, reverseOf, hideClips }: {
  clips: FxClip[];
  sel: number;
  onSelect: (i: number) => void;
  /** Muda o fx de um clipe ou de todos (`timing`: muda a duração ou a leitura do vídeo e a pré-visualização volta ao clipe). */
  setFx: (target: FxTarget, patch: (fx: ClipFx | undefined, i: number) => ClipFx | undefined, timing?: boolean) => void;
  grab: () => FrameGrab | null;
  playing: boolean;
  /** Muda quando o frame da pré-visualização muda (para as miniaturas). */
  frameKey: string;
  onPreviewJunction: (i: number) => void;
  onFreeze: () => void;
  freezing: boolean;
  reverseOf: (key: string) => ReverseState;
  /** No telemóvel: sem a fila dos clipes (escolhe-se o clipe na linha do tempo, que está sempre à vista). */
  hideClips?: boolean;
}) {
  const [sub, setSub] = useState<Sub>('filtros');
  const [adj, setAdj] = useState<AdjustKey>('brightness');
  const cur = clips[sel] ?? clips[0];
  const i = clips[sel] ? sel : 0;
  if (!cur) return <Text style={ui.note}>Junta fotos ou vídeos para pôr efeitos.</Text>;
  const fxNow = cur.fx;
  const filt = filterById(fxNow?.filter?.id) ?? filterById('normal')!;
  const amount = fxNow?.filter?.amount ?? 1;
  const put = (target: FxTarget, change: (f: ClipFx) => ClipFx, timing = false) => setFx(target, (f) => sanitizeFx(change({ ...(f ?? {}) })), timing);

  const clipBar = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }} style={{ marginTop: 8, flexGrow: 0 }}>
      {clips.map((c, k) => {
        const on = k === i;
        const has = !!(c.fx && (c.fx.filter || c.fx.adjust || c.fx.ramp || c.fx.reverse));
        return (
          <Pressable key={c.key} onPress={() => onSelect(k)} style={[{ width: 40, height: 52, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: on ? fxc.coralHot : 'rgba(255,255,255,0.14)', backgroundColor: '#1a1a22' }, on && ({ boxShadow: fxc.glow } as object)]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Clipe ${k + 1}${c.video ? ', vídeo' : ', foto'}`}>
            {c.video
              ? dom('video', { src: c.uri, muted: true, playsInline: true, preload: 'metadata', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })
              : dom('img', { src: c.uri, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })}
            <View pointerEvents="none" style={{ position: 'absolute', left: 3, top: 2 }}><Text style={{ color: '#fff', fontSize: 14, fontWeight: '900', textShadowColor: '#000', textShadowRadius: 3 }}>{k + 1}</Text></View>
            {has ? <View pointerEvents="none" style={{ position: 'absolute', right: 3, top: 3, width: 7, height: 7, borderRadius: 4, backgroundColor: fxc.coralHot }} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <View>
      <FxSegment items={SUBS} value={sub} onChange={setSub} />
      {clips.length > 1 && !hideClips ? clipBar : null}

      {sub === 'filtros' ? (
        <>
          <View style={{ marginTop: 8 }}>
            <FxFilterStrip fx={fxNow} grab={grab} playing={playing} refreshKey={`${frameKey}|${cur.key}`} onPick={(id) => put(i, (f) => ({ ...f, filter: id === 'normal' ? undefined : { id, amount: f.filter?.id === id ? f.filter.amount : 1 } }))} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginTop: 6 }}>
            <Text style={{ flex: 1, color: fxc.muted, fontSize: 14 }} numberOfLines={2}><Text style={{ color: '#fff', fontWeight: '800' }}>{filt.name}</Text> · {filt.mood}</Text>
            {clips.length > 1 ? <FxAction label="A todos" icon={<Icon name="images" size={14} color="#fff" />} onPress={() => put('all', (f) => ({ ...f, filter: filt.id === 'normal' ? undefined : { id: filt.id, amount } }))} a11y={`Aplicar o filtro ${filt.name} a todos os clipes`} /> : null}
          </View>
          {filt.id !== 'normal' ? (
            <FxSlider label="Intensidade" value={Math.round(amount * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => put(i, (f) => ({ ...f, filter: { id: filt.id, amount: v / 100 } }))} />
          ) : null}
        </>
      ) : null}

      {sub === 'ajustes' ? (
        <>
          <FxRow>
            {ADJUSTS.map((a) => {
              const v = fxNow?.adjust?.[a.id] ?? 0;
              return (
                <Pressable key={a.id} onPress={() => setAdj(a.id)} style={{ alignItems: 'center', width: 70, gap: 4 }} accessibilityRole="tab" accessibilityState={{ selected: adj === a.id }} accessibilityLabel={`${a.label}${v ? ` ${pct(v)}` : ''}`}>
                  <View style={[{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: fxc.glass, borderWidth: 1, borderColor: fxc.line }, adj === a.id && ({ borderColor: fxc.coralHot, backgroundColor: fxc.glassOn, boxShadow: fxc.glow } as object)]}>
                    <Icon name={ADJ_ICON[a.id]} size={20} color={adj === a.id ? '#fff' : 'rgba(255,255,255,0.75)'} />
                    {v ? <View style={{ position: 'absolute', right: 1, top: 1, width: 8, height: 8, borderRadius: 4, backgroundColor: fxc.coralHot }} /> : null}
                  </View>
                  <Text style={{ color: adj === a.id ? '#fff' : fxc.muted, fontSize: 14.5, fontWeight: '700' }} numberOfLines={1}>{a.label}</Text>
                </Pressable>
              );
            })}
          </FxRow>
          {ADJUSTS.filter((a) => a.id === adj).map((a) => (
            <FxSlider key={a.id} label={a.label} value={Math.round((fxNow?.adjust?.[a.id] ?? 0) * 100)} min={a.min * 100} max={a.max * 100} step={1} format={(v) => (a.min < 0 ? pct(v / 100) : `${v}`)}
              onChange={(v) => put(i, (f) => ({ ...f, adjust: { ...f.adjust, [a.id]: v / 100 } }))} />
          ))}
          <FxRow wrap>
            <FxAction label="Repor" icon={<Icon name="undo" size={14} color="#fff" />} onPress={() => put(i, (f) => ({ ...f, adjust: undefined }))} disabled={!fxNow?.adjust} a11y="Repor os ajustes deste clipe" />
            <FxAction label="Aplicar a todos" icon={<Icon name="images" size={14} color="#fff" />} onPress={() => { const a = fxNow?.adjust; put('all', (f) => ({ ...f, adjust: a ? { ...a } : undefined })); }} a11y="Aplicar estes ajustes a todos os clipes" />
          </FxRow>
        </>
      ) : null}

      {sub === 'transicoes' ? (
        i === 0 ? (
          <Text style={[ui.note, { marginTop: 12 }]}>A transição é a entrada de um clipe. Escolhe o clipe 2 ou outro a seguir.</Text>
        ) : (
          <>
            <Text style={[ui.note, { color: fxc.muted }]}>Do clipe {i} para o {i + 1}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingVertical: 6 }}>
              {TRANSITIONS.filter((t) => !t.id.startsWith('capulana-')).map((t) => {
                const now = fxNow?.transition ?? DEFAULT_TRANSITION;
                const on = now.type === t.id;
                return (
                  <Pressable key={t.id} onPress={() => { put(i, (f) => ({ ...f, transition: { type: t.id, dur: (f.transition ?? DEFAULT_TRANSITION).dur } })); if (t.id !== 'corte') onPreviewJunction(i); }}
                    style={({ pressed }) => [{ width: 66, height: 66, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: fxc.glass, borderWidth: 1, borderColor: fxc.line }, on && ({ borderColor: fxc.coralHot, backgroundColor: fxc.glassOn, boxShadow: fxc.glow } as object), pressed && { transform: [{ scale: 0.95 }] }]}
                    accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`Transição ${t.id.startsWith('deslizar') ? `deslizar: ${t.name}` : t.name}`}>
                    <Text style={{ color: on ? '#fff' : 'rgba(255,255,255,0.85)', fontSize: 22, fontWeight: '700' }}>{TR_GLYPH[t.id]}</Text>
                    <Text style={{ color: on ? '#fff' : fxc.muted, fontSize: 14, fontWeight: '800' }} numberOfLines={1}>{t.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {(fxNow?.transition ?? DEFAULT_TRANSITION).type !== 'corte' ? (
              <FxSlider label="Duração" value={(fxNow?.transition ?? DEFAULT_TRANSITION).dur} min={TRANSITION_MIN_S} max={TRANSITION_MAX_S} step={0.05} format={(v) => `${fmtS(v)} s`}
                onChange={(v) => put(i, (f) => ({ ...f, transition: { type: (f.transition ?? DEFAULT_TRANSITION).type, dur: v } }))} onCommit={() => onPreviewJunction(i)} />
            ) : null}
            <FxRow wrap>
              <FxAction label="Ver" icon={<Icon name="play" size={13} color="#fff" solid />} onPress={() => onPreviewJunction(i)} a11y="Ver a transição" />
              <FxAction label="Aplicar a todas" icon={<Icon name="images" size={14} color="#fff" />} onPress={() => { const t = fxNow?.transition ?? DEFAULT_TRANSITION; put('all', (f) => ({ ...f, transition: { ...t } })); }} a11y="Aplicar esta transição a todas as junções" />
            </FxRow>
          </>
        )
      ) : null}

      {sub === 'tempo' ? (
        !cur.video ? (
          <Text style={[ui.note, { marginTop: 12 }]}>{fxNow?.freeze ? 'Esta foto é um frame congelado: fica parada no ecrã.' : 'As rampas, inverter e congelar são para vídeos. Escolhe um clipe de vídeo.'}</Text>
        ) : (
          <>
            <FxRow label="Rampa de velocidade">
              <FxChip on={!fxNow?.ramp} label="Nenhuma" onPress={() => put(i, (f) => ({ ...f, ramp: undefined }), true)} />
              {RAMPS.map((r) => (
                <Pressable key={r.id} onPress={() => put(i, (f) => ({ ...f, ramp: r.id as RampId }), true)} style={[{ height: 50, minWidth: 84, borderRadius: 14, paddingHorizontal: 10, justifyContent: 'center', backgroundColor: fxc.glass, borderWidth: 1, borderColor: fxc.line }, fxNow?.ramp === r.id && ({ borderColor: fxc.coralHot, backgroundColor: fxc.glassOn, boxShadow: fxc.glow } as object)]} accessibilityRole="button" accessibilityState={{ selected: fxNow?.ramp === r.id }} accessibilityLabel={`Rampa ${r.name}: ${r.mood}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 16 }}>
                    {Array.from({ length: 14 }, (_, k) => (
                      <View key={k} style={{ width: 3, borderRadius: 2, height: Math.max(3, (rampSpeedAt(r.points, (k + 0.5) / 14) / Math.max(...r.points.map((p) => p[1]))) * 16), backgroundColor: fxNow?.ramp === r.id ? fxc.coralHot : 'rgba(255,255,255,0.55)' }} />
                    ))}
                  </View>
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800', marginTop: 3 }}>{r.name}</Text>
                </Pressable>
              ))}
            </FxRow>
            {fxNow?.ramp ? <Text style={ui.note}>{RAMPS.find((r) => r.id === fxNow.ramp)?.mood} · fica com {fmtS(cur.dur)} s</Text> : null}
            <ReverseRow cur={cur} state={reverseOf(cur.key)} onToggle={() => put(i, (f) => ({ ...f, reverse: f.reverse ? undefined : true }), true)} />
            <FxRow wrap>
              <FxAction label={freezing ? 'A congelar…' : 'Congelar este frame'} icon={<Icon name="snowflake" size={14} color="#fff" />} onPress={onFreeze} disabled={freezing} tone="coral" a11y="Congelar o frame que está na pré-visualização: junta uma foto desse instante" />
            </FxRow>
            <Text style={ui.note}>Congelar divide o clipe no ponto onde está a pré-visualização e põe lá uma foto parada desse frame.</Text>
          </>
        )
      ) : null}
    </View>
  );
}

function ReverseRow({ cur, state, onToggle }: { cur: FxClip; state: ReverseState; onToggle: () => void }) {
  const on = !!cur.fx?.reverse;
  const tooLong = cur.trimLen > REVERSE_MAX_S + 1e-6;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginTop: 10 }}>
      <FxChip on={on} label={on ? 'Ao contrário' : 'Inverter'} icon={<Icon name="repeat" size={14} color={on ? '#fff' : 'rgba(255,255,255,0.75)'} />} onPress={onToggle} disabled={!on && tooLong} a11y={on ? 'Desligar o vídeo ao contrário' : 'Pôr o vídeo ao contrário'} />
      <Text style={{ color: fxc.faint, fontSize: 14, flex: 1 }} numberOfLines={2}>
        {tooLong && !on ? `Para inverter, corta o clipe até ${REVERSE_MAX_S} s.`
          : !on ? 'O vídeo toca do fim para o início.'
            : state.status === 'working' ? `A preparar o inverso… ${Math.round(state.progress * 100)}%`
              : state.status === 'error' ? 'Não consegui inverter este vídeo.'
                : 'O som original deste clipe fica calado.'}
      </Text>
    </View>
  );
}
