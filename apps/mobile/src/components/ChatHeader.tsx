import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BackButton } from '@/components/BackButton';
import { Icon, type IconName } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { colors } from '@/lib/theme';
import { dayLabel, type Msg } from './ChatBubbles';

/**
 * Cabeçalho das conversas (1:1 e TxillGroups): ‹, a foto e o nome com o estado por baixo (um só botão que abre o
 * perfil ou os detalhes do grupo) e as ações à direita. Branco, sem linha, com uma sombra muito subtil por baixo que
 * cresce um pouco quando há mensagens a passar por baixo (`raised`). `below` fica dentro do mesmo bloco (os separadores do grupo), por cima da sombra.
 */
export function ChatHeader({
  raised, avatar, title, subtitle, onOpen, openLabel, actions, below,
}: {
  raised: boolean; avatar: ReactNode; title: string; subtitle?: ReactNode; onOpen?: () => void; openLabel: string; actions?: ReactNode; below?: ReactNode;
}) {
  return (
    <View style={[st.wrap, raised && st.raised]}>
      <View style={st.row}>
        <BackButton fallback="/messages" style={st.btn} />
        <Pressable
          onPress={onOpen}
          disabled={!onOpen}
          style={({ pressed }) => [st.who, pressed && { backgroundColor: colors.zinc100 }]}
          accessibilityRole="button"
          accessibilityLabel={openLabel}
        >
          {avatar}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.name} numberOfLines={1}>{title}</Text>
            {subtitle}
          </View>
        </Pressable>
        {actions}
      </View>
      {below}
    </View>
  );
}

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
  return (
    <Sheet title="Procurar na conversa" onClose={onClose}>
      <View style={{ paddingHorizontal: 20 }}>
        <TextInput autoFocus value={needle} onChangeText={setNeedle} placeholder="Escreve uma palavra…" placeholderTextColor={colors.zinc500} accessibilityLabel="Procurar na conversa" style={st.needle} />
        <View style={{ marginTop: 12, gap: 4 }}>
          {hits.map((m) => (
            <Pressable key={m.id} onPress={onClose} style={({ pressed }) => [{ borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 }, pressed && { backgroundColor: colors.zinc100 }]}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: colors.zinc500 }}>{nameOf(m)} · {dayLabel(m.at)}</Text>
              <Text style={{ fontSize: 15, color: colors.zinc800 }} numberOfLines={2}>{m.body}</Text>
            </Pressable>
          ))}
        </View>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 6, minHeight: 56 },
  btn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  who: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, paddingVertical: 4, paddingHorizontal: 4 },
  name: { fontWeight: '700', fontSize: 16, lineHeight: 20, color: colors.zinc900 },
  sub: { fontSize: 12.5, lineHeight: 16, color: colors.zinc500, flexShrink: 1 },
  dot: { position: 'absolute', right: -1, bottom: -1, borderWidth: 2, borderColor: colors.white, backgroundColor: '#10b981' },
  dotSmall: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#10b981' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 16, paddingHorizontal: 4, paddingVertical: 10, minHeight: 56 },
  menuIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  menuText: { fontSize: 16, fontWeight: '600', color: colors.zinc900 },
  more: { marginTop: 8, borderRadius: 999, backgroundColor: colors.zinc100, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  needle: { height: 48, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 20, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' } as object,
});
