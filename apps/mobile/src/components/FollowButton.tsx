import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { ApiError, api, type FollowState } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { colors } from '@/lib/theme';

/** Seguir / A seguir / Pedido enviado (perfis privados). Responde já e volta atrás se falhar. */
export function FollowButton({ username, following, requested, isPrivate, style }: { username: string; following: boolean; requested: boolean; isPrivate: boolean; style?: StyleProp<ViewStyle> }) {
  const qc = useQueryClient();
  const [s, setS] = useState({ following, requested });
  const [busy, setBusy] = useState(false);
  async function toggle() {
    if (busy) return;
    // Deixar de seguir uma conta privada: depois só se volta a ver com um pedido novo aceite. Pergunta antes.
    if (s.following && isPrivate) {
      const ok = await confirm({ title: `Deixar de seguir @${username}?`, message: 'Esta conta é privada. Se mudares de ideias, tens de pedir outra vez para seguir.', confirm: 'Deixar de seguir', danger: true });
      if (!ok) return;
    }
    setBusy(true);
    const prev = s;
    try {
      if (s.following || s.requested) {
        setS({ following: false, requested: false });
        await api.unfollow(username);
      } else {
        setS(isPrivate ? { following: false, requested: true } : { following: true, requested: false });
        const r: FollowState = await api.follow(username);
        setS({ following: r.following, requested: r.requested });
      }
      for (const key of ['stories', 'suggestions', 'feed', 'profile']) void qc.invalidateQueries({ queryKey: [key] });
      void qc.invalidateQueries({ queryKey: ['profile-posts', username] });
    } catch (x) {
      setS(prev);
      // Conta nova em revisão (risk_limited) ou demasiados «seguir» de seguida: o servidor diz porquê.
      if (x instanceof ApiError && (x.code === 'risk_limited' || x.status === 429)) Alert.alert('Agora não', x.code === 'risk_limited' ? x.message : 'Estás a seguir muita gente de seguida. Espera um bocado e tenta outra vez.');
    } finally {
      setBusy(false);
    }
  }
  const on = s.following || s.requested;
  return (
    <Pressable onPress={() => void toggle()} disabled={busy} style={[st.btn, on ? null : { backgroundColor: colors.brand }, busy && { opacity: 0.7 }, style]} accessibilityRole="button" accessibilityState={{ selected: s.following }}>
      <Text style={[st.text, !on && { color: '#fff' }]}>{s.following ? 'A seguir' : s.requested ? 'Pedido enviado' : 'Seguir'}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  // Sem `flex: 1`: dentro de uma coluna anulava a altura (ficava um botão achatado). Estica à largura do pai e tem 36 de alto.
  btn: { alignSelf: 'stretch', height: 36, minWidth: 88, borderRadius: 12, backgroundColor: colors.zinc100, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 14, fontWeight: '600', color: colors.zinc900 },
});
