import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { api, onNeedVerify } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';

/** Abrir a caixa de correio certa (Gmail, Outlook, Yahoo) pelo domínio do e-mail; senão, a app de e-mail do telemóvel. */
function inboxUrl(email: string): string | null {
  const d = email.split('@')[1]?.toLowerCase() ?? '';
  if (d === 'gmail.com' || d === 'googlemail.com') return 'https://mail.google.com/mail/u/0/#inbox';
  if (/^(outlook|hotmail|live|msn)\./.test(d)) return 'https://outlook.live.com/mail/0/inbox';
  if (d.startsWith('yahoo.')) return 'https://mail.yahoo.com';
  if (d === 'icloud.com' || d === 'me.com') return 'https://www.icloud.com/mail';
  return Platform.OS === 'web' ? null : 'message://';
}

/**
 * "Ativa a tua conta": abre sozinha, em qualquer ecrã, quando a pessoa tenta publicar, comentar, mandar mensagem ou
 * presentear sem ter confirmado o e-mail. Mostra o e-mail (para ver se está bem escrito), reenvia o link, abre o correio
 * e deixa corrigir o e-mail. "Já ativei" confirma com o servidor.
 */
export function ActivateSheet() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => onNeedVerify(() => { setOpen(true); setNote(''); setEditing(false); }), []);
  const status = useQuery({ queryKey: ['email-status'], queryFn: api.emailStatus, enabled: open && !!user, staleTime: 0 });
  const resend = useMutation({
    mutationFn: api.resendVerification,
    onSuccess: (r) => setNote(r.sent ? 'Link novo enviado. Vê também a pasta de spam ou promoções.' : 'Não consegui enviar agora. Tenta daqui a pouco.'),
    onError: () => setNote('Já pediste vários links. Espera um bocado e tenta outra vez.'),
  });
  const change = useMutation({
    mutationFn: (e: string) => api.changeEmail(e),
    onSuccess: (r) => {
      setEditing(false);
      setNote(`E-mail corrigido. Enviámos o link para ${r.email}.`);
      void qc.invalidateQueries({ queryKey: ['email-status'] });
    },
    onError: (e: Error) => setNote(e.message),
  });
  const check = useMutation({
    mutationFn: api.emailStatus,
    onSuccess: (r) => {
      qc.setQueryData(['email-status'], r);
      if (r.verified) setOpen(false);
      else setNote('Ainda não vimos a ativação. Abre o link do e-mail e volta aqui.');
    },
  });
  if (!open || !user) return null;
  if (status.data?.verified) return null;
  const email = status.data?.email ?? '';
  const inbox = email ? inboxUrl(email) : null;

  return (
    <Sheet title="Ativa a tua conta" onClose={() => setOpen(false)}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 16, gap: 14 }}>
        <View style={st.hero}>
          <View style={st.heroIcon}><Icon name="mail" size={26} color={colors.brand} /></View>
          <Text style={st.lead}>Para publicar, comentar, conversar e presentear, falta só confirmares o teu e-mail. É um toque no link que te mandámos.</Text>
        </View>

        {editing ? (
          <View style={{ gap: 10 }}>
            <TextInput value={draft} onChangeText={setDraft} autoFocus autoCapitalize="none" autoCorrect={false} keyboardType="email-address" inputMode="email" placeholder="o.teu@email.com" placeholderTextColor={colors.zinc500} style={st.input} accessibilityLabel="E-mail certo" onSubmitEditing={() => draft.trim() && change.mutate(draft.trim())} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setEditing(false)} style={[st.btnSoft, { flex: 1 }]} accessibilityRole="button"><Text style={st.btnSoftText}>Cancelar</Text></Pressable>
              <Pressable onPress={() => draft.trim() && change.mutate(draft.trim())} disabled={change.isPending || !draft.trim()} style={[st.btn, { flex: 1 }, (change.isPending || !draft.trim()) && { opacity: 0.6 }]} accessibilityRole="button">
                <Text style={st.btnText}>{change.isPending ? 'A guardar…' : 'Guardar e enviar'}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={st.emailBox}>
            <View style={{ flex: 1 }}>
              <Text style={st.emailLabel}>Enviámos para</Text>
              <Text style={st.email} numberOfLines={1}>{email || '…'}</Text>
            </View>
            <Pressable onPress={() => { setDraft(email); setEditing(true); setNote(''); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Corrigir o e-mail">
              <Text style={st.link}>Está errado?</Text>
            </Pressable>
          </View>
        )}

        {note ? <Text style={st.note} accessibilityLiveRegion="polite">{note}</Text> : null}

        {!editing ? (
          <>
            {inbox ? (
              <Pressable onPress={() => void Linking.openURL(inbox).catch(() => undefined)} style={st.btn} accessibilityRole="button">
                <Text style={st.btnText}>Abrir o meu e-mail</Text>
              </Pressable>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => resend.mutate()} disabled={resend.isPending} style={[st.btnSoft, { flex: 1 }, resend.isPending && { opacity: 0.6 }]} accessibilityRole="button">
                <Text style={st.btnSoftText}>{resend.isPending ? 'A enviar…' : 'Reenviar link'}</Text>
              </Pressable>
              <Pressable onPress={() => check.mutate()} disabled={check.isPending} style={[st.btnSoft, { flex: 1 }, check.isPending && { opacity: 0.6 }]} accessibilityRole="button">
                <Text style={st.btnSoftText}>{check.isPending ? 'A ver…' : 'Já ativei'}</Text>
              </Pressable>
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
  btn: { height: 50, borderRadius: 25, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnSoft: { height: 48, borderRadius: 24, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  btnSoftText: { color: colors.zinc900, fontSize: 15, fontWeight: '600' },
});
