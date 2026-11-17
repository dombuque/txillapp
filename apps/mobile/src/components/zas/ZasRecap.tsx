import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Alert, PixelRatio, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { NameWithBadge } from '@/components/NameWithBadge';
import { ActivityIndicator } from '@/components/PontoLoader';
import { Sheet } from '@/components/Sheet';
import { CloseFriendsSheet } from '@/components/StoryParts';
import { ApiError, api } from '@/lib/api';
import { instantsApi, type RecapAudience, type ZasRecap } from '@/lib/api.geleira';
import { useAuth } from '@/lib/auth';
import { confirm } from '@/lib/confirm';
import { abs } from '@/lib/config';
import { finePointer } from '@/lib/desktopKeys';
import { colors } from '@/lib/theme';
import { zasPhotoUrl } from './zasDeck';
import { saveRecap, shareRecap } from './zasImage';
import { audienceLabel, publishErrorText, recapCardSize, recapLine, recapPrivacyLine, recapTitle } from './zasRecapLogic';

/** A chave da cache de um resumo (`latest` = o mais recente, sem id). */
export const recapKey = (id?: string) => ['zas-recap', id ?? 'latest'] as const;
const is404 = (e: unknown) => e instanceof ApiError && e.status === 404;

/**
 * O resumo semanal dos Zás (como o «Recap» dos Instants): o ecrã escuro do Zás, com a luz coral em baixo, a marca do Zás,
 * «Resumo dos Zás · 8 a 15 nov», a imagem 9:16 desenhada no servidor num cartão arredondado que cabe no ecrã, «Só tu vês
 * isto até o partilhares» e as ações: «Partilhar nos mimos» (Amigos ou Amigos próximos), «Guardar» e «Partilhar» (fora da
 * app). No computador (área larga) a imagem fica à esquerda e as ações ao lado.
 * `id`: o resumo a abrir (sem id: o mais recente). `initial`: o que já se tem (o cartão de «Os meus Zás»), para abrir já.
 * Abre como rota (/zas-resumo, do push e das notificações) e num Modal por cima de «Os meus Zás».
 */
