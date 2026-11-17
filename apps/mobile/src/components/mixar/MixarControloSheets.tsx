import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Mixar, MixarItem } from '@/lib/api.mixar';
import { mixarControloKeys, type MixarTopicMode, type mixarControloApi } from '@/lib/api.mixarControlo';
import { offActionText, topicSections, type TopicRow } from '@/lib/mixarControlo';
import { colors } from '@/lib/theme';
import { Icon, type IconName } from '../Icon';
import { ActivityIndicator } from '../PontoLoader';
import { Sheet } from '../Sheet';

type Api = typeof mixarControloApi;

/**
 * O menu de um item do Mixar (o botão «Mais» nas ações do lado): «Menos disto» (o tema e o autor pesam menos neste Mixar)
 * e «Não quero «Tema» no nosso Mixar» (sai do feed dos dois). Só vale neste Mixar; o feed normal não muda.
 * Com `send`, em primeiro lugar «Mandar a Ana» (para a vossa conversa): o carril já tem a Conversa e o Guardar do Mixar
 * (MixarSocial) por baixo das ações da tcheka e não cabia mais um botão num telemóvel.
 */
export function MixarItemMenu({ item, onLess, onOff, onClose, send }: {
  item: MixarItem;
  onLess: () => void;
  onOff: (topic: string) => void;
  onClose: () => void;
  /** «Mandar» para o chat da outra pessoa (`done`: já foi). */
  send?: { partner: string; done: boolean; onPress: () => void };
}) {
  const t = item.topic;
  return (
    <Sheet title="Neste Mixar" onClose={onClose} variant="menu">
      <View style={{ paddingHorizontal: 8, paddingBottom: 8 }}>
        {send ? (
          <MenuRow
            icon={send.done ? 'check' : 'send'}
            title={send.done ? `Enviado a ${send.partner}` : `Enviar a ${send.partner}`}
            line={send.done ? 'Já está na vossa conversa.' : 'Vai para a vossa conversa, como qualquer publicação partilhada.'}
            onPress={() => { onClose(); if (!send.done) send.onPress(); }}
          />
        ) : null}
        <MenuRow icon="sliders" title="Menos disto" line={`Menos ${t ? `de ${t.label} e ` : ''}de @${item.post.author.username} neste Mixar`} onPress={() => { onClose(); onLess(); }} />
        {t ? <MenuRow icon="eye-off" title={offActionText(t.label)} line="Sai do vosso feed a dois. Podes voltar a pôr nos temas do Mixar." onPress={() => { onClose(); onOff(t.topic); }} /> : null}
      </View>
    </Sheet>
  );
}

function MenuRow({ icon, title, line, onPress }: { icon: IconName; title: string; line: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={(s) => [st.menuRow, ((s as { hovered?: boolean }).hovered || s.pressed) && { backgroundColor: colors.zinc100 }]} accessibilityRole="button" accessibilityLabel={`${title}. ${line}`}>
      <View style={st.menuIcon}><Icon name={icon} size={20} color={colors.zinc800} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={st.menuTitle}>{title}</Text>
        <Text style={st.menuLine}>{line}</Text>
      </View>
    </Pressable>
  );
}

/**
 * «Temas do Mixar»: o que tirei (volto a pôr), o que o outro tirou (só se mostra), o que tem «menos» (volta ao normal) e os
 * outros temas para tirar («Não quero isto no nosso Mixar»), primeiro os deste Mixar. Em baixo, os Temas privados.
 */
