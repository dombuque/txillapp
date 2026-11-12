import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ANIMS, FONTS, fontById, LOOPS, TEXT_COLORS, type AnimIn, type TextOverlay } from '@/lib/studio/effects';
import { fmtS } from '@/lib/tchekaRules';
import { Icon } from '../Icon';
import { fx as ui, FxAction, FxChip, FxRow, FxSegment, FxSlider, fxc } from './FxUi';

type Sub = 'fonte' | 'estilo' | 'animacao' | 'tempo';
const SUBS: { id: Sub; label: string }[] = [{ id: 'fonte', label: 'Fonte' }, { id: 'estilo', label: 'Estilo' }, { id: 'animacao', label: 'Animação' }, { id: 'tempo', label: 'Tempo' }];

/**
 * O separador «Texto»: vários textos, cada um com fonte, cor, fundo, contorno, sombra, néon, alinhamento, animações de entrada
 * e de saída e o tempo em que aparece. Mexe-se (mover, rodar e escalar) na própria pré-visualização (components/studio/FxStage).
 */
export function TextPanel({ texts, selId, onSelect, onAdd, onChange, onDelete, total, locked, focusKey }: {
  texts: TextOverlay[];
  selId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onChange: (o: TextOverlay) => void;
  onDelete: (id: string) => void;
  total: number;
  locked: boolean;
  /** Muda quando se pede para escrever (toque duplo no texto da pré-visualização). */
  focusKey: number;
}) {
  const [sub, setSub] = useState<Sub>('fonte');
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const cur = texts.find((t) => t.id === selId) ?? null;
  useEffect(() => { if (focusKey && !locked) setTimeout(() => input.current?.focus(), 30); }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<TextOverlay>) => { if (cur && !locked) onChange({ ...cur, ...patch }); };
  const setAnim = (patch: Partial<TextOverlay['anim']>) => cur && set({ anim: { ...cur.anim, ...patch } });

  return (
    <View>
      <FxRow>
        <FxAction label="Texto" tone="coral" icon={<Icon name="plus" size={14} color="#fff" strokeWidth={2.6} />} onPress={onAdd} disabled={locked || texts.length >= 10} a11y="Juntar um texto" />
        {texts.map((t, k) => (
          <FxChip key={t.id} small on={t.id === selId} label={t.text.trim() ? t.text.trim().slice(0, 14) : `Texto ${k + 1}`} onPress={() => onSelect(t.id)} a11y={`Escolher o texto ${k + 1}`} />
        ))}
      </FxRow>
      {!cur ? (
        <Text style={[ui.note, { marginTop: 10 }]}>Toca em «Texto» para escrever por cima da tcheka. Depois arrasta-o na pré-visualização; com dois dedos (ou a roda do rato) rodas e escalas.</Text>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginTop: 10 }}>
            <TextInput
              ref={input}
              value={cur.text}
              editable={!locked}
              onChangeText={(v) => { if (!locked) set({ text: v.slice(0, 200) }); }}
              placeholder="Escreve aqui"
              placeholderTextColor="rgba(255,255,255,0.45)"
              multiline
              maxLength={200}
              style={{ flex: 1, minWidth: 0, minHeight: 42, maxHeight: 84, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: fxc.line, color: '#fff', paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, fontFamily: fontById(cur.font).family }}
              accessibilityLabel="Texto da tcheka"
            />
            <Pressable onPress={() => onDelete(cur.id)} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(220,38,38,0.18)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.45)' }} accessibilityRole="button" accessibilityLabel="Apagar este texto">
              <Icon name="trash" size={18} color="#fff" />
            </Pressable>
          </View>
          <FxSegment items={SUBS} value={sub} onChange={setSub} />

          {sub === 'fonte' ? (
            <>
              <FxRow>
                {FONTS.map((f) => {
                  const on = cur.font === f.id;
                  return (
                    <Pressable key={f.id} onPress={() => set({ font: f.id })} style={[{ width: 70, height: 58, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: fxc.glass, borderWidth: 1, borderColor: fxc.line }, on && ({ borderColor: fxc.coralHot, backgroundColor: fxc.glassOn, boxShadow: fxc.glow } as object)]} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`Fonte ${f.name}`}>
                      <Text style={{ color: '#fff', fontSize: 22 * f.k * 0.9, fontFamily: f.family, fontWeight: String(f.weight) as '400', fontStyle: f.style ?? 'normal', lineHeight: 28 }}>Aa</Text>
                      <Text style={{ color: on ? '#fff' : fxc.muted, fontSize: 10, fontWeight: '800' }} numberOfLines={1}>{f.name}</Text>
                    </Pressable>
                  );
                })}
              </FxRow>
              <FxSlider label="Tamanho" value={cur.size} min={36} max={200} step={2} format={(v) => `${v}`} onChange={(v) => set({ size: v })} />
            </>
          ) : null}

          {sub === 'estilo' ? (
            <>
              <FxRow label="Cor">
                {TEXT_COLORS.map((c) => (
                  <Pressable key={c} onPress={() => set({ color: c })} style={[{ width: 32, height: 32, borderRadius: 16, backgroundColor: c, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)' }, cur.color === c && ({ borderColor: '#fff', boxShadow: `0 0 0 2px ${fxc.coralHot}, 0 0 14px ${c}` } as object)]} accessibilityRole="button" accessibilityState={{ selected: cur.color === c }} accessibilityLabel={`Cor ${c}`} />
                ))}
              </FxRow>
              <FxRow wrap>
                <FxChip small on={cur.bg === 'cheio'} label="Fundo" onPress={() => set({ bg: cur.bg === 'cheio' ? 'nenhum' : 'cheio', neon: false })} a11y="Fundo cheio na cor do texto" />
                <FxChip small on={cur.bg === 'suave'} label="Vidro" onPress={() => set({ bg: cur.bg === 'suave' ? 'nenhum' : 'suave' })} a11y="Fundo de vidro escuro" />
                <FxChip small on={cur.outline} label="Contorno" onPress={() => set({ outline: !cur.outline, neon: false })} />
                <FxChip small on={cur.shadow} label="Sombra" onPress={() => set({ shadow: !cur.shadow })} />
                <FxChip small on={cur.neon} label="Néon" onPress={() => set({ neon: !cur.neon, outline: false, bg: cur.bg === 'cheio' ? 'nenhum' : cur.bg })} icon={<Icon name="sparkles" size={13} color={cur.neon ? '#fff' : 'rgba(255,255,255,0.7)'} />} />
              </FxRow>
              <FxRow label="Alinhamento" wrap>
                {(['left', 'center', 'right'] as const).map((a) => (
                  <FxChip key={a} small on={cur.align === a} label={a === 'left' ? 'Esquerda' : a === 'center' ? 'Centro' : 'Direita'} onPress={() => set({ align: a })} a11y={`Alinhar à ${a === 'left' ? 'esquerda' : a === 'center' ? 'centro' : 'direita'}`} />
                ))}
              </FxRow>
            </>
          ) : null}

          {sub === 'animacao' ? (
            <>
              <FxRow label="Entrada">
                {ANIMS.map((a) => <FxChip key={a.id} small on={cur.anim.in === a.id} label={a.name} onPress={() => setAnim({ in: a.id as AnimIn })} a11y={`Entrada: ${a.name}`} />)}
              </FxRow>
              <FxRow label="Saída">
                {ANIMS.map((a) => <FxChip key={a.id} small on={cur.anim.out === a.id} label={a.name} onPress={() => setAnim({ out: a.id as AnimIn })} a11y={`Saída: ${a.name}`} />)}
              </FxRow>
              <FxRow label="Enquanto se vê">
                {LOOPS.map((a) => <FxChip key={a.id} small on={cur.anim.loop === a.id} label={a.name} onPress={() => setAnim({ loop: a.id })} a11y={`Em ciclo: ${a.name}`} />)}
              </FxRow>
              <FxSlider label="Duração da entrada" value={cur.anim.inDur} min={0.1} max={2} step={0.05} format={(v) => `${fmtS(v)} s`} onChange={(v) => setAnim({ inDur: v })} />
            </>
          ) : null}

          {sub === 'tempo' ? (
            <>
              <FxSlider label="Entra aos" value={cur.start} min={0} max={Math.max(0.5, total - 0.5)} step={0.1} format={(v) => `${fmtS(v)} s`} onChange={(v) => set({ start: v, end: Math.max(cur.end, v + 0.5) })} />
              <FxSlider label="Sai aos" value={Math.min(cur.end, Math.max(0.6, total))} min={0.5} max={Math.max(0.6, total)} step={0.1} format={(v) => `${fmtS(v)} s`} onChange={(v) => set({ end: v, start: Math.min(cur.start, v - 0.5) })} />
              <FxRow wrap>
                <FxAction label="Do início ao fim" onPress={() => set({ start: 0, end: Math.max(0.5, total) })} />
              </FxRow>
            </>
          ) : null}
        </>
      )}
    </View>
  );
}