export function ZasRecapView({ id, initial, onClose }: { id?: string; initial?: ZasRecap; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const q = useQuery({
    queryKey: recapKey(id ?? initial?.id),
    queryFn: async () => ((id ?? initial?.id) ? instantsApi.recap((id ?? initial?.id)!) : ((await instantsApi.recaps())[0] ?? null)),
    initialData: initial,
    retry: (n, e) => !is404(e) && n < 2,
  });
  const r = q.data ?? null;
  const gone = (q.isError && is404(q.error)) || (q.isSuccess && !r);

  const [area, setArea] = useState({ w: 0, h: 0 });
  const onArea = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (Math.abs(w - area.w) > 0.5 || Math.abs(h - area.h) > 0.5) setArea({ w, h });
  };
  const [sheet, setSheet] = useState(false);
  const [audience, setAudience] = useState<RecapAudience>('all');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [setupClose, setSetupClose] = useState(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(noteTimer.current), []);
  const flash = (t: string, ms = 2200) => {
    setNote(t);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(''), ms);
  };
  const friends = useQuery({ queryKey: ['close-friends'], queryFn: api.closeFriends, enabled: sheet });

  const put = (next: ZasRecap) => {
    qc.setQueryData(recapKey(next.id), next);
    if (!id && !initial) qc.setQueryData(recapKey(), next);
    qc.setQueryData<ZasRecap[]>(['zas-recaps'], (l) => (l ? l.map((x) => (x.id === next.id ? next : x)) : l));
  };

  async function publish() {
    if (!r || busy) return;
    setBusy(true);
    setErr('');
    try {
      const res = await instantsApi.publishRecap(r.id, audience);
      put(res.recap ?? { ...r, published: { storyId: res.storyId, audience, at: new Date().toISOString() } });
      setSheet(false);
      flash('Está nos teus mimos');
      void qc.invalidateQueries({ queryKey: ['stories'] });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : undefined;
      setErr(publishErrorText(status, (e as Error).message));
      if (status === 409 || status === 404) void q.refetch();
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!r) return;
    if (!(await confirm({ title: 'Descartar o resumo?', message: 'Apaga-se já e deixas de o poder partilhar. Os teus Zás continuam.', confirm: 'Descartar', danger: true }))) return;
    instantsApi.removeRecap(r.id).then(() => {
      qc.setQueryData<ZasRecap[]>(['zas-recaps'], (l) => (l ? l.filter((x) => x.id !== r.id) : l));
      void qc.invalidateQueries({ queryKey: ['zas-recaps'] });
      qc.removeQueries({ queryKey: ['zas-recap'] });
      onClose();
    }).catch((e) => setErr((e as Error).message || 'Não consegui descartar o resumo.'));
  }

  // A área à volta: a partir de 820 px de largura, a imagem à esquerda e as ações ao lado.
  const wide = area.w >= 820;
  const side = wide ? Math.min(380, area.w - 32 - 300) : 0;
  const card = wide
    ? recapCardSize(area.w - side - 48 - 64, Math.min(area.h - 48, 860))
    : recapCardSize(Math.min(area.w - 40, 460), area.h - 24);
  const photo = r ? zasPhotoUrl(abs(r.url) ?? r.url, Math.min(1080, Math.ceil((card.w * PixelRatio.get()) / 180) * 180)) : '';
  const published = !!r?.published;

  const isWeb = Platform.OS === 'web';
  const rootStyle = isWeb
    ? ({ flex: 1, backgroundColor: '#08080b', backgroundImage: 'radial-gradient(120% 60% at 50% 105%, rgba(255,92,92,.28), transparent 60%)', paddingTop: Math.max(8, insets.top) } as never)
    : { flex: 1, backgroundColor: '#08080b', paddingTop: Math.max(8, insets.top) };

  const head = r ? (
    <View style={[{ gap: 4 }, !wide && { alignItems: 'center', paddingHorizontal: 20 }]}>
      <Text accessibilityRole="header" style={[st.title, wide && { fontSize: 26 }, !wide && { textAlign: 'center' }]}>{recapTitle(r)}</Text>
      {user ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
          <NameWithBadge name={`@${user.username}`} who={user} style={st.handle} containerStyle={{ flexShrink: 1 }} />
          <Text style={st.handle}>· {r.count} Zás</Text>
        </View>
      ) : <Text style={st.handle}>{recapLine(r)}</Text>}
    </View>
  ) : null;

  const privacy = r ? (
    <View style={[st.privacy, !wide && { alignSelf: 'center', marginHorizontal: 20 }]}>
      {/* No telemóvel a frase vai ao centro (sem o ícone, que ficava sozinho à esquerda). */}
      {wide ? <View style={{ paddingTop: 3 }}><Icon name={published ? 'check' : 'lock'} size={14} color={published ? '#6ee7b7' : 'rgba(255,255,255,0.7)'} /></View> : null}
      <Text style={[st.privacyText, !wide && { textAlign: 'center' }]}>{recapPrivacyLine(r)}</Text>
    </View>
  ) : null;

  const actions = r ? (
    <View style={[{ gap: 10 }, !wide && { paddingHorizontal: 20, width: '100%', maxWidth: 460, alignSelf: 'center' }]}>
      <Pressable
        onPress={() => { setErr(''); setSheet(true); }}
        disabled={published}
        accessibilityRole="button"
        accessibilityState={{ disabled: published }}
        style={({ pressed }) => [st.primary, published && st.primaryDone, pressed && !published && { opacity: 0.85 }]}
      >
        <Icon name={published ? 'check' : 'plus'} size={20} color="#fff" strokeWidth={2.6} />
        <Text style={st.primaryText}>{published ? 'Partilhado nos mimos' : 'Partilhar nos mimos'}</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable
          onPress={() => void saveRecap(r, isWeb && finePointer() ? 'file' : 'gallery').then((x) => { if (x === 'saved') flash('Guardado na galeria'); else if (x === 'failed') setErr('Não consegui guardar o resumo.'); })}
          accessibilityRole="button"
          style={({ pressed }) => [st.glassBtn, pressed && { backgroundColor: 'rgba(255,255,255,0.22)' }]}
        >
          <Icon name="download" size={19} color="#fff" />
          <Text style={st.glassText}>Guardar</Text>
        </Pressable>
        <Pressable onPress={() => void shareRecap(r)} accessibilityRole="button" style={({ pressed }) => [st.glassBtn, pressed && { backgroundColor: 'rgba(255,255,255,0.22)' }]}>
          <Icon name="share" size={19} color="#fff" />
          <Text style={st.glassText}>Partilhar</Text>
        </Pressable>
      </View>
      {err ? <Text accessibilityRole="alert" style={st.err}>{err}</Text> : null}
    </View>
  ) : null;

  const image = r ? (
    <View style={[st.card, { width: card.w, height: card.h }]}>
      <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={`O teu resumo dos Zás, ${recapLine(r)}`} accessibilityIgnoresInvertColors />
      {note ? <Text style={st.toast} accessibilityLiveRegion="polite">{note}</Text> : null}
    </View>
  ) : null;

  return (
    <View style={rootStyle}>
      {!isWeb && <LinearGradient colors={['transparent', 'rgba(255,92,92,0.28)']} start={{ x: 0.5, y: 0.4 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />}
      <View style={st.top}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Fechar" style={st.small}><Icon name="x" size={24} color="#fff" /></Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="bolt" size={20} solid color={colors.brand} />
          <Text style={st.brand}>Zás</Text>
        </View>
        {r && !published ? (
          <Pressable onPress={discard} accessibilityRole="button" accessibilityLabel="Descartar o resumo" style={st.small}><Icon name="trash" size={20} color="#fca5a5" /></Pressable>
        ) : <View style={{ width: 44 }} />}
      </View>

      {gone || (!r && q.isError) ? (
        <View style={st.center}>
          <View style={st.goneIcon}><Icon name="bolt" size={28} solid color={colors.brand} /></View>
          <Text style={st.goneTitle}>{gone ? (id ? 'Este resumo já não existe' : 'Ainda não tens um resumo') : 'Não consegui abrir o resumo'}</Text>
          <Text style={st.goneText}>
            {gone
              ? id
                ? 'Os resumos ficam uma semana e depois apagam-se (ou foi descartado).'
                : 'O teu resumo chega ao domingo à noite, quando tiveres pelo menos 3 Zás na semana.'
              : 'Verifica a internet e tenta outra vez.'}
          </Text>
          {!gone ? (
            <Pressable onPress={() => void q.refetch()} accessibilityRole="button" style={st.goneBtn}><Text style={st.glassText}>Tentar outra vez</Text></Pressable>
          ) : (
            <Pressable onPress={onClose} accessibilityRole="button" style={st.goneBtn}><Text style={st.glassText}>Voltar</Text></Pressable>
          )}
        </View>
      ) : !r ? (
        <View style={st.center}><ActivityIndicator color="#fff" /></View>
      ) : wide ? (
        <View onLayout={onArea} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 48, paddingHorizontal: 32, paddingBottom: 24 }}>
          {area.w > 0 ? image : null}
          <View style={{ width: side, gap: 20 }}>
            {head}
            {privacy}
            {actions}
          </View>
        </View>
      ) : (
        <View style={{ flex: 1, paddingBottom: Math.max(16, insets.bottom) }}>
          {head}
          <View onLayout={onArea} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 }}>
            {area.w > 0 ? image : null}
          </View>
          {privacy}
          <View style={{ height: 12 }} />
          {actions}
        </View>
      )}

      {sheet && r && (
        <Sheet title="Partilhar nos mimos" onClose={() => setSheet(false)}>
          <View style={{ paddingHorizontal: 24 }}>
            <Text style={st.sheetIntro}>O resumo fica nos teus mimos 24 horas. Escolhe quem o vê.</Text>
            <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
              {(['all', 'close_friends'] as const).map((a) => {
                const on = audience === a;
                const none = a === 'close_friends' && friends.isSuccess && friends.data.length === 0;
                const text = a === 'all' ? 'Quem pode ver os teus mimos.' : none ? 'Ainda não tens ninguém na lista. Toca para escolher.' : `Só a tua lista${friends.data ? ` (${friends.data.length})` : ''}.`;
                return (
                  <Pressable
                    key={a}
                    onPress={() => { setAudience(a); if (none) setSetupClose(true); }}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    style={({ pressed }) => [st.opt, on && st.optOn, pressed && { backgroundColor: colors.zinc100 }]}
                  >
                    <View style={[st.optIcon, a === 'close_friends' && { backgroundColor: '#d1fae5' }]}>
                      <Icon name={a === 'all' ? 'users' : 'heart'} size={20} color={a === 'all' ? colors.zinc800 : '#059669'} solid={a === 'close_friends'} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={st.optTitle}>{audienceLabel(a)}</Text>
                      <Text style={st.optText}>{text}</Text>
                    </View>
                    <View style={[st.radio, on && st.radioOn]}>{on ? <Icon name="check" size={14} color="#fff" strokeWidth={3} /> : null}</View>
                  </Pressable>
                );
              })}
            </View>
            {err ? <Text accessibilityRole="alert" style={[st.err, { color: colors.red600, marginTop: 12 }]}>{err}</Text> : null}
            <Pressable
              onPress={() => void publish()}
              disabled={busy || (audience === 'close_friends' && friends.isSuccess && friends.data.length === 0)}
              accessibilityRole="button"
              style={[st.sheetBtn, (busy || (audience === 'close_friends' && friends.isSuccess && friends.data.length === 0)) && { opacity: 0.5 }]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.sheetBtnText}>Partilhar nos mimos</Text>}
            </Pressable>
          </View>
        </Sheet>
      )}
      {setupClose && (
        <CloseFriendsSheet
          onClose={async () => {
            setSetupClose(false);
            const l = await friends.refetch();
            if (!l.data?.length) setAudience('all');
          }}
        />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  top: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  small: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  brand: { fontSize: 22, fontWeight: '900', fontStyle: 'italic', letterSpacing: -0.4, color: '#fff' },
  title: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3, color: '#fff' },
  handle: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.7)' },
  card: { borderRadius: 28, overflow: 'hidden', backgroundColor: '#18181b', boxShadow: '0 18px 50px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)' },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, maxWidth: 460 },
  privacyText: { flexShrink: 1, fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.75)' },
  primary: { height: 52, borderRadius: 999, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 8px 24px rgba(214,51,79,0.4)' },
  primaryDone: { backgroundColor: 'rgba(16,185,129,0.25)', boxShadow: 'none' },
  primaryText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  glassBtn: { flex: 1, height: 48, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  glassText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  err: { fontSize: 14, fontWeight: '600', color: '#fca5a5', textAlign: 'center' },
  toast: { position: 'absolute', alignSelf: 'center', top: 16, overflow: 'hidden', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: 'rgba(5,150,105,0.92)', fontSize: 14, fontWeight: '700', color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  goneIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  goneTitle: { marginTop: 16, fontSize: 20, fontWeight: '800', color: '#fff', textAlign: 'center' },
  goneBtn: { marginTop: 20, height: 48, paddingHorizontal: 28, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  goneText: { marginTop: 8, maxWidth: 360, fontSize: 15, lineHeight: 21, color: 'rgba(255,255,255,0.7)', textAlign: 'center' },
  sheetIntro: { marginBottom: 16, fontSize: 15, lineHeight: 21, color: colors.zinc600 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 18, padding: 12, borderWidth: 1.5, borderColor: colors.zinc200 },
  optOn: { borderColor: colors.brand, backgroundColor: '#fff5f6' },
  optIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.zinc100, alignItems: 'center', justifyContent: 'center' },
  optTitle: { fontSize: 16, fontWeight: '700', color: colors.zinc900 },
  optText: { marginTop: 1, fontSize: 14, color: colors.zinc600 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.zinc300, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.brand, backgroundColor: colors.brand },
  sheetBtn: { marginTop: 20, height: 50, borderRadius: 999, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  sheetBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },
});
