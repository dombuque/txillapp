import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { BackButton } from '@/components/BackButton';
import { Icon, type IconName } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { colors } from '@/lib/theme';
import type { Badged } from '@/lib/api';
import { dayLabel, type Msg } from './ChatBubbles';
import { NameWithBadge } from './NameWithBadge';

/**
 * Cabeçalho das conversas (1:1 e TxillGroups): ‹, a foto e o nome com o estado por baixo (um só botão que abre o
 * perfil ou os detalhes do grupo) e as ações à direita. Branco, sem linha, com uma sombra muito subtil por baixo que
 * cresce um pouco quando há mensagens a passar por baixo (`raised`). `below` fica dentro do mesmo bloco (os separadores do grupo), por cima da sombra.
 * `overlay` fica por cima da lista de mensagens, logo por baixo do cabeçalho (a nota da pessoa): não empurra nada nem
 * muda a altura do cabeçalho, e só apanha toques onde tem conteúdo.
 */
export function ChatHeader({
  raised, avatar, title, titleWho, subtitle, subtitleAction, avatarAction, onOpen, openLabel, actions, below, overlay,
}: {
  raised: boolean; avatar: ReactNode; title: string; subtitle?: ReactNode;
  /** Conversa 1:1: o selo de verificado a seguir ao nome. */
  titleWho?: Badged | null;
  /** O estado por baixo do nome é ele próprio um botão ("1 publicação nova"); o resto continua a abrir o perfil. */
  subtitleAction?: { label: string; onPress: () => void };
  /** A foto é ela própria um botão (mostrar a nota encolhida); o resto continua a abrir o perfil. */
  avatarAction?: { label: string; onPress: () => void };
  onOpen?: () => void; openLabel: string; actions?: ReactNode; below?: ReactNode; overlay?: ReactNode;
}) {
  const [bottom, setBottom] = useState<number | null>(null);
  return (
    <>
    <View style={[st.wrap, raised && st.raised]} onLayout={(e) => setBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
      <View style={st.row}>
        <BackButton fallback="/messages" style={st.btn} />
        {subtitleAction || avatarAction ? (
          // Dois botões lado a lado em vez de um dentro do outro (no iOS o de dentro ficava invisível ao VoiceOver):
          // o de abrir o perfil fica por trás, a toda a largura, e a foto e o nome deixam passar o toque até ele.
          <View style={st.who}>
            <Pressable
              onPress={onOpen}
              disabled={!onOpen}
              style={({ pressed }) => [StyleSheet.absoluteFill, { borderRadius: 14 }, pressed && { backgroundColor: colors.zinc100 }]}
              accessibilityRole="button"
              accessibilityLabel={openLabel}
            />
            {avatarAction ? (
              <Pressable
                onPress={avatarAction.onPress}
                style={({ pressed }) => [{ borderRadius: 999 }, pressed && { opacity: 0.7 }]}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={avatarAction.label}
              >
                {avatar}
              </Pressable>
            ) : (
              <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{avatar}</View>
            )}
            <View style={{ flex: 1, minWidth: 0 }} pointerEvents="box-none">
              <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <NameWithBadge name={title} who={titleWho} style={st.name} />
              </View>
              {subtitleAction ? (
                <Pressable
                  onPress={subtitleAction.onPress}
                  style={({ pressed }) => [st.subBtn, pressed && { opacity: 0.6 }]}
                  hitSlop={{ top: 2, bottom: 8, left: 4, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={subtitleAction.label}
                >
                  {subtitle}
                </Pressable>
              ) : (
                <View pointerEvents="none">{subtitle}</View>
              )}
            </View>
          </View>
        ) : (
          <Pressable
            onPress={onOpen}
            disabled={!onOpen}
            style={({ pressed }) => [st.who, pressed && { backgroundColor: colors.zinc100 }]}
            accessibilityRole="button"
            accessibilityLabel={openLabel}
          >
            {avatar}
            <View style={{ flex: 1, minWidth: 0 }}>
              <NameWithBadge name={title} who={titleWho} style={st.name} />
              {subtitle}
            </View>
          </Pressable>
        )}
        {actions}
      </View>
      {below}
    </View>
    {overlay && bottom !== null ? (
      // Irmão do cabeçalho (e não filho): no Android, o que sai fora do pai não recebe toques.
      <View pointerEvents="box-none" style={[st.overlay, { top: bottom }]}>{overlay}</View>
    ) : null}
    </>
  );
}

/**
 * Onde fica a foto dentro do cabeçalho (para a nota sair dela): a margem da linha, o botão ‹ (44), o espaço entre
 * eles e a margem do bloco da foto. `HEADER_AVATAR_BOTTOM` = quanto a foto (36) acaba acima do fundo do cabeçalho.
 */
export const HEADER_AVATAR_LEFT = 6 + 44 + 2 + 4;
export const HEADER_AVATAR_SIZE = 36;
export const HEADER_AVATAR_BOTTOM = 10;

/** Estado por baixo do nome: "Online" (verde), "a escrever…" (marca) ou cinzento ("Ativo há 5 min", "8 pessoas · Tofo"). */
export function HeaderStatus({ text, tone = 'muted', icon }: { text: string; tone?: 'online' | 'typing' | 'muted'; icon?: IconName }) {
  const color = tone === 'online' ? '#047857' : tone === 'typing' ? colors.brand : colors.zinc500;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0 }}>
      {tone === 'online' ? <View style={st.dotSmall} /> : icon ? <Icon name={icon} size={12} color={colors.zinc500} /> : null}
      <Text style={[st.sub, { color }, tone !== 'muted' && { fontWeight: '600' }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

/** Botão redondo de 44 pt no cabeçalho (chamadas, "⋯"). */
export function HeaderButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.btn, pressed && { backgroundColor: colors.zinc100 }]} accessibilityRole="button" accessibilityLabel={label} hitSlop={2}>
      {children}
    </Pressable>
  );
}