export function MixarTopicsSheet({ mixar, partner, api, onClose, onPrivate }: { mixar: Mixar; partner: string; api: Api; onClose: () => void; onPrivate: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: mixarControloKeys.topics(mixar.id), queryFn: () => api.topics(mixar.id) });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [all, setAll] = useState(false);
  const s = topicSections(q.data, mixar, partner);

  async function change(r: TopicRow) {
    const mode: MixarTopicMode | null = r.action === 'off' ? 'off' : null;
    if (r.action === 'none' || busy) return;
    setBusy(r.topic);
    setErr('');
    try {
      qc.setQueryData(mixarControloKeys.topics(mixar.id), await api.setTopic(mixar.id, r.topic, mode));
      // O feed de hoje e o cabeçalho (match, temas) mudam logo.
      void qc.invalidateQueries({ queryKey: ['mixar', mixar.id] });
    } catch {
      setErr('Não consegui mudar agora. Tenta outra vez.');
    } finally {
      setBusy(null);
    }
  }

  const ofMixar = s.rest.filter((r) => r.line);
  const others = s.rest.filter((r) => !r.line);
  return (
    <Sheet title="Temas do Mixar" onClose={onClose}>
      <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}>
        <Text style={st.intro}>Só vale para este Mixar com {partner}. O teu feed normal não muda.</Text>
        {q.isPending ? <ActivityIndicator style={{ margin: 24 }} color={colors.brand} /> : null}
        {q.isError ? <Text style={st.empty}>Não consegui abrir os temas. Tenta outra vez daqui a pouco.</Text> : null}
        {err ? <Text style={st.err} accessibilityRole="alert">{err}</Text> : null}
        {q.data ? (
          <>
            <Block title="Tirados do vosso Mixar" rows={s.off} empty="Nada tirado. Tira um tema e deixa de aparecer aos dois." busy={busy} onPress={change} />
            {s.less.length ? <Block title="Com menos" rows={s.less} busy={busy} onPress={change} /> : null}
            {q.data.lessAuthors > 0 ? <Text style={st.note}>Pediste menos de {q.data.lessAuthors === 1 ? '1 pessoa' : `${q.data.lessAuthors} pessoas`} neste Mixar.</Text> : null}
            <Block title="Neste Mixar" rows={ofMixar} empty="Ainda a descobrir os vossos temas." busy={busy} onPress={change} />
            {all ? <Block title="Outros temas" rows={others} busy={busy} onPress={change} /> : (
              <Pressable onPress={() => setAll(true)} style={({ pressed }) => [st.more, pressed && { opacity: 0.6 }]} accessibilityRole="button">
                <Text style={st.moreText}>Ver todos os temas</Text>
                <Icon name="chevron-right" size={16} color={colors.brand} />
              </Pressable>
            )}
          </>
        ) : null}
        <Pressable onPress={onPrivate} style={({ pressed }) => [st.private, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <View style={st.menuIcon}><Icon name="lock" size={18} color={colors.zinc800} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.menuTitle}>Temas privados</Text>
            <Text style={st.menuLine}>Temas que nunca aparecem nos teus Mixar nem nos temas em comum.</Text>
          </View>
          <Icon name="chevron-right" size={18} color="#a1a1aa" />
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}

function Block({ title, rows, empty, busy, onPress }: { title: string; rows: TopicRow[]; empty?: string; busy: string | null; onPress: (r: TopicRow) => void }) {
  if (!rows.length && !empty) return null;
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={st.section} accessibilityRole="header">{title}</Text>
      {rows.length ? rows.map((r) => (
        <View key={r.topic} style={st.row}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={st.rowTitle} numberOfLines={1}>{r.label}</Text>
            {r.line ? <Text style={st.rowLine} numberOfLines={1}>{r.line}</Text> : null}
          </View>
          {r.button ? (
            <Pressable
              onPress={() => onPress(r)}
              disabled={!!busy}
              style={({ pressed }) => [r.action === 'off' ? st.btnGhost : st.btn, pressed && { opacity: 0.7 }, !!busy && busy !== r.topic && { opacity: 0.5 }]}
              accessibilityRole="button"
              accessibilityLabel={r.action === 'off' ? offActionText(r.label) : `${r.button}: ${r.label}`}
            >
              {busy === r.topic ? <ActivityIndicator color={r.action === 'off' ? colors.brand : '#fff'} /> : <Text style={r.action === 'off' ? st.btnGhostText : st.btnText}>{r.button}</Text>}
            </Pressable>
          ) : <Icon name="lock" size={16} color={colors.zinc300} />}
        </View>
      )) : <Text style={st.empty}>{empty}</Text>}
    </View>
  );
}

const st = StyleSheet.create({
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  menuIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  menuTitle: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  menuLine: { marginTop: 1, fontSize: 13, color: colors.zinc500 },
  intro: { fontSize: 14, lineHeight: 20, color: colors.zinc600 },
  note: { marginTop: 8, fontSize: 13, color: colors.zinc500 },
  err: { marginTop: 10, fontSize: 14, color: colors.red600 },
  section: { marginBottom: 6, fontSize: 12, fontWeight: '800', letterSpacing: 1, color: colors.zinc500, textTransform: 'uppercase' },
  empty: { fontSize: 14, color: colors.zinc500 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.zinc100 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  rowLine: { marginTop: 1, fontSize: 13, color: colors.zinc500 },
  btn: { minHeight: 36, minWidth: 96, borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  btnGhost: { minHeight: 36, minWidth: 72, borderRadius: 999, borderWidth: 1, borderColor: colors.zinc200, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  btnGhostText: { color: colors.zinc800, fontSize: 14, fontWeight: '700' },
  more: { marginTop: 14, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  moreText: { color: colors.brand, fontSize: 15, fontWeight: '700' },
  private: { marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: colors.zinc100, padding: 12 },
});
