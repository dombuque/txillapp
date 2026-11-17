import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import { useStableFrame } from '@/lib/useStableFrame';
import {
  ALIGN_LABEL, BG_LABEL, TEXT_BASE_PX, TEXT_LAYER_COLORS, TEXT_MAX_CHARS, TEXT_METRICS, clampLayerText, layerColors, newTextPx, nextAlign, nextBg,
  sForFontPx, textLayout, wrapLayerText, type TextAlign, type TextBg, type TextLayer,
} from '@/lib/textLayers';
import { useTextFontStyle, useTextFonts } from '@/lib/useTextFonts';
import { FontChips } from './FontChips';
import { Modal } from './Modal';

/** A letra de um texto: a fonte se já carregou; senão a do sistema, em negrito (só aí: no Android a fonte própria com peso sai com negrito inventado). */
const SYSTEM_BOLD: TextStyle = { fontWeight: '800' };
/** (Um hook: volta a desenhar quando a fonte chega; ver `useTextFontStyle`.) */
const useFontOr = (font: string): TextStyle => useTextFontStyle(font) ?? SYSTEM_BOLD;

/**
 * Mede, escondido, a linha mais comprida do texto à letra de referência (`TEXT_BASE_PX`): é daí que sai o tamanho da letra
 * para a caixa ter `s × largura` (lib/textLayers, `textLayout`, as mesmas contas do servidor). Dentro de uma caixa de 0×0
 * com `overflow: hidden`: não ocupa lugar nem faz a página rolar na web.
 */
function Measure({ text, font, onWidth }: { text: string; font: string; onWidth: (w: number) => void }) {
  const face = useFontOr(font);
  return (
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden aria-hidden style={st.measure}>
      <View style={{ width: 20000, alignItems: 'flex-start' }}>
        <Text onLayout={(e) => onWidth(e.nativeEvent.layout.width)} style={[{ fontSize: TEXT_BASE_PX, lineHeight: TEXT_METRICS.lineHeight * TEXT_BASE_PX }, face]}>{text || ' '}</Text>
      </View>
    </View>
  );
}

/** As medidas de um texto num ecrã de `W` px (e o medidor escondido que as dá). Até medir, `ready` é false. */
export function useTextLayer(layer: TextLayer, W: number) {
  const [tw, setTw] = useState(0);
  useTextFonts([layer.font]);
  return { L: textLayout(layer, tw, W), ready: tw > 0, measure: <Measure text={layer.text} font={layer.font} onWidth={setTw} /> };
}
export type TextLayoutBox = ReturnType<typeof textLayout>;

/**
 * A caixa de um texto já medida (`L`): o fundo, as margens e as linhas, cada uma alinhada como o servidor as grava. O texto
 * leva uma folga na largura para nunca se partir sozinho (a letra mede-se a 100 px e desenha-se a outro tamanho).
 */
export function TextBox({ layer, L }: { layer: TextLayer; L: TextLayoutBox }) {
  const { fg, box } = layerColors(layer);
  const face = useFontOr(layer.font);
  const slack = L.contentW * 0.04 + 4;
  return (
    <View style={[{ width: L.w, height: L.h, borderRadius: L.radius, paddingHorizontal: L.padX, paddingVertical: L.padY }, box ? { backgroundColor: box } : null]}>
      <Text
        style={[
          { width: L.contentW + slack, marginLeft: layer.align === 'left' ? 0 : layer.align === 'right' ? -slack : -slack / 2, color: fg, fontSize: L.fontPx, lineHeight: L.lineH, textAlign: layer.align },
          face,
          !box && { textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: L.fontPx * 0.05 }, textShadowRadius: Math.max(1, L.fontPx * 0.15) },
        ]}
      >
        {layer.text}
      </Text>
    </View>
  );
}

