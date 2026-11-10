import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { GroupCover } from '@/components/groups/GroupParts';
import { countdown, dateRange, groupKindOf, kindInfo, type GroupKind, type TxillGroupSummary } from '@/lib/api.groups';
import { sized } from '@/lib/config';
import { accessOf, type GroupAccess } from '@/lib/groupAccess';
import { colors } from '@/lib/theme';
import { timeAgo } from '@/lib/time';

/** O que o cartão precisa (tudo simples, para a lista e para o laboratório visual). */
export interface GroupCardProps {
  name: string;
  kind?: GroupKind | null;
  /** Capa (foto larga). Sem capa, a faixa leva as cores e o ícone do tipo. */
  coverUrl?: string | null;
  /** Foto de perfil (redonda). Sem ela, o ícone do tipo. */
  avatarUrl?: string | null;
  members: number;
  plan?: { destination?: string | null; startsOn?: string | null; endsOn?: string | null; going?: number } | null;
  /** 'private' não mostra selo; 'map' = privado visível no mapa; 'public' = público. */
  access?: GroupAccess;
  /** A última mensagem já escrita como na lista ("Jefferson: Na boa?"). */
  lastMessage: string;
  /** ISO da última mensagem. */
  at: string;
  unread: number;
  /** Só para administradores: pedidos para entrar por responder. */
  requests?: number;
  onPress: () => void;
  onPressIn?: () => void;
}

/** As cores da faixa quando o grupo não tem capa (nunca um vazio cinzento). */
const KIND_COLORS: Record<GroupKind, [string, string]> = {
  viagem: ['#0e7490', '#2dd4bf'],
  festa: [colors.brand, '#ff9a5b'],
  fim_de_semana: ['#d97706', '#fcd34d'],
  outro: ['#be185d', '#fb7185'],
};

const BAND = 54;
const RING = 60;

/** "Daqui a 18 dias" → "Faltam 18 dias"; os outros ("Amanhã", "É hoje", "A decorrer") ficam como estão. */
function soon(start?: string | null, end?: string | null): string | null {
  const c = countdown(start, end);
  if (!c || c === 'Já passou') return null;
  return c.replace(/^Daqui a (\d+) dias$/, 'Faltam $1 dias');
}

/** A linha de contexto: "Viagem · Tofo · 28 dez – 2 jan · 6 vão" ou, sem plano, "Viagem · 8 pessoas". */
function contextOf(p: GroupCardProps): string {
  const parts: string[] = [kindInfo(p.kind).label];
  const plan = p.plan;
  const passed = !!plan?.startsOn && countdown(plan.startsOn, plan.endsOn) === 'Já passou';
  if (plan?.destination) parts.push(plan.destination);
  const dates = !passed ? dateRange(plan?.startsOn, plan?.endsOn) : null;
  if (dates) parts.push(dates.replace(' · ', ' – '));
  if (plan?.going) parts.push(`${plan.going} ${plan.going === 1 ? 'vai' : 'vão'}`);
  if (parts.length === 1) parts.push(`${p.members} ${p.members === 1 ? 'pessoa' : 'pessoas'}`);
  return parts.join(' · ');
}

/** Dados do cartão a partir do resumo que vem de /chat/groups. */
export function groupCardData(g: TxillGroupSummary): Omit<GroupCardProps, 'lastMessage' | 'onPress' | 'onPressIn'> {
  return {
    name: g.name,
    kind: groupKindOf(g) ?? null,
    coverUrl: g.coverUrl ?? null,
    avatarUrl: g.avatarUrl ?? null,
    members: g.members,
    plan: g.plan ? { destination: g.plan.destination, startsOn: g.plan.startsOn, endsOn: g.plan.endsOn, going: g.plan.going } : null,
    access: accessOf(g),
    at: g.lastMessage.at,
    unread: g.unread,
    requests: g.pendingRequests ?? 0,
  };
}

/**
 * Um TxillGroup na lista de Mensagens: um cartão com a capa numa faixa por cima, a foto de perfil a meio caminho
 * entre a faixa e o corpo, o nome, o contexto do Plano e a última mensagem (com hora e não lidas, como nas conversas).
 */
