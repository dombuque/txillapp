import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { api, type FollowState } from '@/lib/api';
import { colors } from '@/lib/theme';

/** Seguir / A seguir / Pedido enviado (perfis privados). Responde já e volta atrás se falhar. */
export function FollowButton({ username, following, requested, isPrivate }: { username: string; following: boolean; requested: boolean; isPrivate: boolean }) {
  const qc = useQueryClient();
  const [s, setS] = useState({ following, requested });
  const [busy, setBusy] = useState(false);
  async function toggle() {
    if (busy) return;
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
    } catch {
      setS(prev);
    } finally {
      setBusy(false);
    }
  }
  const on = s.following || s.requested;
  return (
    <Pressable onPress={() => void toggle()} disabled={busy} style={[st.btn, { flex: 1 }, on ? null : { backgroundColor: colors.brand }, busy && { opacity: 0.7 }]} accessibilityRole="button" accessibilityState={{ selected: s.following }}>
      <Text style={[st.text, !on && { color: '#fff' }]}>{s.following ? 'A seguir' : s.requested ? 'Pedido enviado' : 'Seguir'}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  btn: { height: 36, borderRadius: 12, backgroundColor: colors.zinc100, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 14, fontWeight: '600', color: colors.zinc900 },
});
