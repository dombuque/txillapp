import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Post } from '@/lib/api';
import type { Mixar, MixarChallenge } from '@/lib/api.mixar';
import { abs, sized } from '@/lib/config';
import { CHALLENGE_GAP, canPick, challengeCols, challengeQuestion, challengeTile, challengeView, daysLabel, endOfDay, matchLine, matchPercent, optionBadge, timesLabel } from '@/lib/mixar';
import { countOf, groupChallengeLine, pickedLabel } from '@/lib/mixarGrupo';
import { colors } from '@/lib/theme';
import { Avatar } from '../Avatar';
import { Icon } from '../Icon';
import { InlineBadge, NameWithBadge } from '../NameWithBadge';
import type { Badged } from '@/lib/api';
import { ActivityIndicator } from '../PontoLoader';
import { Sheet } from '../Sheet';
import { GroupAvatars, MIXAR_GRADIENT, PairAvatars, TopicChips } from './MixarBits';
import { t } from '@/lib/i18n';

const isWeb = Platform.OS === 'web';
/** Uma pessoa do Mixar (o nome curto); no Mixar a dois traz o selo de verificado. */
type Who = { name: string; username?: string } & Badged;
const snap = isWeb ? ({ scrollSnapAlign: 'start', scrollSnapStop: 'always' } as object) : null;

/* ---------- Descoberta de interesses ---------- */

