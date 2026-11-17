import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator, PageLoader } from '@/components/PontoLoader';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconButton } from '@/components/ui/IconButton';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { Icon, type IconName } from '@/components/Icon';
import { StackPage } from '@/components/StackPage';
import { api } from '@/lib/api';
import { SITE_URL } from '@/lib/config';
import { CARD_SIZE, INVITE_PHRASES, PHRASE_STICKERS, inviteProgress, inviteShareText, nextPhrase, phraseIndexOf, pickCardItems, type CardFormat } from '@/lib/inviteCard';
import { forgetCard, renderInviteCard, saveCard, shareCard, shareOnWhatsApp, type RenderedCard } from '@/lib/inviteCardImage';
import { qrMatrix } from '@/lib/qr';
import { stickerById } from '@/lib/stickers';
import { colors } from '@/lib/theme';
import { formatVibes } from '@/lib/vibes';

/** Verde do WhatsApp, escurecido para o texto branco ter contraste suficiente (≥ 4,5:1). */
const WHATSAPP = '#128c4a';

type Action = 'wa' | 'share' | 'save';

/** Convida a tua malta: o progresso de quem entrou, o cartão do convite (feito no aparelho), o código e a ligação. */
export default function Invites() {
  const router = useRouter();
  const q = useQuery({ queryKey: ['invites'], queryFn: api.invites, staleTime: 30_000 });
  const [copied, setCopied] = useState(false);
  const [format, setFormat] = useState<CardFormat>('post');
  const [phrase, setPhrase] = useState<number | null>(null);
  const [card, setCard] = useState<RenderedCard | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [drawError, setDrawError] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [hint, setHint] = useState('');
  const cardRef = useRef<RenderedCard | null>(null);
  const d = q.data;
  const ph = phrase ?? (d ? phraseIndexOf(d.code) : 0);

  // Os itens da Geleira que vão no cartão (3–4; nunca álcool se quem convida for menor).
  const items = useMemo(() => pickCardItems(d?.card?.items, { adult: d?.card?.adult === true, max: 4 }).map((i) => i.name), [d?.card]);
  const text = d ? inviteShareText({ link: d.link, code: d.code, reward: d.rules.reward, phrase: ph }) : '';

  // Desenha o cartão no aparelho sempre que mudam o formato, a frase ou os dados.
  useEffect(() => {
    if (!d) return;
    let alive = true;
    setDrawing(true);
    setDrawError(false);
    const c = d.card;
    renderInviteCard(
      {
        format,
        code: d.code,
        displayName: c?.displayName ?? '',
        items,
        reward: d.rules.reward,
        phrase: ph,
        stickerSvg: stickerById(PHRASE_STICKERS[ph])?.svg ?? null,
        qr: qrMatrix(d.link),
        hasAvatar: !!c?.hasAvatar,
        badge: c?.verified ? (c.verifiedTier ?? 'verified') : null,
      },
      c?.hasAvatar && c.username ? `${SITE_URL}/api/v1/avatars/${encodeURIComponent(c.username)}` : null,
    )
      .then((r) => {
        if (!alive) return forgetCard(r);
        forgetCard(cardRef.current);
        cardRef.current = r;
        setCard(r);
      })
      .catch(() => {
        if (alive) setDrawError(true);
      })
      .finally(() => {
        if (alive) setDrawing(false);
      });
    return () => {
      alive = false;
    };
  }, [d, format, ph, items]);
  // Ao sair do ecrã, a imagem sai da memória (web) ou da cache (telemóvel).
  useEffect(() => () => forgetCard(cardRef.current), []);

  async function run(kind: Action) {
    if (!d || busy) return;
    setHint('');
    setBusy(kind);
    try {
      if (kind === 'save') {
        if (!card) return;
        const r = await saveCard(card);
        setHint(r === 'saved' ? (Platform.OS === 'web' ? 'Imagem pronta: guarda-a ou junta-a ao teu Status.' : 'Imagem guardada na galeria. Junta-a ao teu Status.') : 'Sem permissão para guardar na galeria.');
        return;
      }
      const r = kind === 'wa' ? await shareOnWhatsApp(card, text) : card ? await shareCard(card, text) : 'cancelled';
      if (r === 'copied') setHint('Copiei o convite: cola-o onde quiseres.');
      else if (r === 'text-only') setHint('Foi a ligação: no WhatsApp aparece o teu cartão. Para mandar a imagem, toca em «Guardar imagem».');
    } catch {
      setHint('Não deu. Tenta outra vez.');
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!d) return;
    try {
      await Clipboard.setStringAsync(d.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* sem permissão */
    }
  }

  const stat = (n: number, label: string) => (
    <View style={st.stat} accessible accessibilityLabel={`${n} ${label}`}>
      <Text style={{ fontSize: 24, fontWeight: '800', color: colors.zinc900 }}>{n}</Text>
      <Text style={{ fontSize: 13, lineHeight: 16, color: colors.zinc600, textAlign: 'center' }}>{label}</Text>
    </View>
  );
  const li = (icon: IconName, color: string, t: string) => (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <View style={{ marginTop: 2 }}><Icon name={icon} size={18} color={color} /></View>
      <Text style={{ flex: 1, fontSize: 15, lineHeight: 21, color: colors.zinc700 }}>{t}</Text>
    </View>
  );
  const action = (kind: Action, icon: IconName, label: string, a11yHint: string, look: 'whatsapp' | 'primary' | 'secondary') => {
    const off = !d || (kind !== 'wa' && !card);
    return (
      <Button
        label={label}
        icon={icon}
        kind={look === 'secondary' ? 'secondary' : 'primary'}
        onPress={() => void run(kind)}
        loading={busy === kind}
        disabled={off || (!!busy && busy !== kind)}
        accessibilityHint={a11yHint}
        style={look === 'whatsapp' ? { backgroundColor: WHATSAPP } : undefined}
      />
    );
  };
  const ratio = CARD_SIZE[format].width / CARD_SIZE[format].height;

  return (
    <StackPage
      title="Convida a tua malta"
      right={
        // Alguém mostrou o QR do perfil (ou mandou-o como imagem): lê-se daqui.
        <IconButton icon="qr-scan" iconSize={24} label="Ler um QR" onPress={() => router.push('/qr' as never)} />
      }
    >
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {q.isLoading && <PageLoader />}
        {q.isError && <ErrorState what="os convites" onRetry={() => void q.refetch()} />}
        {d && (
          <>
            {/* O progresso primeiro: quem entrou e quem já deu Txills. */}
            <Text style={st.progress} accessibilityRole="header">{inviteProgress(d.stats)}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              {stat(d.stats.invited, 'Entraram')}
              {stat(d.stats.active, 'Ficaram ativos')}
              {stat(d.stats.earned, 'Vibes ganhas')}
            </View>
            {d.stats.pending > 0 && <Text style={{ marginTop: 8, textAlign: 'center', fontSize: 13, color: colors.zinc500 }}>{d.stats.pending} em espera: o teu prémio chega {d.rules.holdDays} dias depois de a pessoa ficar ativa.</Text>}
            {d.note ? <Text style={st.note}>{d.note}</Text> : null}

            {/* O cartão do convite, feito no aparelho. */}
            <Text style={st.h2} accessibilityRole="header">O teu cartão</Text>
            <SegmentedTabs tabs={[{ value: 'post', label: 'Conversa' }, { value: 'status', label: 'Status' }]} value={format} onChange={setFormat} style={st.segment} />
            <View style={[st.preview, { aspectRatio: ratio, maxWidth: format === 'status' ? 300 : 380 }]}>
              {card && <Image source={{ uri: card.uri }} style={StyleSheet.absoluteFill} contentFit="contain" accessible accessibilityRole="image" accessibilityLabel={card.label} />}
              {drawing && !card && <ActivityIndicator color={colors.brand} />}
              {drawError && !card && <Text style={{ color: colors.zinc600, textAlign: 'center', padding: 16 }}>Não consegui desenhar o cartão. A ligação funciona na mesma.</Text>}
            </View>
            <Button label="Outra frase" icon="repeat" kind="ghost" size="md" onPress={() => setPhrase(nextPhrase(ph))} accessibilityHint={`Agora: ${INVITE_PHRASES[ph]}`} style={st.again} />
            {d.card && !d.card.geleiraPublic ? <Text style={st.small}>A tua Geleira não está à vista de todos, por isso não vai no cartão.</Text> : null}

            <View style={{ gap: 10, marginTop: 12 }}>
              {action('wa', 'messages', 'Partilhar no WhatsApp', 'Abre o WhatsApp com o convite e a ligação', 'whatsapp')}
              {action('share', 'share', 'Partilhar', 'Abre a folha de partilha com a imagem e a ligação', 'primary')}
              {action('save', 'download', 'Guardar imagem', 'Guarda o cartão na galeria, para o Status', 'secondary')}
            </View>
            {hint ? <Text style={st.hint} accessibilityLiveRegion="polite">{hint}</Text> : null}

            <LinearGradient colors={[colors.brand, '#ff8a5b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.hero}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600', opacity: 0.9 }}>O teu código</Text>
              <Text style={{ color: '#fff', fontSize: 34, fontWeight: '900', letterSpacing: 6, marginTop: 4 }} selectable>{d.code}</Text>
              <Button label={copied ? 'Copiado' : 'Copiar a ligação'} icon={copied ? 'check' : 'link'} kind="ghost" dark block onPress={() => void copy()} accessibilityLabel={copied ? 'Ligação copiada' : 'Copiar a ligação'} style={st.copy} />
            </LinearGradient>

            <Text style={st.h2} accessibilityRole="header">Como funciona</Text>
            <View style={{ gap: 8 }}>
              {li('check-circle', colors.green600, 'A pessoa entra pela tua ligação ou com o teu código. Ficas logo a saber que ela entrou.')}
              {li('check-circle', colors.green600, `Ela ganha ${formatVibes(d.rules.reward)} quando a conta ficar ativa: confirma o email, publica algo ou segue 3 pessoas, e volta ao Txillapp noutro dia.`)}
              {li('check-circle', colors.green600, `Tu ganhas ${formatVibes(d.rules.reward)} quando ela continuar por cá mais ${d.rules.holdDays} dias.`)}
              {li('info', colors.zinc500, `Até ${d.rules.perDay} convites premiados por dia e ${d.rules.maxPaid} no total. Depois disso o convite continua a funcionar, mas sem vibes.`)}
              {li('info', colors.zinc500, 'Contas repetidas (no mesmo aparelho ou com o mesmo email), contas automáticas, emails temporários e registos em massa não contam. As vibes são pontos da app.')}
              {li('info', colors.zinc500, 'O cartão é feito no teu aparelho. Leva o teu nome, a tua foto e, se a tua Geleira estiver à vista de todos, alguns itens dela.')}
            </View>
          </>
        )}
      </ScrollView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  progress: { fontSize: 20, lineHeight: 26, fontWeight: '800', color: colors.zinc900, textAlign: 'center', marginTop: 4 },
  h2: { marginTop: 28, marginBottom: 10, fontSize: 18, fontWeight: '800', color: colors.zinc900 },
  hero: { marginTop: 24, borderRadius: 26, paddingHorizontal: 20, paddingVertical: 20, alignItems: 'center', boxShadow: '0 6px 18px rgba(214,51,79,0.35)' },
  copy: { marginTop: 12, backgroundColor: 'rgba(255,255,255,0.2)' },
  segment: { alignSelf: 'center', width: 280, maxWidth: '100%', marginBottom: 12 },
  preview: { width: '100%', alignSelf: 'center', borderRadius: 20, overflow: 'hidden', backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  again: { alignSelf: 'center', marginTop: 6 },
  small: { textAlign: 'center', fontSize: 13, color: colors.zinc500, marginTop: 2 },
  hint: { marginTop: 10, textAlign: 'center', fontSize: 14, lineHeight: 20, color: colors.zinc700 },
  stat: { flex: 1, borderRadius: 16, backgroundColor: colors.zinc50, borderWidth: 1, borderColor: colors.zinc100, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center' },
  note: { marginTop: 16, borderRadius: 16, backgroundColor: '#fffbeb', paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: '#78350f' },
});
