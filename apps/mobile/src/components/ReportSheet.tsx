import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, type ReportReason, type ReportType } from '@/lib/api';
import { notesApi } from '@/lib/api.notes';
import { txilladaApi } from '@/lib/api.txillada';
import { colors } from '@/lib/theme';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import { t } from '@/lib/i18n';

const REASONS: { value: ReportReason; label: string; text: string }[] = [
  { value: 'spam', get label() { return t('Spam'); }, get text() { return t('Publicidade, repetição ou ligações suspeitas.'); } },
  { value: 'harassment', get label() { return t('Assédio ou bullying'); }, get text() { return t('Ataques, ameaças ou perseguição.'); } },
  { value: 'hate', get label() { return t('Discurso de ódio'); }, get text() { return t('Discriminação ou ataques a um grupo.'); } },
  { value: 'nudity', get label() { return t('Nudez ou conteúdo sexual'); }, get text() { return t('Conteúdo impróprio.'); } },
  { value: 'violence', get label() { return t('Violência'); }, get text() { return t('Violência explícita ou apelo à violência.'); } },
  { value: 'scam', get label() { return t('Burla ou fraude'); }, get text() { return t('Tentativa de enganar ou roubar.'); } },
  { value: 'impersonation', get label() { return t('Faz-se passar por outra pessoa'); }, get text() { return t('Conta ou conteúdo falso.'); } },
  { value: 'minor', get label() { return t('Envolve menores'); }, get text() { return t('Conteúdo que põe crianças em risco.'); } },
  { value: 'other', get label() { return t('Outro motivo'); }, get text() { return t('Algo que não está na lista.'); } },
];

/** O que se pode denunciar: os tipos de POST /reports e os que têm rota própria (Txillada, agendada, comentário dela, nota). */
type ReportWhat = ReportType | 'txillada' | 'txillada_comment' | 'txillada_schedule' | 'note';

/** O que se está a denunciar, para o título da folha. */
const WHAT: Record<ReportWhat, string> = {
  get note() { return t('esta nota'); }, get txillada() { return t('esta Txillada'); }, get txillada_schedule() { return t('esta Txillada agendada'); }, get txillada_comment() { return t('este comentário'); }, get post() { return t('esta publicação'); }, get comment() { return t('este comentário'); }, get story() { return t('este mimo'); }, get story_comment() { return t('este comentário'); }, get instant() { return t('este Zás'); }, get user() { return t('esta conta'); }, get message() { return t('esta mensagem'); }, get venue() { return t('este local'); }, get mixar_comment() { return t('este comentário'); },
};

/**
 * Denunciar uma publicação, comentário, mimo, Zás, mensagem, nota, conta ou local. Fica para a moderação analisar; a outra pessoa
 * não é avisada, e o que denunciaste deixa de te aparecer (o servidor esconde-o; `onReported` deixa o ecrã escondê-lo já).
 * Uma Txillada (o live) vai por POST /txilladas/:id/report, só com o motivo (docs/txillada-contrato.md); um comentário
 * de uma Txillada ('txillada_comment', `id` = o comentário e `txilladaId` = a Txillada) por POST /txilladas/:id/comments/:c/report.
 * Uma Txillada agendada ('txillada_schedule', docs/txillada-agendar.md) por POST /txilladas/schedules/:id/report.
 * Uma nota ('note', `id` = o username de quem a escreveu) por POST /notes/:username/report.
 */
export function ReportSheet({ type, id, txilladaId, onClose, onReported }: { type: ReportWhat; id: string; txilladaId?: string; onClose: () => void; onReported?: () => void }) {
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
      if (type === 'txillada') await txilladaApi.report(id, reason);
      else if (type === 'txillada_schedule') await txilladaApi.reportSchedule(id, reason, note.trim() || undefined);
      else if (type === 'note') await notesApi.report(id, reason, note.trim() || undefined);
      else if (type === 'txillada_comment') await txilladaApi.reportComment(txilladaId ?? '', id, reason, note.trim() || undefined);
      else await api.report(type, id, reason, note.trim() || undefined);
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
      <Sheet title={t('Denúncia enviada')} onClose={onClose}>
        <View style={{ paddingHorizontal: 24, alignItems: 'center' }}>
          <Icon name="check-circle" size={44} color={colors.zinc300} />
          <Text style={styles.thanks}>{t('Obrigado por avisares')}</Text>
          <Text style={styles.sub}>{type === 'user' || type === 'venue' || type === 'txillada' ? t('Vamos analisar, com o objetivo de decidir em menos de 24 horas. A outra pessoa não sabe que foste tu. Se quiseres, podes também bloqueá-la no perfil.') : t('Vamos analisar, com o objetivo de decidir em menos de 24 horas. A outra pessoa não sabe que foste tu, e deixas de ver o que denunciaste. Se quiseres, podes também bloqueá-la no perfil.')}</Text>
          <Pressable onPress={onClose} style={styles.cta}><Text style={styles.ctaText}>{t('Fechar')}</Text></Pressable>
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet title={t('Porque queres denunciar {what}?', { what: WHAT[type] })} onClose={onClose}>
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
        {reason && type !== 'txillada' && <TextInput value={note} onChangeText={setNote} maxLength={500} multiline placeholder={t('Queres acrescentar algo? (opcional)')} placeholderTextColor={colors.zinc500} style={styles.note} accessibilityLabel={t('Nota')} />}
        {err ? <Text style={styles.err}>{err}</Text> : null}
        <Pressable disabled={!reason || busy} onPress={() => void send()} style={[styles.cta, (!reason || busy) && { opacity: 0.4 }]}>
          <Text style={styles.ctaText}>{busy ? t('A enviar…') : t('Enviar denúncia')}</Text>
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