/** Um texto pousado sobre o mimo (só para ver): centro em (x, y) do ecrã de `width`×`height`, rodado à volta dele. */
export function TextLayerView({ layer, width, height }: { layer: TextLayer; width: number; height: number }) {
  const { L, ready, measure } = useTextLayer(layer, width);
  return (
    <>
      {measure}
      <View style={{ position: 'absolute', left: layer.x * width - L.w / 2, top: layer.y * height - L.h / 2, width: L.w, height: L.h, opacity: ready ? 1 : 0, transform: [{ rotate: `${layer.r}deg` }] }}>
        <TextBox layer={layer} L={L} />
      </View>
    </>
  );
}

/** Os botões redondos do editor (44 px). */
function RoundBtn({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [st.round, pressed && { transform: [{ scale: 0.92 }] }]}>
      {children}
    </Pressable>
  );
}

/** O desenho do botão do alinhamento: três riscos encostados ao lado escolhido. */
function AlignGlyph({ align }: { align: TextAlign }) {
  const side = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
  return (
    <View style={{ width: 20, gap: 3, alignItems: side }}>
      {[20, 13, 17].map((w, i) => <View key={i} style={{ width: w, height: 2.4, borderRadius: 1.2, backgroundColor: '#fff' }} />)}
    </View>
  );
}

/** O desenho do botão do fundo: um «A» sem caixa (tracejado), numa caixa cheia ou numa caixa escura. */
function BgGlyph({ bg }: { bg: TextBg }) {
  const box = bg === 'solid' ? '#fff' : bg === 'soft' ? 'rgba(0,0,0,0.6)' : 'transparent';
  return (
    <View style={{ width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: box, borderWidth: bg === 'solid' ? 0 : 1.6, borderColor: '#fff', borderStyle: bg === 'none' ? 'dashed' : 'solid' }}>
      <Text style={{ fontSize: 15, fontWeight: '800', color: bg === 'solid' ? colors.zinc900 : '#fff' }}>A</Text>
    </View>
  );
}

/**
 * Escrever (ou reescrever) um texto do mimo, em ecrã inteiro por cima da foto, como nas stories do Instagram: o texto ao
 * meio, em cima o alinhamento, o fundo e «Feito»; em baixo as cores e as letras. «Feito» (ou o voltar, ou tocar fora) pousa
 * o texto com as linhas compridas já partidas; vazio, não pousa nada (ou apaga o que se estava a reescrever).
 * `boxW`: a largura do ecrã do mimo. Um texto novo fica com a letra a `TEXT_NEW_PX` dele; um reescrito mantém o tamanho da
 * letra (o `s`, que é a largura da caixa, acerta-se ao texto novo).
 */
