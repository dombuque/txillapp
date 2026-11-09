import { useMutation, useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api, openActivate } from '@/lib/api';
import { colors } from '@/lib/theme';
import { Icon } from './Icon';

/** Aviso para quem ainda não confirmou o e-mail: sem isso não pode publicar, comentar, conversar nem presentear. */
export function EmailBanner() {
  const status = useQuery({ queryKey: ['email-status'], queryFn: api.emailStatus, staleTime: 60_000, refetchOnWindowFocus: true });
  const resend = useMutation({ mutationFn: api.resendVerification });
  if (!status.data?.required || status.data.verified) return null;
  const msg = resend.isSuccess && resend.data.sent
    ? 'Enviámos um link novo para o teu e-mail. Vê também o spam.'
    : resend.isError
      ? 'Não consegui reenviar agora. Tenta daqui a pouco.'
      : 'Ativa a tua conta para publicar, comentar e conversar: confirma o e-mail que te mandámos.';
  return (
    <Pressable onPress={openActivate} style={st.wrap} accessibilityRole="button" accessibilityLabel="Ativar a conta">
      <Icon name="mail" size={20} color="#b45309" />
      <Text style={st.text}>{msg}</Text>
      {!resend.isSuccess && (
        <Pressable onPress={() => resend.mutate()} disabled={resend.isPending} hitSlop={8} accessibilityRole="button">
          <Text style={[st.btn, resend.isPending && { opacity: 0.5 }]}>{resend.isPending ? 'A enviar…' : 'Reenviar'}</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

const st = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginHorizontal: 16, marginBottom: 12, borderRadius: 16, backgroundColor: '#fffbeb', paddingHorizontal: 16, paddingVertical: 12 },
  text: { flex: 1, fontSize: 14, lineHeight: 19, color: colors.zinc800 },
  btn: { fontSize: 14, fontWeight: '700', color: colors.brand, textDecorationLine: 'underline' },
});
