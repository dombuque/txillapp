import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { KIND_LABEL, locaisApi, type Venue } from '@/lib/api.locais';
import { sized } from '@/lib/config';
import { colors } from '@/lib/theme';
import { Icon } from './Icon';
import { VerifiedBadge } from './VerifiedBadge';

/** O logótipo de um local (ou o pin, se ainda não tiver). */
export function VenueLogo({ venue, size = 48 }: { venue: Pick<Venue, 'avatarUrl' | 'name'>; size?: number }) {
  const r = Math.round(size * 0.28);
  if (venue.avatarUrl) return <Image source={{ uri: sized(venue.avatarUrl, size * 3) }} style={{ width: size, height: size, borderRadius: r, backgroundColor: colors.zinc100 }} contentFit="cover" accessibilityLabel={venue.name} />;
  return (
    <View style={{ width: size, height: size, borderRadius: r, backgroundColor: colors.zinc900, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={venue.name}>
      <Icon name="map-pin" size={Math.round(size * 0.46)} color="#fff" />
    </View>
  );
}

/** Seguir / a seguir um local (o botão muda logo; o servidor confirma). */
export function FollowVenueButton({ venue, compact = false }: { venue: Venue; compact?: boolean }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (on: boolean) => locaisApi.followVenue(venue.slug, on),
    onSuccess: (v) => {
      qc.setQueryData(['venue', venue.slug], v);
      void qc.invalidateQueries({ queryKey: ['venues'] });
      void qc.invalidateQueries({ queryKey: ['search'] });
    },
  });
  const on = m.isPending ? !venue.following : venue.following;
  return (
    <Pressable onPress={() => m.mutate(!venue.following)} disabled={m.isPending} style={[st.follow, compact && { height: 34, paddingHorizontal: 14 }, on ? st.followOn : st.followOff]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[st.followText, on && { color: colors.zinc900 }]}>{on ? 'A seguir' : 'Seguir'}</Text>
    </Pressable>
  );
}

/** Uma linha de local nas listas (pesquisa, Explorar, os meus locais): logótipo, nome, tipo e cidade, seguidores e o botão de seguir. */
export function VenueRow({ venue, onPress, right }: { venue: Venue; onPress?: () => void; right?: 'follow' | 'role' | 'none' }) {
  const router = useRouter();
  const go = onPress ?? (() => router.push({ pathname: '/v/[slug]', params: { slug: venue.slug } }));
  const sub = [KIND_LABEL[venue.kind] ?? 'Outro', venue.city, `${venue.followers} ${venue.followers === 1 ? 'seguidor' : 'seguidores'}`].filter(Boolean).join(' · ');
  return (
    <View style={st.row}>
      <Pressable onPress={go} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }} accessibilityRole="link" accessibilityLabel={venue.name}>
        <VenueLogo venue={venue} size={48} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={st.name} numberOfLines={1}>{venue.name}</Text>
            {venue.verified && <VerifiedBadge size={15} tier="verified" />}
          </View>
          <Text style={st.sub} numberOfLines={1}>{sub}</Text>
        </View>
      </Pressable>
      {right === 'follow' || right === undefined ? <FollowVenueButton venue={venue} compact /> : null}
      {right === 'role' && venue.role ? <Text style={st.role}>{venue.role === 'owner' ? 'Dono' : venue.role === 'admin' ? 'Admin' : 'Editor'}</Text> : null}
    </View>
  );
}

/** Um cartão quadrado de local, para as filas horizontais do Explorar. */
export function VenueTile({ venue }: { venue: Venue }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push({ pathname: '/v/[slug]', params: { slug: venue.slug } })} style={({ pressed }) => [st.tile, pressed && { opacity: 0.8 }]} accessibilityRole="link" accessibilityLabel={venue.name}>
      {venue.coverUrl ? <Image source={{ uri: sized(venue.coverUrl, 480) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.zinc800 }]} />}
      <View style={st.tileShade} />
      <View style={{ position: 'absolute', left: 10, top: 10 }}><VenueLogo venue={venue} size={36} /></View>
      <View style={{ position: 'absolute', left: 10, right: 10, bottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={st.tileName} numberOfLines={1}>{venue.name}</Text>
          {venue.verified && <VerifiedBadge size={14} tier="verified" />}
        </View>
        <Text style={st.tileSub} numberOfLines={1}>{KIND_LABEL[venue.kind] ?? 'Outro'}{venue.city ? ` · ${venue.city}` : ''}</Text>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  name: { flexShrink: 1, fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  sub: { fontSize: 13, color: colors.zinc500 },
  role: { fontSize: 13, fontWeight: '600', color: colors.zinc600 },
  follow: { height: 38, borderRadius: 999, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  followOn: { backgroundColor: colors.zinc100 },
  followOff: { backgroundColor: colors.brand },
  followText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  tile: { width: 150, height: 150, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.zinc800 },
  tileShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 72, backgroundColor: 'rgba(0,0,0,0.45)' },
  tileName: { flexShrink: 1, fontSize: 15, fontWeight: '800', color: '#fff' },
  tileSub: { fontSize: 12, color: 'rgba(255,255,255,0.85)' },
});