export function TextLayerEditor({ initial, boxW, onDone }: { initial: TextLayer; boxW: number; onDone: (l: TextLayer) => void }) {
  const [l, setL] = useState(initial);
  const insets = useSafeAreaInsets();
  useTextFonts([l.font]);
  const face = useFontOr(l.font);
  const editing = !!initial.text;
  const [tw0, setTw0] = useState(0);
  const [tw, setTw] = useState(0);
  const set = (p: Partial<TextLayer>) => setL((cur) => ({ ...cur, ...p }));
  const text = wrapLayerText(l.text);
  // O tamanho da letra a manter: o do texto que se reescreve (se já foi medido), ou o de um texto novo.
  const px = editing && tw0 ? textLayout(initial, tw0, boxW).fontPx : newTextPx(l.font, boxW);
  const done = () => {
    const next = { ...l, text };
    onDone(tw && text ? { ...next, s: sForFontPx(next, tw, px, boxW) } : next);
  };
  const { fg, box } = layerColors(l);
  // Ao escrever, a letra fica perto do tamanho que vai ter (entre 18 e 44 px, para caber a escrever).
  const fs = Math.max(18, Math.min(44, px));
  const [h, setH] = useState(0);
  // O teclado está sempre aberto aqui: o ecrã fica com a altura que tinha sem ele e só a barra de baixo (cores e letras)
  // sobe para cima do teclado (lib/useStableFrame). O KeyboardAvoidingView encolhia a camada no Android em vez de subir a barra.
  const { screen, lift } = useStableFrame(true);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={done} statusBarTranslucent>
      <View style={{ height: screen.h, backgroundColor: 'rgba(0,0,0,0.6)' }}>
        {editing ? <Measure text={initial.text} font={initial.font} onWidth={setTw0} /> : null}
        <Measure text={text} font={l.font} onWidth={setTw} />
        <View style={[st.top, { paddingTop: Math.max(insets.top, 12) }]}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <RoundBtn label={`${ALIGN_LABEL[l.align]}. Mudar o alinhamento`} onPress={() => set({ align: nextAlign(l.align) })}>
              <AlignGlyph align={l.align} />
            </RoundBtn>
            <RoundBtn label={`${BG_LABEL[l.bg]}. Mudar o fundo`} onPress={() => set({ bg: nextBg(l.bg) })}>
              <BgGlyph bg={l.bg} />
            </RoundBtn>
          </View>
          <Pressable onPress={done} accessibilityRole="button" accessibilityLabel="Feito" style={({ pressed }) => [st.done, pressed && { opacity: 0.7 }]}>
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>Feito</Text>
          </Pressable>
        </View>

        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 20 }}>
          {/* Tocar fora do texto também é «Feito». */}
          <Pressable onPress={done} accessible={false} style={StyleSheet.absoluteFill} />
          <TextInput
            value={l.text}
            onChangeText={(v) => set({ text: clampLayerText(v) })}
            autoFocus
            multiline
            maxLength={TEXT_MAX_CHARS + 8}
            placeholder="Escreve…"
            placeholderTextColor="rgba(255,255,255,0.6)"
            onContentSizeChange={(e) => setH(e.nativeEvent.contentSize.height)}
            accessibilityLabel="Texto por cima do mimo"
            style={[
              {
                alignSelf: 'stretch',
                minHeight: Math.round(fs * TEXT_METRICS.lineHeight + fs * 0.44),
                maxHeight: '100%',
                color: fg,
                fontSize: fs,
                lineHeight: Math.round(fs * TEXT_METRICS.lineHeight),
                textAlign: l.align,
                textAlignVertical: 'center',
                borderRadius: box ? fs * TEXT_METRICS.radius : 0,
                paddingHorizontal: fs * 0.4,
                paddingVertical: fs * 0.22,
                backgroundColor: box ?? 'transparent',
                outlineStyle: 'none',
              } as object,
              Platform.OS === 'web' && h ? { height: h } : null,
              face,
            ]}
          />
        </View>

        <View style={{ paddingBottom: lift > 0 ? lift + 10 : Math.max(insets.bottom, 10), gap: 10 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 4, paddingHorizontal: 12 }} accessibilityLabel="Cor">
            {TEXT_LAYER_COLORS.map((c) => {
              const on = l.color === c;
              return (
                <Pressable key={c} onPress={() => set({ color: c })} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Cor ${COLOR_NAMES[c] ?? c}`} style={st.colorHit}>
                  <View style={[st.color, { backgroundColor: c }, on && st.colorOn]} />
                </Pressable>
              );
            })}
          </ScrollView>
          <FontChips value={l.font} onChange={(font) => set({ font })} dark />
        </View>
      </View>
    </Modal>
  );
}

/** O nome de cada cor para o leitor de ecrã. */
const COLOR_NAMES: Record<string, string> = { '#ffffff': 'branco', '#111111': 'preto', '#d6334f': 'coral', '#ff8a5c': 'laranja', '#ffd60a': 'amarelo', '#3ddc97': 'verde', '#2ec5ff': 'azul', '#7a5cff': 'roxo', '#ff4fd8': 'rosa' };

const st = StyleSheet.create({
  measure: { position: 'absolute', left: 0, top: 0, width: 0, height: 0, overflow: 'hidden', opacity: 0 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  done: { height: 44, minWidth: 44, paddingHorizontal: 16, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  colorHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  color: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)' },
  colorOn: { width: 36, height: 36, borderRadius: 18, borderWidth: 3, borderColor: '#fff' },
});
