import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, type ReportReason, type ReportType } from '@/lib/api';
import { colors } from '@/lib/theme';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

const REASONS: { value: ReportReason; label: string; text: string }[] = [
  { value: 'spam', label: 'Spam', text: 'Publicidade, repetição ou ligações suspeitas.' },
  { value: 'harassment', label: 'Assédio ou bullying', text: 'Ataques, ameaças ou perseguição.' },
  { value: 'hate', label: 'Discurso de ódio', text: 'Discriminação ou ataques a um grupo.' },
  { value: 'nudity', label: 'Nudez ou conteúdo sexual', text: 'Conteúdo impróprio.' },
  { value: 'violence', label: 'Violência', text: 'Violência explícita ou apelo à violência.' },
  { value: 'scam', label: 'Burla ou fraude', text: 'Tentativa de enganar ou roubar.' },
  { value: 'impersonation', label: 'Faz-se passar por outra pessoa', text: 'Conta ou conteúdo falso.' },
  { value: 'minor', label: 'Envolve menores', text: 'Conteúdo que põe crianças em risco.' },
  { value: 'other', label: 'Outro motivo', text: 'Algo que não está na lista.' },
];

/** O que se está a denunciar, para o título da folha. */
const WHAT: Record<ReportType, string> = {
  post: 'esta publicação', comment: 'este comentário', story: 'este mimo', story_comment: 'este comentário', instant: 'este Zás', user: 'esta conta', message: 'esta mensagem', venue: 'este local',
};

/**
 * Denunciar uma publicação, comentário, mimo, Zás, mensagem, conta ou local. Fica para a moderação analisar; a outra pessoa
 * não é avisada, e o que denunciaste deixa de te aparecer (o servidor esconde-o; `onReported` deixa o ecrã escondê-lo já).
 */
export function ReportSheet({ type, id, onClose, onReported }: { type: ReportType; id: string; onClose: () => void; onReported?: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  async function send() {
    if (!reason) return;
    setBusy(true);
    setErr('');
    try {
      await api.report(type, id, reason, note.trim() || undefined);
      setDone(true);
      onReported?.();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Sheet title="Denúncia enviada" onClose={onClose}>
        <View style={{ paddingHorizontal: 24, alignItems: 'center' }}>
          <Icon name="check-circle" size={44} color={colors.zinc300} />
          <Text style={styles.thanks}>Obrigado por avisares</Text>
          <Text style={styles.sub}>Vamos analisar, com o objetivo de decidir em menos de 24 horas. A outra pessoa não sabe que foste tu{type === 'user' || type === 'venue' ? '' : ', e deixas de ver o que denunciaste'}. Se quiseres, podes também bloqueá-la no perfil.</Text>
          <Pressable onPress={onClose} style={styles.cta}><Text style={styles.ctaText}>Fechar</Text></Pressable>
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet title={`Porque queres denunciar ${WHAT[type]}?`} onClose={onClose}>
      <ScrollView style={{ paddingHorizontal: 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 8 }} accessibilityRole="radiogroup">
          {REASONS.map((r) => {
            const on = reason === r.value;
            return (
              <Pressable key={r.value} onPress={() => setReason(r.value)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[styles.reason, on ? { borderColor: colors.brand, backgroundColor: colors.rose50 } : { borderColor: colors.zinc200 }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.reasonTitle}>{r.label}</Text>
                  <Text style={styles.reasonText}>{r.text}</Text>
                </View>
                <View style={[styles.radio, on ? { borderColor: colors.brand, backgroundColor: colors.brand } : { borderColor: colors.zinc300 }]}>{on && <Icon name="check" size={14} color="#fff" strokeWidth={3} />}</View>
              </Pressable>
            );
          })}
        </View>
        {reason && <TextInput value={note} onChangeText={setNote} maxLength={500} multiline placeholder="Queres acrescentar algo? (opcional)" placeholderTextColor={colors.zinc500} style={styles.note} accessibilityLabel="Nota" />}
        {err ? <Text style={styles.err}>{err}</Text> : null}
        <Pressable disabled={!reason || busy} onPress={() => void send()} style={[styles.cta, (!reason || busy) && { opacity: 0.4 }]}>
          <Text style={styles.ctaText}>{busy ? 'A enviar…' : 'Enviar denúncia'}</Text>
        </Pressable>
        <View style={{ height: 8 }} />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  reason: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 2, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 },
  reasonTitle: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  reasonText: { fontSize: 14, color: colors.zinc600 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  note: { marginTop: 12, borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, minHeight: 64, textAlignVertical: 'top', color: colors.zinc900 },
  err: { marginTop: 8, textAlign: 'center', fontSize: 14, color: colors.red600 },
  cta: { marginTop: 16, height: 48, borderRadius: 24, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  thanks: { marginTop: 12, fontSize: 18, fontWeight: '600', color: colors.zinc900 },
  sub: { marginTop: 4, marginBottom: 20, textAlign: 'center', fontSize: 16, color: colors.zinc600 },
});