export function GroupCard(p: GroupCardProps) {
  const kind = kindInfo(p.kind);
  const cover = sized(p.coverUrl, 800);
  const when = p.plan ? soon(p.plan.startsOn, p.plan.endsOn) : null;
  const context = contextOf(p);
  const time = timeAgo(p.at).replace('Há ', '');
  const unread = p.unread > 0;
  const requests = p.requests ?? 0;
  const seal = p.access === 'public' ? { icon: 'globe' as const, text: 'Público' } : p.access === 'map' ? { icon: 'map-pin' as const, text: 'No mapa' } : null;

  const label = [
    `${p.name}, TxillGroup${p.kind ? ` de ${kind.label.toLowerCase()}` : ''}`,
    seal ? (p.access === 'public' ? 'público' : 'visível no mapa') : null,
    context.split(' · ').slice(1).join(', '),
    when,
    `Última mensagem: ${p.lastMessage}, ${timeAgo(p.at).toLowerCase()}`,
    unread ? `${p.unread} por ler` : null,
    requests ? `${requests} ${requests === 1 ? 'pedido' : 'pedidos'} para entrar` : null,
  ].filter(Boolean).join('. ');

  return (
    <View style={s.wrap}>
      <Pressable
        onPressIn={p.onPressIn}
        onPress={p.onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [s.card, pressed && s.pressed]}
      >
        <View style={s.clip}>
          {/* A faixa: a capa (ou as cores do tipo), um véu escuro em cima para os selos e o regresso a branco em baixo. */}
          <View style={s.band}>
            {cover ? (
              <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
            ) : (
              <LinearGradient colors={p.kind ? KIND_COLORS[p.kind] : KIND_COLORS.festa} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill}>
                <View style={s.deco}><Icon name={kind.icon} size={70} strokeWidth={1.5} color="rgba(255,255,255,0.28)" /></View>
                <View style={s.deco2}><Icon name={kind.icon} size={30} strokeWidth={1.6} color="rgba(255,255,255,0.22)" /></View>
              </LinearGradient>
            )}
            <LinearGradient colors={['rgba(0,0,0,0.34)', 'rgba(0,0,0,0)']} locations={[0, 0.75]} style={[StyleSheet.absoluteFill, s.none]} />
            <View style={[s.badges, s.none]}>
              {seal ? (
                <View style={s.seal}>
                  <Icon name={seal.icon} size={11} strokeWidth={2} color="#fff" />
                  <Text style={s.sealText}>{seal.text}</Text>
                </View>
              ) : null}
              <View style={{ flex: 1 }} />
              {when ? (
                <View style={s.soon}>
                  <Icon name="calendar" size={11} strokeWidth={2} color={colors.brand} />
                  <Text style={s.soonText} numberOfLines={1}>{when}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={s.body}>
            <View style={s.line}>
              <Text style={[s.name, unread && { fontWeight: '800' }]} numberOfLines={1}>{p.name}</Text>
              {requests ? (
                <View style={s.reqs}>
                  <Icon name="user-plus" size={11} color={colors.zinc700} />
                  <Text style={s.reqsText}>{requests}</Text>
                </View>
              ) : null}
              <View style={{ flex: 1 }} />
              <Text style={[s.time, unread && { color: colors.brand, fontWeight: '700' }]}>{time}</Text>
            </View>
            <View style={s.line}>
              <Icon name={kind.icon} size={13} strokeWidth={2} color={colors.brand} />
              <Text style={s.context} numberOfLines={1}>{context}</Text>
            </View>
            <View style={s.line}>
              <Text style={[s.msg, unread && { color: colors.zinc900, fontWeight: '600' }]} numberOfLines={1}>{p.lastMessage}</Text>
              {unread ? (
                <View style={s.count}><Text style={s.countText}>{p.unread > 99 ? '99+' : p.unread}</Text></View>
              ) : null}
            </View>
          </View>
        </View>

        {/* A foto de perfil, entre a faixa e o corpo; com o anel da marca quando há mensagens por ler. */}
        <View style={[s.avatarAt, s.none]}>
          {unread ? (
            <LinearGradient colors={[colors.brand, '#ff9a5b']} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={s.ring}>
              <View style={s.ringIn}><GroupCover url={p.avatarUrl} kind={p.kind} size={50} radius={25} /></View>
            </LinearGradient>
          ) : (
            <View style={[s.ring, { backgroundColor: colors.white }]}>
              <GroupCover url={p.avatarUrl} kind={p.kind} size={54} radius={27} />
            </View>
          )}
        </View>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  // Margem por dentro do SwipeRow (que corta o que sai): a sombra cabe e o cartão alinha com as fotos das conversas.
  none: { pointerEvents: 'none' },
  wrap: { paddingHorizontal: 4, paddingTop: 6, paddingBottom: 8 },
  card: { borderRadius: 20, backgroundColor: colors.white, boxShadow: '0 1px 2px rgba(0,0,0,0.06), 0 3px 10px rgba(0,0,0,0.08)' } as object,
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  clip: { borderRadius: 20, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.06)' },
  band: { height: BAND, backgroundColor: colors.rose50 },
  deco: { position: 'absolute', right: 96, top: -6, transform: [{ rotate: '-12deg' }] },
  deco2: { position: 'absolute', right: 52, bottom: 4, transform: [{ rotate: '10deg' }] },
  badges: { position: 'absolute', left: 82, right: 10, top: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  seal: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 22, paddingHorizontal: 8, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.38)' },
  sealText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  soon: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 22, paddingHorizontal: 8, borderRadius: 11, backgroundColor: colors.white, flexShrink: 1 },
  soonText: { fontSize: 11, fontWeight: '800', color: colors.brand, flexShrink: 1 },
  body: { paddingLeft: 82, paddingRight: 12, paddingTop: 7, paddingBottom: 11, gap: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 20 },
  name: { fontSize: 16, lineHeight: 21, fontWeight: '700', color: colors.zinc900, flexShrink: 1 },
  time: { fontSize: 12, color: colors.zinc500 },
  context: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.zinc600 },
  msg: { flex: 1, fontSize: 14, color: colors.zinc500 },
  count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  reqs: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 7, paddingVertical: 2, flexShrink: 0 },
  reqsText: { fontSize: 11, fontWeight: '800', color: colors.zinc700 },
  avatarAt: { position: 'absolute', left: 12, top: BAND - RING / 2 },
  ring: { width: RING, height: RING, borderRadius: RING / 2, alignItems: 'center', justifyContent: 'center' },
  ringIn: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
});
