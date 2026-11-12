import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { ReportSheet } from '@/components/ReportSheet';
import { Sheet } from '@/components/Sheet';
import { REACTIONS, ReactionArt } from '@/components/StoryParts';
import { api, raw } from '@/lib/api';
import { applyDeletionToPages, applyEditToPages, copyText, deleteChoices, messageOptions, type DeleteMode } from '@/lib/messageMenu';
import { colors } from '@/lib/theme';
import { useDeskChat } from '@/lib/deskChat';
import { DeskMenu, type DeskMenuItem } from './DeskMenu';
import type { MenuAt, MenuMode, Msg } from './ChatBubbles';

/** Esqueleto a pulsar (como o animate-pulse do site): opacidade 1 -> 0.5 -> 1 em 2 s. */
export function Pulse({ children, style }: { children?: ReactNode; style?: object }) {
  const o = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([Animated.timing(o, { toValue: 0.5, duration: 1000, useNativeDriver: true }), Animated.timing(o, { toValue: 1, duration: 1000, useNativeDriver: true })]));
    a.start();
    return () => a.stop();
  }, [o]);
  return <Animated.View style={[style, { opacity: o }]}>{children}</Animated.View>;
}

/** Tirar a minha reação a uma mensagem (o `api.ts` só tem o pôr). */
export const unreact = (id: string): Promise<void> => raw(`/chat/messages/${id}/reaction`, { method: 'DELETE' }) as Promise<void>;
/** "Estou a escrever…" para a outra pessoa (no máximo de 3 em 3 segundos). */
export const sendTyping = (username: string): Promise<void> => raw(`/chat/with/${encodeURIComponent(username)}/typing`, { method: 'POST', body: '{}' }) as Promise<void>;
export const stopLiveShare = (id: string): Promise<void> => raw(`/chat/messages/${id}/live`, { method: 'DELETE' }) as Promise<void>;

/** A chave da conversa no react-query: ['chat-thread', username] ou ['chat-group', id]. */
export type ChatCacheKey = readonly unknown[];

/**
 * Gravar a edição de uma mensagem: mostra logo o texto novo (otimista), grava no servidor e põe a conversa em dia.
 * Se falhar, volta ao que estava e lança o erro do servidor (ex.: "Já passaram 15 minutos…").
 */
export async function saveEdit(qc: ReturnType<typeof useQueryClient>, cacheKey: ChatCacheKey, id: string, body: string) {
  const before = qc.getQueryData(cacheKey);
  qc.setQueryData(cacheKey, (d: unknown) => applyEditToPages(d, id, body));
  try {
    await api.chatEdit(id, body.trim());
  } catch (e) {
    if (before !== undefined) qc.setQueryData(cacheKey, before);
    throw e;
  } finally {
    void qc.invalidateQueries({ queryKey: cacheKey });
    void qc.invalidateQueries({ queryKey: ['chat-list'] });
    void qc.invalidateQueries({ queryKey: ['chat-groups'] });
  }
}

/**
 * Menu de uma mensagem (carregar e segurar), como no WhatsApp: reações, responder, copiar, editar (as minhas de texto, nos
 * primeiros 15 minutos), apagar e denunciar (as dos outros). As opções vêm de lib/messageMenu (minha/outra, tempo e tipo).
 * Apagar pede sempre confirmação ("Apagar mensagem?": para todos, só nas minhas; para mim, em qualquer uma; cancelar).
 * `start="delete"` abre logo a confirmação (a ação "Apagar" do leitor de ecrã).
 */
