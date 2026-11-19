import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { Button } from '@/components/ui/Button';
import { api, onNeedVerify } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { t } from '@/lib/i18n';

/** Abrir a caixa de correio certa (Gmail, Outlook, Yahoo) pelo domínio do e-mail; senão, a app de e-mail do telemóvel. */
function inboxUrl(email: string): string | null {
  const d = email.split('@')[1]?.toLowerCase() ?? '';
  if (d === 'gmail.com' || d === 'googlemail.com') return 'https://mail.google.com/mail/u/0/#inbox';
  if (/^(outlook|hotmail|live|msn)\./.test(d)) return 'https://outlook.live.com/mail/0/inbox';
  if (d.startsWith('yahoo.')) return 'https://mail.yahoo.com';
  if (d === 'icloud.com' || d === 'me.com') return 'https://www.icloud.com/mail';
  return Platform.OS === 'web' ? null : 'message://';
}

/** Só os algarismos, no máximo 6 (colar «123 456» ou o assunto do e-mail inteiro também dá). */
export const codeDigits = (s: string): string => s.replace(/\D/g, '').slice(0, 6);
/** Segundos até se poder pedir outro código. */
export const RESEND_WAIT_S = 45;

/**
 * "Ativa a tua conta": abre logo a seguir a criar a conta e, em qualquer ecrã, quando a pessoa tenta publicar, comentar,
 * mandar mensagem ou presentear sem ter confirmado o e-mail. O principal é o código de 6 dígitos do e-mail, escrito aqui
 * sem sair da app (o teclado do iPhone e do Android propõe-no sozinho; aos 6 algarismos confirma). O link do e-mail
 * continua a valer: enquanto o painel está aberto, confirma de 4 em 4 s se a conta já foi ativada noutro lado.
 * Mostra o e-mail (para ver se está bem escrito), reenvia o código (com espera) e deixa corrigir o e-mail.
 */
