import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { PostCard } from '@/components/PostCard';
import { VenueLogo } from '@/components/VenueCard';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { boostsApi, type SponsoredSlot } from '@/lib/api.boosts';
import { sponsoredA11y } from '@/lib/boostView';
import { sized } from '@/lib/config';
import { eventWhen } from '@/lib/nearbyView';
import { cardShadow, colors } from '@/lib/theme';

/**
 * Um destaque pago (Bombar) no feed: a publicação do local (o PostCard com a etiqueta) ou o cartão do evento.
 * A etiqueta "Bombado · Patrocinado" vê-se sempre e é a primeira coisa que o leitor de ecrã diz.
 * Os toques contam no servidor (POST /boosts/:id/tap); as impressões já contaram quando o feed o trouxe.
 */
function SponsoredCardBase({ slot, me }: { slot: SponsoredSlot; me?: string }) {
  const tap = () => void boostsApi.tap(slot.campaignId, 'feed').catch(() => undefined);
  const a11y = sponsoredA11y(slot.venue.name, slot.label);
  if (slot.post) return <PostCard post={slot.post} me={me} sponsored={{ label: slot.label, a11y, onOpen: tap }} />;
  if (slot.event) return <EventCard slot={slot} a11y={a11y} onOpen={tap} />;
  return null;
}

function EventCard({ slot, a11y, onOpen }: { slot: SponsoredSlot; a11y: string; onOpen: () => void }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const e = slot.event!;
  const open = () => { onOpen(); router.push(`/evento/${e.id}` as never); };
  const venue = () => { onOpen(); router.push({ pathname: '/v/[slug]', params: { slug: slot.venue.slug } }); };
  if (hidden) {
    return (
      <View style={[st.card, cardShadow, { paddingBottom: 16 }]}>
        <Text style={st.gone}>Ok, deixas de ver os destaques de {slot.venue.name}.</Text>
      </View>
    );
  }
  return (
    <View style={[st.card, cardShadow]}>
      <View style={st.top}>
        <View style={st.label} accessible accessibilityRole="text" accessibilityLabel={a11y}>
          <Icon name="flame" size={14} color={colors.brand} />
          <Text style={st.labelText}>{slot.label}</Text>
        </View>
        <Pressable
          onPress={() => { setHidden(true); void boostsApi.hide(slot.campaignId).catch(() => undefined); }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Não mostrar destaques de ${slot.venue.name}`}
        >
          <Icon name="x" size={18} color={colors.zinc500} />
        </Pressable>
      </View>
      <Pressable onPress={venue} style={st.venueRow} accessibilityRole="link" accessibilityLabel={`Página de ${slot.venue.name}`}>
        <VenueLogo venue={slot.venue} size={40} />
        <Text style={st.venueName} numberOfLines={1}>{slot.venue.name}</Text>
        {slot.venue.verified ? <VerifiedBadge size={15} tier="verified" /> : null}
      </Pressable>
      <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`Abrir o evento ${e.title}, ${eventWhen(e.startsAt, e.endsAt)}`} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
        {e.coverUrl ? (
          <Image source={{ uri: sized(e.coverUrl, 1080) }} style={st.cover} contentFit="cover" accessibilityIgnoresInvertColors />
        ) : (
          <View style={[st.cover, st.coverEmpty]}><Icon name="calendar" size={40} color="#fff" /></View>
        )}
        <Text style={st.title} numberOfLines={2}>{e.title}</Text>
        <Text style={st.when}>{eventWhen(e.startsAt, e.endsAt)}{e.interested ? ` · ${e.interested} com interesse` : ''}</Text>
        <View style={st.cta}><Text style={st.ctaText}>Ver o evento</Text></View>
      </Pressable>
    </View>
  );
}

export const SponsoredCard = memo(SponsoredCardBase);

const st = StyleSheet.create({
  card: { marginHorizontal: 8, marginBottom: 20, borderRadius: 26, backgroundColor: colors.white, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 18 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  label: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: colors.rose50, paddingHorizontal: 10, paddingVertical: 4 },
  labelText: { fontSize: 12, fontWeight: '800', color: colors.brand, letterSpacing: 0.2 },
  venueRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  venueName: { flexShrink: 1, fontSize: 16, fontWeight: '800', color: colors.zinc900 },
  cover: { width: '100%', aspectRatio: 16 / 9, borderRadius: 18, backgroundColor: colors.zinc100 },
  coverEmpty: { backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 12, fontSize: 18, lineHeight: 24, fontWeight: '800', color: colors.zinc900 },
  when: { marginTop: 2, fontSize: 14, color: colors.zinc600 },
  cta: { marginTop: 12, height: 44, borderRadius: 999, backgroundColor: colors.zinc900, alignItems: 'center', justifyContent: 'center' },
  ctaText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  gone: { fontSize: 14, color: colors.zinc600, textAlign: 'center' },
});