/** A bolinha verde no canto da foto (só quando está online). */
export function OnlineDot({ size }: { size: number }) {
  const d = Math.max(10, Math.round(size * 0.3));
  return <View style={[st.dot, { width: d, height: d, borderRadius: d / 2 }]} accessibilityLabel="Online" />;
}

export interface MenuItem { icon: IconName; label: string; onPress: () => void }

/** O menu "⋯" do cabeçalho: uma folha com as opções da conversa. */
export function ChatMenuSheet({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <Sheet title="Conversa" onClose={onClose}>
      <View style={{ paddingHorizontal: 20 }}>
        {items.map((it) => (
          <Pressable
            key={it.label}
            onPress={() => { onClose(); it.onPress(); }}
            style={({ pressed }) => [st.menuRow, pressed && { backgroundColor: colors.zinc100 }]}
            accessibilityRole="button"
          >
            <View style={st.menuIcon}><Icon name={it.icon} size={22} color={colors.zinc800} /></View>
            <Text style={st.menuText}>{it.label}</Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Procurar nas mensagens já carregadas (texto e respostas), com "carregar mais antigas". */
export function ChatSearchSheet({ items, nameOf, hasNext, fetchNext, onClose }: {
  items: Msg[]; nameOf: (m: Msg) => string; hasNext: boolean; fetchNext: () => void; onClose: () => void;
}) {
  const [needle, setNeedle] = useState('');
  const n = norm(needle.trim());
  const hits = n.length < 2 ? [] : items.filter((m) => !m.id.startsWith('tmp-') && !m.viewOnce && m.body && (m.kind === 'text' || m.kind === 'story_reply' || m.kind === 'zas_reply') && norm(m.body).includes(n)).slice(0, 40);
  // Até 40 resultados não cabem na folha: rolam aqui dentro (a caixa de procurar fica sempre à vista). Sem isto os de baixo
  // ficavam fora do ecrã, sem scroll (no telemóvel e no computador).
  const { height } = useWindowDimensions();
  const room = Math.max(160, Math.round(height * 0.85) - 190);
  return (
    <Sheet title="Procurar na conversa" onClose={onClose}>
      <View style={{ paddingHorizontal: 20 }}>
        <TextInput autoFocus value={needle} onChangeText={setNeedle} placeholder="Escreve uma palavra…" placeholderTextColor={colors.zinc500} accessibilityLabel="Procurar na conversa" style={st.needle} />
        <ScrollView style={{ marginTop: 12, maxHeight: room, flexGrow: 0 }} contentContainerStyle={{ gap: 4 }} keyboardShouldPersistTaps="handled">
          {hits.map((m) => (
            <Pressable key={m.id} onPress={onClose} style={({ pressed }) => [{ borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 }, pressed && { backgroundColor: colors.zinc100 }]}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: colors.zinc500 }}>{nameOf(m)} · {dayLabel(m.at)}</Text>
              <Text style={{ fontSize: 15, color: colors.zinc800 }} numberOfLines={2}>{m.body}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {n.length >= 2 && hits.length === 0 && <Text style={{ paddingVertical: 24, textAlign: 'center', color: colors.zinc600 }}>Nada encontrado nas mensagens carregadas.</Text>}
        {hasNext && (
          <Pressable onPress={fetchNext} style={st.more} accessibilityRole="button"><Text style={{ fontSize: 14, fontWeight: '600', color: colors.zinc700 }}>Carregar mensagens mais antigas</Text></Pressable>
        )}
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  // Branco sobre o fundo cinzento das mensagens: sombra muito subtil sempre; um pouco mais quando há mensagens por baixo.
  wrap: { backgroundColor: colors.white, zIndex: 5, boxShadow: '0 1px 0 rgba(24,24,27,0.04), 0 2px 8px -4px rgba(24,24,27,0.08)' },
  raised: { boxShadow: '0 1px 0 rgba(24,24,27,0.05), 0 6px 16px -8px rgba(24,24,27,0.18)' },
  overlay: { position: 'absolute', left: 0, right: 0, zIndex: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 6, minHeight: 56 },
  btn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  who: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingVertical: 4, paddingHorizontal: 4 },
  name: { fontWeight: '700', fontSize: 16, lineHeight: 20, color: colors.zinc900 },
  sub: { fontSize: 12.5, lineHeight: 16, color: colors.zinc500, flexShrink: 1 },
  subBtn: { alignSelf: 'flex-start', maxWidth: '100%' },
  dot: { position: 'absolute', right: -1, bottom: -1, borderWidth: 2, borderColor: colors.white, backgroundColor: '#10b981' },
  dotSmall: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#10b981' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 16, paddingHorizontal: 4, paddingVertical: 10, minHeight: 56 },
  menuIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  menuText: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  more: { marginTop: 8, borderRadius: 999, backgroundColor: colors.zinc100, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  needle: { height: 48, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 20, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' } as object,
});