export function ActivateSheet() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);
  const codeRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  useEffect(() => onNeedVerify(() => { setOpen(true); setNote(''); setEditing(false); setCode(''); }), []);
  const status = useQuery({ queryKey: ['email-status'], queryFn: api.emailStatus, enabled: open && !!user, staleTime: 0, refetchInterval: open ? 4000 : false });
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);
  const resend = useMutation({
    mutationFn: api.resendVerification,
    onSuccess: (r) => { setCode(''); setWait(RESEND_WAIT_S); setNote(r.sent ? t('Código novo enviado. Vê também a pasta de spam ou promoções.') : t('Não consegui enviar agora. Tenta daqui a pouco.')); },
    onError: () => setNote(t('Já pediste vários códigos. Espera um bocado e tenta outra vez.')),
  });
  const confirm = useMutation({
    mutationFn: (c: string) => api.verifyEmailCode(c),
    onSuccess: () => {
      qc.setQueryData(['email-status'], (old: { required: boolean; verified: boolean } | undefined) => ({ required: old?.required ?? true, verified: true }));
      setOpen(false);
    },
    onError: (e: Error) => { setNote(e.message); setCode(''); codeRef.current?.focus(); },
  });
  const typeCode = (s: string) => {
    const d = codeDigits(s);
    setCode(d);
    if (d.length === 6 && !confirm.isPending) confirm.mutate(d);
  };
  const change = useMutation({
    mutationFn: (e: string) => api.changeEmail(e),
    onSuccess: (r) => {
      setEditing(false);
      setNote(t('E-mail corrigido. Enviámos o código para {email}.', { email: r.email }));
      setCode('');
      setWait(RESEND_WAIT_S);
      void qc.invalidateQueries({ queryKey: ['email-status'] });
    },
    onError: (e: Error) => setNote(e.message),
  });
  const check = useMutation({
    mutationFn: api.emailStatus,
    onSuccess: (r) => {
      qc.setQueryData(['email-status'], r);
      if (r.verified) setOpen(false);
      else setNote(t('Ainda não vimos a ativação. Escreve o código do e-mail ou abre o link.'));
    },
  });
  if (!open || !user) return null;
  if (status.data?.verified) return null;
  const email = status.data?.email ?? '';
  const inbox = email ? inboxUrl(email) : null;

  return (
    <Sheet title={t('Ativa a tua conta')} onClose={() => setOpen(false)}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 16, gap: 14 }}>
        <View style={st.hero}>
          <View style={st.heroIcon}><Icon name="mail" size={26} color={colors.brand} /></View>
          <Text style={st.lead}>{t('Para publicar, comentar, conversar e oferecer vibes, falta só confirmares o teu e-mail. Escreve aqui o código de 6 dígitos que te mandámos.')}</Text>
        </View>

        {!editing ? (
          <Pressable onPress={() => codeRef.current?.focus()} accessible={false}>
            <View style={st.boxes} pointerEvents="none">
              {Array.from({ length: 6 }, (_, i) => (
                <View key={i} style={[st.box, i === code.length && st.boxOn, !!code[i] && st.boxFull]}>
                  <Text style={st.digit}>{code[i] ?? ''}</Text>
                </View>
              ))}
            </View>
            {/* Um só campo por baixo das caixas: o teclado numérico, o «colar» e a sugestão do código do e-mail. */}
            <TextInput
              ref={codeRef}
              value={code}
              onChangeText={typeCode}
              autoFocus
              keyboardType="number-pad"
              inputMode="numeric"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              maxLength={12}
              editable={!confirm.isPending}
              style={st.hiddenInput}
              accessibilityLabel={t('Código de 6 dígitos')}
              caretHidden
            />
          </Pressable>
        ) : null}
        {confirm.isPending ? <Text style={st.note}>{t('A confirmar…')}</Text> : null}

        {editing ? (
          <View style={{ gap: 10 }}>
            <TextInput value={draft} onChangeText={setDraft} autoFocus autoCapitalize="none" autoCorrect={false} keyboardType="email-address" inputMode="email" placeholder="o.teu@email.com" placeholderTextColor={colors.zinc500} style={st.input} accessibilityLabel={t('E-mail certo')} onSubmitEditing={() => draft.trim() && change.mutate(draft.trim())} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button label={t('Cancelar')} kind="secondary" onPress={() => setEditing(false)} style={st.half} />
              <Button label={t('Guardar e enviar')} onPress={() => draft.trim() && change.mutate(draft.trim())} loading={change.isPending} disabled={!draft.trim()} style={st.half} />
            </View>
          </View>
        ) : (
          <View style={st.emailBox}>
            <View style={{ flex: 1 }}>
              <Text style={st.emailLabel}>{t('Enviámos para')}</Text>
              <Text style={st.email} numberOfLines={1}>{email || '…'}</Text>
            </View>
            <Pressable onPress={() => { setDraft(email); setEditing(true); setNote(''); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Corrigir o e-mail')}>
              <Text style={st.link}>{t('Está errado?')}</Text>
            </Pressable>
          </View>
        )}

        {note ? <Text style={st.note} accessibilityLiveRegion="polite">{note}</Text> : null}

        {!editing ? (
          <>
            {inbox ? (
              <Button label={t('Abrir o meu e-mail')} onPress={() => void Linking.openURL(inbox).catch(() => undefined)} block />
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button label={wait > 0 ? t('Reenviar ({s} s)', { s: wait }) : t('Reenviar código')} kind="secondary" onPress={() => resend.mutate()} loading={resend.isPending} disabled={wait > 0} style={st.half} />
              <Button label={t('Já ativei')} kind="secondary" onPress={() => check.mutate()} loading={check.isPending} style={st.half} />
            </View>
          </>
        ) : null}
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  hero: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  heroIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center' },
  lead: { flex: 1, fontSize: 15, lineHeight: 21, color: colors.zinc800 },
  emailBox: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: colors.zinc100, paddingHorizontal: 16, paddingVertical: 12 },
  emailLabel: { fontSize: 13, color: colors.zinc500 },
  email: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  link: { fontSize: 14, fontWeight: '600', color: colors.brand },
  note: { fontSize: 14, color: colors.zinc700, lineHeight: 19 },
  input: { height: 48, borderRadius: 24, backgroundColor: colors.zinc100, paddingHorizontal: 18, fontSize: 16, color: colors.zinc900, outlineStyle: 'none' } as object,
  boxes: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  box: { flex: 1, maxWidth: 52, height: 58, borderRadius: 14, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  boxOn: { borderColor: colors.brand, backgroundColor: colors.white },
  boxFull: { backgroundColor: colors.white, borderColor: colors.zinc300 },
  digit: { fontSize: 26, fontWeight: '800', color: colors.zinc900, fontVariant: ['tabular-nums'] },
  /** O campo verdadeiro fica por cima das caixas, invisível (recebe o toque, o teclado e o código sugerido). */
  hiddenInput: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0.011, color: 'transparent', fontSize: 16, outlineStyle: 'none' } as object,
  /** Dois botões lado a lado. */
  half: { flex: 1, paddingHorizontal: 12 },
});