/** Ao tocar no cabeçalho: o match, o que têm em comum, o que é só meu e só do outro, a série e os «match» do desafio. */
export function DiscoverySheet({ mixar, me, them, onClose, onLeave, onTopics, onPrivate }: { mixar: Mixar; me: Who; them: Who; onClose: () => void; onLeave?: () => void; onTopics?: () => void; onPrivate?: () => void }) {
  const p = matchPercent(mixar.match);
  return (
    <Sheet title={t('Descoberta de interesses')} onClose={onClose}>
      <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 12 }}>
        <View style={{ alignItems: 'center', marginBottom: 18 }}>
          {mixar.group ? <GroupAvatars people={mixar.group.people} size={52} max={5} /> : <PairAvatars me={me} them={them} size={56} />}
          {mixar.group ? <Text style={[ds.name, { textAlign: 'center' }]} numberOfLines={2}>{mixar.group.groupName}</Text> : <NameWithBadge name={mixar.name} who={mixar.partner} style={ds.name} center numberOfLines={2} />}
          {mixar.group ? <GroupPeople people={mixar.group.people} /> : null}
          <View style={ds.meter} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: p }} accessibilityLabel={t('{p}% de match', { p })}>
            <LinearGradient colors={MIXAR_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[ds.meterFill, { width: `${Math.max(4, p)}%` }]} />
          </View>
          <Text style={ds.match}><Text style={{ color: colors.brand }}>{p}%</Text> {t('de match · {matchLine}', { matchLine: matchLine(p) })}</Text>
        </View>

        <Section title={mixar.group ? t('Do gosto de todos') : t('Em comum')} empty={t('Ainda a descobrir: reajam e vejam juntos para o Mixar aprender.')}>
          {mixar.common.length ? <TopicChips topics={mixar.common} accent /> : null}
        </Section>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Section title={t('Só teu')} empty={t('Nada só teu, por agora.')}>{mixar.onlyMe.length ? <TopicChips topics={mixar.onlyMe} /> : null}</Section>
          </View>
          {mixar.group ? null : (
            <View style={{ flex: 1, minWidth: 0 }}>
              <Section title={t('Só de {name}', { name: them.name })} empty={t('Nada só dele ou dela, por agora.')}>{mixar.onlyThem.length ? <TopicChips topics={mixar.onlyThem} /> : null}</Section>
            </View>
          )}
        </View>

        <View style={ds.stats}>
          <Stat icon="flame" value={daysLabel(mixar.streak)} label={t('Série no Mixa Challenge')} />
          <Stat icon="party" value={timesLabel(mixar.matches)} label={mixar.group ? t('Escolheram todos o mesmo') : t('Escolheram o mesmo')} />
        </View>
        {/* Controlo (0172): afinar os temas deste Mixar e os temas privados (components/mixar/MixarControloSheets). */}
        {onTopics || onPrivate ? <ControlLinks onTopics={onTopics} onPrivate={onPrivate} /> : null}
        {onLeave ? (
          <Pressable onPress={onLeave} style={({ pressed }) => [ds.leave, pressed && { opacity: 0.6 }]} accessibilityRole="button">
            <Icon name="logout" size={16} color={colors.danger} />
            <Text style={ds.leaveText}>{mixar.group ? t('Sair do Mixar do grupo') : t('Sair do Mixar')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

/** No grupo: quem está no Mixar, com o selo de verificado. */
function GroupPeople({ people }: { people: NonNullable<Mixar['group']>['people'] }) {
  return (
    <View style={{ marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, maxWidth: 320 }} accessibilityLabel={t('Quem está no Mixar do grupo')}>
      {people.map((p) => (
        <View key={p.username} style={ds.person}>
          <NameWithBadge name={p.displayName} who={p} style={ds.personText} gap={3} />
        </View>
      ))}
    </View>
  );
}

function ControlLinks({ onTopics, onPrivate }: { onTopics?: () => void; onPrivate?: () => void }) {
  return (
    <View style={{ marginTop: 16, gap: 8 }}>
      {onTopics ? (
        <Pressable onPress={onTopics} style={({ pressed }) => [ds.link, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <Icon name="sliders" size={18} color={colors.zinc800} />
          <Text style={ds.linkText}>{t('Afinar os temas do Mixar')}</Text>
          <Icon name="chevron-right" size={16} color={colors.zinc400} />
        </Pressable>
      ) : null}
      {onPrivate ? (
        <Pressable onPress={onPrivate} style={({ pressed }) => [ds.link, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <Icon name="lock" size={18} color={colors.zinc800} />
          <Text style={ds.linkText}>{t('Temas privados')}</Text>
          <Icon name="chevron-right" size={16} color={colors.zinc400} />
        </Pressable>
      ) : null}
    </View>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={ds.section} accessibilityRole="header">{title}</Text>
      {children ?? <Text style={ds.empty}>{empty}</Text>}
    </View>
  );
}

function Stat({ icon, value, label }: { icon: 'flame' | 'party'; value: string; label: string }) {
  return (
    <View style={ds.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <Icon name={icon} size={22} color={colors.brand} />
      <Text style={ds.statValue}>{value}</Text>
      <Text style={ds.statLabel}>{label}</Text>
    </View>
  );
}

const ds = StyleSheet.create({
  name: { marginTop: 10, fontSize: 20, fontWeight: '800', color: colors.zinc900 },
  meter: { marginTop: 12, width: 220, height: 8, borderRadius: 4, backgroundColor: colors.zinc100, overflow: 'hidden' },
  meterFill: { height: 8, borderRadius: 4 },
  match: { marginTop: 8, fontSize: 14, fontWeight: '600', color: colors.zinc600, textAlign: 'center' },
  section: { marginBottom: 8, fontSize: 12, fontWeight: '800', letterSpacing: 1, color: colors.zinc500, textTransform: 'uppercase' },
  empty: { fontSize: 14, color: colors.zinc500 },
  stats: { flexDirection: 'row', gap: 12, marginTop: 4 },
  stat: { flex: 1, borderRadius: 16, backgroundColor: colors.rose50, padding: 12, gap: 2 },
  statValue: { marginTop: 4, fontSize: 18, fontWeight: '800', color: colors.zinc900 },
  statLabel: { fontSize: 13, color: colors.zinc600 },
  link: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, backgroundColor: colors.zinc100, paddingHorizontal: 14 },
  linkText: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.zinc900 },
  leave: { marginTop: 18, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  leaveText: { fontSize: 15, fontWeight: '700', color: colors.danger },
  person: { borderRadius: 999, backgroundColor: colors.zinc100, paddingHorizontal: 10, paddingVertical: 4 },
  personText: { fontSize: 13, fontWeight: '700', color: colors.zinc800 },
});

/* ---------- Mixa Challenge ---------- */

const thumbOf = (p: Post) => {
  const m = p.media[0];
  return sized(m?.kind === 'video' ? m.posterUrl ?? null : m?.url ?? null, 360) ?? abs(m?.posterUrl ?? m?.url);
};

/**
 * O Mixa Challenge, como primeira página do dia: a pergunta e 3–4 miniaturas. Escolho uma (tocar marca, «Escolher esta»
 * confirma; não se muda); fico «à espera de Ana» até ela escolher; depois o resultado (match, com a festa, ou «Ana escolheu esta»).
 */
export function ChallengePage({ c, height, me, them, busy, onPick, onOpen, topInset }: {
  c: MixarChallenge;
  height: number;
  me: Who;
  them: Who;
  busy: boolean;
  onPick: (postId: string) => void;
  /** Depois de escolher: tocar numa miniatura abre a publicação. */
  onOpen: (p: Post) => void;
  topInset: number;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  // Mixar de grupo (0173): cada um escolhe; no fim, quantos escolheram cada opção (sem dizer quem).
  const grp = c.group ?? null;
  const v = grp ? { ...groupChallengeLine({ ...c, group: grp }), match: grp.counts ? !!c.match : null } : challengeView(c, them.name);
  const picking = canPick(c);
  const cols = challengeCols(c.options.length);
  // A grelha mede-se (onLayout) e as miniaturas levam largura e altura em px (lib/mixar: challengeTile).
  const [gridW, setGridW] = useState(0);
  const tile = challengeTile(gridW, cols);
  return (
    <View style={[{ height, width: '100%', overflow: 'hidden' }, snap]}>
      <LinearGradient colors={['#2a0b12', '#4a1020', '#120608']} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={StyleSheet.absoluteFill} />
      <ScrollView contentContainerStyle={[cs.wrap, { paddingTop: topInset + 12, minHeight: height }]} showsVerticalScrollIndicator={false}>
        <View style={cs.kickerRow}>
          <Icon name="sparkles" size={16} color="#ffb4a2" strokeWidth={2.2} />
          <Text style={cs.kicker}>{t('MIXA CHALLENGE')}</Text>
        </View>
        <Text style={cs.question} accessibilityRole="header">{challengeQuestion(c)}</Text>
        <Text style={[cs.line, v.phase === 'result' && v.match && { color: '#fde68a', fontWeight: '800' }]} accessibilityLiveRegion="polite">{v.line}</Text>

        <View style={[cs.grid, { maxWidth: cols === 3 ? 420 : 360 }]} onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width); setGridW((o) => (o === w ? o : w)); }}>
          {tile && c.options.map((p) => {
            const badge = grp ? (c.myPick === p.id ? 'mine' : null) : optionBadge(c, p.id);
            const n = grp ? countOf(c, p.id) : null;
            const sel = picking && chosen === p.id;
            const lost = v.phase === 'result' && (grp ? !n : !badge);
            return (
              <Pressable
                key={p.id}
                onPress={() => (picking ? setChosen(p.id) : onOpen(p))}
                disabled={busy}
                style={({ pressed }) => [cs.opt, { width: tile.width, height: tile.height }, (sel || badge === 'mine' || badge === 'both') && cs.optMine, badge === 'theirs' && cs.optTheirs, lost && { opacity: 0.45 }, pressed && { transform: [{ scale: 0.97 }] }]}
                accessibilityRole={picking ? 'radio' : 'button'}
                accessibilityState={picking ? { selected: sel } : undefined}
                accessibilityLabel={`${p.author.displayName}${p.body ? `: ${p.body.slice(0, 60)}` : ''}${badge === 'both' ? t('. Os dois escolheram esta') : badge === 'mine' ? t('. A tua escolha') : badge === 'theirs' ? t('. {name} escolheu esta', { name: them.name }) : ''}${n != null ? `. ${pickedLabel(n)}` : ''}`}
              >
                {thumbOf(p) ? <Image source={{ uri: thumbOf(p) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: '#333' }]} />}
                {p.media[0]?.kind === 'video' ? <View style={cs.play}><Icon name="play" size={14} color="#fff" solid /></View> : null}
                {badge ? (
                  <View style={cs.badges}>
                    {badge !== 'theirs' ? <View style={cs.face}><Avatar name={me.name} username={me.username} size={22} /></View> : null}
                    {badge !== 'mine' ? <View style={[cs.face, badge === 'both' && { marginLeft: -8 }]}><Avatar name={them.name} username={them.username} size={22} /></View> : null}
                  </View>
                ) : null}
                {badge === 'both' ? <View style={cs.party}><Icon name="party" size={18} color={colors.brand} /></View> : null}
                {n != null ? <View style={cs.count}><Text style={cs.countText}>{pickedLabel(n)}</Text></View> : null}
                {sel ? <View style={cs.tick}><Icon name="check" size={16} color="#fff" strokeWidth={3} /></View> : null}
              </Pressable>
            );
          })}
        </View>

        {picking ? (
          <Pressable onPress={() => chosen && onPick(chosen)} disabled={!chosen || busy} style={({ pressed }) => [cs.cta, (!chosen || busy) && { opacity: 0.45 }, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button" accessibilityState={{ disabled: !chosen || busy }}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={cs.ctaText}>{chosen ? t('Escolher esta') : t('Toca numa para escolher')}</Text>}
          </Pressable>
        ) : v.phase === 'waiting' ? (
          <View style={cs.wait}><ActivityIndicator color="#fff" /><Text style={cs.waitText}>{grp ? t('Avisamos quando todos escolherem.') : <>{t('Avisamos quando {name}', { name: them.name })}<InlineBadge who={them} fontSize={14} /> {t('escolher.')}</>}</Text></View>
        ) : null}

        <View style={cs.more}>
          <Icon name="arrow-up" size={16} color="rgba(255,255,255,0.7)" />
          <Text style={cs.moreText}>{t('Desliza para a seleção de hoje')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const cs = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingBottom: 32 },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 56 },
  kicker: { fontSize: 13, fontWeight: '900', letterSpacing: 2, color: '#ffb4a2' },
  question: { marginTop: 10, fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#fff', textAlign: 'center' },
  line: { marginTop: 8, fontSize: 15, lineHeight: 20, color: 'rgba(255,255,255,0.8)', textAlign: 'center', maxWidth: 320 },
  grid: { marginTop: 22, width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: CHALLENGE_GAP },
  opt: { borderRadius: 16, overflow: 'hidden', borderWidth: 3, borderColor: 'transparent', backgroundColor: '#222' },
  optMine: { borderColor: colors.brand },
  optTheirs: { borderColor: '#fbbf24' },
  play: { position: 'absolute', left: 6, top: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  badges: { position: 'absolute', right: 6, bottom: 6, flexDirection: 'row' },
  face: { borderRadius: 13, borderWidth: 2, borderColor: '#fff' },
  party: { position: 'absolute', left: 6, bottom: 6, width: 30, height: 30, borderRadius: 15, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  count: { position: 'absolute', left: 6, bottom: 6, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.72)', paddingHorizontal: 8, paddingVertical: 3 },
  countText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  tick: { position: 'absolute', right: 6, top: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  cta: { marginTop: 22, minHeight: 48, minWidth: 220, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  wait: { marginTop: 22, flexDirection: 'row', alignItems: 'center', gap: 10 },
  waitText: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600' },
  more: { marginTop: 28, flexDirection: 'row', alignItems: 'center', gap: 6 },
  moreText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' },
});

/* ---------- Fim da seleção do dia ---------- */

/** «Volta amanhã para mais» e a hora da próxima atualização (05:00). `empty`: ainda não houve nada hoje. */
export function EndPage({ height, me, them, empty, onDiscover, onBack, children }: { height: number; me: Who; them: Who; empty: boolean; onDiscover: () => void; onBack: () => void; /** Por baixo da hora (o «Mais 5», MixarSocial). */ children?: React.ReactNode }) {
  const e = endOfDay();
  return (
    <View style={[{ height, width: '100%', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, backgroundColor: '#0b0b0c' }, snap]}>
      <LinearGradient colors={['rgba(214,51,79,0.28)', 'rgba(0,0,0,0)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.7 }} style={StyleSheet.absoluteFill} />
      <PairAvatars me={me} them={them} size={64} ring="#0b0b0c" />
      <Text style={es.title}>{empty ? t('A seleção de hoje ainda vem a caminho') : e.title}</Text>
      <Text style={es.line}>{empty ? t('Reajam, vejam até ao fim e mandem uns aos outros: o Mixar aprende com os dois.') : e.line}</Text>
      <View style={es.clock}><Icon name="clock" size={16} color="#fff" /><Text style={es.clockText}>{t('Nova seleção às 05:00')}</Text></View>
      {children}
      <Pressable onPress={onDiscover} style={({ pressed }) => [es.btn, pressed && { transform: [{ scale: 0.97 }] }]} accessibilityRole="button">
        <Icon name="sparkles" size={18} color="#fff" />
        <Text style={es.btnText}>{t('O que temos em comum')}</Text>
      </Pressable>
      <Pressable onPress={onBack} style={({ pressed }) => [es.link, pressed && { opacity: 0.6 }]} accessibilityRole="button">
        <Text style={es.linkText}>{t('Voltar às mensagens')}</Text>
      </Pressable>
    </View>
  );
}

const es = StyleSheet.create({
  title: { marginTop: 20, fontSize: 26, lineHeight: 32, fontWeight: '900', color: '#fff', textAlign: 'center' },
  line: { marginTop: 8, fontSize: 15, lineHeight: 21, color: 'rgba(255,255,255,0.78)', textAlign: 'center', maxWidth: 320 },
  clock: { marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 14, paddingVertical: 7 },
  clockText: { color: '#fff', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  btn: { marginTop: 28, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 24 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  link: { marginTop: 10, minHeight: 44, justifyContent: 'center' },
  linkText: { color: 'rgba(255,255,255,0.75)', fontSize: 15, fontWeight: '600' },
});