export function MessageMenu({ m, cacheKey, start, at, mode, onClose, onReply, onEdit, onDone, onError }: {
  m: Msg;
  /** Computador: abre como menu de contexto neste ponto (botão direito ou "⋯") em vez da folha. */
  at?: MenuAt;
  /** 'react': só as reações (o botão "Reagir" que aparece ao passar o rato). */
  mode?: MenuMode;
  /** A conversa no react-query, para apagar sem esperar pelo servidor. */
  cacheKey: ChatCacheKey;
  start?: 'delete';
  onClose: () => void;
  onReply: (m: Msg) => void;
  /** "Editar": a conversa abre a barra de edição com o texto. */
  onEdit?: (m: Msg) => void;
  onDone: () => void;
  onError: (e: string) => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState<'menu' | 'delete' | 'report'>(start === 'delete' ? 'delete' : 'menu');
  const opts = messageOptions(m);
  const desk = useDeskChat();
  const keep = useRef(false);
  async function react(id: string, already: boolean) {
    onClose();
    try {
      if (already) await unreact(m.id);
      else await api.chatReact(m.id, id);
      onDone();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function remove(mode: DeleteMode) {
    onClose();
    // Sai (ou fica o aviso) logo; se o servidor recusar, volta como estava e diz porquê.
    const before = qc.getQueryData(cacheKey);
    void qc.cancelQueries({ queryKey: cacheKey });
    qc.setQueryData(cacheKey, (d: unknown) => applyDeletionToPages(d, m.id, mode));
    try {
      if (mode === 'all') await api.chatDelete(m.id);
      else await api.chatHide(m.id);
      onError('');
    } catch (e) {
      if (before !== undefined) qc.setQueryData(cacheKey, before);
      onError(`Não consegui apagar a mensagem: ${(e as Error).message}`);
    }
    onDone();
    void qc.invalidateQueries({ queryKey: ['chat-list'] });
    void qc.invalidateQueries({ queryKey: ['chat-groups'] });
  }
  async function copy() {
    onClose();
    await Clipboard.setStringAsync(copyText(m)).catch(() => onError('Não consegui copiar o texto.'));
  }

  if (step === 'report') return <ReportSheet type="message" id={m.id} onReported={onDone} onClose={() => { setStep('menu'); onClose(); }} />;

  if (step === 'delete') {
    const choices = deleteChoices(opts);
    const btn = (label: string, run: () => void, tone: 'danger' | 'plain') => (
      <Pressable key={label} onPress={run} style={({ pressed }) => [st.askBtn, { backgroundColor: tone === 'danger' ? (pressed ? '#fee2e2' : '#fef2f2') : pressed ? colors.zinc200 : colors.zinc100 }]} accessibilityRole="button">
        <Text style={[st.askBtnText, { color: tone === 'danger' ? '#b91c1c' : colors.zinc800 }]}>{label}</Text>
      </Pressable>
    );
    return (
      <Sheet title="Apagar mensagem?" onClose={onClose}>
        <View style={{ paddingHorizontal: 20 }}>
          <Text style={st.askText}>
            {opts.deleteForAll
              ? '"Apagar para todos" tira-a da conversa para toda a gente (fica o aviso "Esta mensagem foi apagada"). "Apagar para mim" tira-a só da tua conversa.'
              : 'Sai só da tua conversa: os outros continuam a vê-la.'}
          </Text>
          {choices.map((c) => (c === 'all' ? btn('Apagar para todos', () => void remove('all'), 'danger') : btn('Apagar para mim', () => void remove('me'), 'danger')))}
          {btn('Cancelar', onClose, 'plain')}
        </View>
      </Sheet>
    );
  }

  // Computador: o menu de contexto junto ao ponteiro, com as reações em cima e as mesmas opções da folha.
  // Apagar e Denunciar continuam a pedir confirmação nas folhas de sempre.
  if (at && desk) {
    const items: DeskMenuItem[] = mode === 'react' ? [] : [
      ...(opts.reply ? [{ id: 'reply', label: 'Responder', icon: 'reply' as const, onPress: () => onReply(m) }] : []),
      ...(opts.copy ? [{ id: 'copy', label: 'Copiar', icon: 'file-text' as const, onPress: () => void copy() }] : []),
      ...(opts.edit && onEdit ? [{ id: 'edit', label: 'Editar', icon: 'pencil' as const, onPress: () => onEdit(m) }] : []),
      ...(opts.deleteForMe ? [{ id: 'delete', label: 'Apagar…', icon: 'trash' as const, danger: true, onPress: () => setStep('delete') }] : []),
      ...(opts.report ? [{ id: 'report', label: 'Denunciar mensagem…', icon: 'flag' as const, onPress: () => setStep('report') }] : []),
    ];
    // Escolher uma opção corre-a e fecha o menu; as que levam a uma folha (apagar, denunciar) mantêm este componente vivo.
    const close = () => { if (keep.current) { keep.current = false; return; } onClose(); };
    return (
      <DeskMenu
        at={at}
        label={mode === 'react' ? 'Reagir à mensagem' : 'Opções da mensagem'}
        items={items.map((it) => ({ ...it, onPress: () => { if (it.id === 'delete' || it.id === 'report') keep.current = true; it.onPress(); } }))}
        onClose={close}
        header={opts.react ? (
          <View style={[st.deskReacts, mode !== 'react' && st.deskReactsLine]} accessibilityRole="toolbar" accessibilityLabel="Reagir">
            {REACTIONS.map((r) => {
              const mine = !!m.reactions?.some((x) => x.mine && x.reaction === r.id);
              return (
                <Pressable key={r.id} onPress={() => void react(r.id, mine)} accessibilityRole="button" accessibilityLabel={r.label} accessibilityState={{ selected: mine }} style={(s) => [st.deskReact, ((s as { hovered?: boolean }).hovered || mine) && { backgroundColor: mine ? 'rgba(214,51,79,0.15)' : colors.zinc100 }, s.pressed && { transform: [{ scale: 0.9 }] }]}>
                  <ReactionArt body={r.id} size={26} />
                </Pressable>
              );
            })}
          </View>
        ) : null}
      />
    );
  }

  const row = (icon: IconName, title: string, sub: string | null, run: () => void, danger = false) => (
    <Pressable key={title} onPress={run} style={({ pressed }) => [st.row, pressed && { backgroundColor: danger ? '#fef2f2' : colors.zinc100 }]} accessibilityRole="button">
      <View style={[st.rowIcon, danger && { backgroundColor: '#fef2f2' }]}><Icon name={icon} size={22} color={danger ? '#b91c1c' : colors.zinc800} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[st.rowTitle, danger && { color: '#b91c1c' }]}>{title}</Text>
        {sub ? <Text style={st.rowSub}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
  return (
    <Sheet title="Mensagem" onClose={onClose}>
      <View style={{ paddingHorizontal: 20 }}>
        {opts.react && (
          <View style={st.reacts} accessibilityRole="toolbar" accessibilityLabel="Reagir">
            {REACTIONS.map((r) => {
              const mine = !!m.reactions?.some((x) => x.mine && x.reaction === r.id);
              return (
                <Pressable key={r.id} onPress={() => void react(r.id, mine)} accessibilityRole="button" accessibilityLabel={r.label} accessibilityState={{ selected: mine }} style={({ pressed }) => [st.react, mine && { backgroundColor: 'rgba(214,51,79,0.15)', borderWidth: 2, borderColor: 'rgba(214,51,79,0.4)' }, pressed && { transform: [{ scale: 0.9 }] }]}>
                  <ReactionArt body={r.id} size={34} />
                </Pressable>
              );
            })}
          </View>
        )}
        {opts.reply && row('reply', 'Responder', null, () => { onClose(); onReply(m); })}
        {opts.copy && row('file-text', 'Copiar', null, () => void copy())}
        {opts.edit && onEdit && row('pencil', 'Editar', 'Até 15 minutos depois de enviar.', () => { onClose(); onEdit(m); })}
        {opts.deleteForMe && row('trash', 'Apagar', opts.deleteForAll ? 'Para todos ou só para ti.' : 'Só para ti.', () => setStep('delete'), true)}
        {opts.report && row('flag', 'Denunciar mensagem', 'Avisa a moderação. A pessoa não sabe.', () => setStep('report'))}
      </View>
    </Sheet>
  );
}

/** Pedido de mensagem: aceitar, recusar ou bloquear. */
export function RequestBar({ name, bottom, onAccept, onDecline, onBlock }: { name: string; bottom: number; onAccept: () => void; onDecline: () => void; onBlock: () => void }) {
  return (
    <View style={[st.request, { paddingBottom: Math.max(bottom, 14) }]}>
      <Text style={st.requestText}><Text style={{ fontWeight: '700' }}>Pedido de mensagem.</Text> Não segues {name}. Se aceitares, podem falar à vontade; se recusares, não és incomodado.</Text>
      <View style={{ marginTop: 12, flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={onAccept} style={[st.btn, { backgroundColor: colors.brand }]} accessibilityRole="button"><Text style={[st.btnText, { color: '#fff', fontWeight: '700' }]}>Aceitar</Text></Pressable>
        <Pressable onPress={onDecline} style={[st.btn, { backgroundColor: colors.zinc100 }]} accessibilityRole="button"><Text style={[st.btnText, { color: colors.zinc800 }]}>Recusar</Text></Pressable>
        <Pressable onPress={onBlock} style={[st.btn, { backgroundColor: colors.zinc100 }]} accessibilityRole="button"><Text style={[st.btnText, { color: '#b91c1c' }]}>Bloquear</Text></Pressable>
      </View>
    </View>
  );
}

/** Aviso no topo quando a outra pessoa não te segue. */
export function NotFollowingNote({ name, left }: { name: string; left: number | null }) {
  return (
    <View style={st.note} accessibilityRole="summary">
      <View style={{ alignItems: 'center', marginBottom: 4 }}><Icon name="info" size={16} color={colors.zinc500} /></View>
      <Text style={st.noteText}>
        <Text style={{ fontWeight: '700', color: colors.zinc800 }}>{name} não te segue.</Text> Pode não ver nem responder à tua mensagem.
      </Text>
      {left !== null ? <Text style={st.noteText}>{left > 0 ? `Podes enviar mais ${left} ${left === 1 ? 'mensagem' : 'mensagens'} até responder.` : 'Aguarda que responda, aceite ou te siga para escreveres outra vez.'}</Text> : null}
    </View>
  );
}

/** Data entre mensagens de dias diferentes. */
export function DayDivider({ label }: { label: string }) {
  return <Text style={st.day}>{label.toUpperCase()}</Text>;
}

const st = StyleSheet.create({
  reacts: { flexDirection: 'row', justifyContent: 'space-between', gap: 4, paddingBottom: 8 },
  deskReacts: { flexDirection: 'row', gap: 2, paddingHorizontal: 8, paddingVertical: 4 },
  deskReactsLine: { borderBottomWidth: 1, borderBottomColor: colors.zinc100, marginBottom: 4, paddingBottom: 8 },
  deskReact: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  react: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: 16, paddingHorizontal: 4, paddingVertical: 12 },
  rowIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 17, fontWeight: '600', color: colors.zinc900 },
  rowSub: { fontSize: 14, color: colors.zinc600 },
  askText: { paddingHorizontal: 4, paddingBottom: 12, fontSize: 15, lineHeight: 21, color: colors.zinc600 },
  askBtn: { height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  askBtnText: { fontSize: 17, fontWeight: '600' },
  request: { borderTopWidth: 1, borderTopColor: colors.zinc100, paddingHorizontal: 16, paddingTop: 12 },
  requestText: { textAlign: 'center', fontSize: 14, lineHeight: 19, color: colors.zinc700 },
  btn: { flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontWeight: '600' },
  note: { alignSelf: 'center', marginTop: 12, marginBottom: 8, maxWidth: 384, borderRadius: 16, backgroundColor: '#fafafa', borderWidth: 1, borderColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 12 },
  noteText: { textAlign: 'center', fontSize: 13, lineHeight: 18, color: colors.zinc600 },
  day: { alignSelf: 'center', marginTop: 24, marginBottom: 8, fontSize: 12, fontWeight: '600', letterSpacing: 0.6, color: colors.zinc500 },
});
