import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, ast } from '@/components/ArtistUi';
import { Sheet } from '@/components/Sheet';
import { artistsApi } from '@/lib/api.artists';
import type { Track } from '@/lib/api.music';
import { RIGHTS_CONTACT, RIGHTS_SUBJECT } from '@/lib/artists';
import { colors } from '@/lib/theme';

/**
 * «Artistas de Moçambique» no seletor de música: as faixas aprovadas do programa de artistas (interface comum, `source: 'local'`).
 * Só nos mimos e nas tchekas (é o que a licença autoriza): quem abre o seletor noutro sítio passa `allow={false}`.
 * `q`: o que a pessoa escreveu na pesquisa (com 2 letras ou mais, filtra por título ou artista). `row` desenha cada faixa
 * como as outras do seletor.
 */
export function LocalArtistsSection({ q = '', row, allow = true }: { q?: string; row: (t: Track) => ReactNode; allow?: boolean }) {
  const term = q.trim().length >= 2 ? q.trim() : '';
  const list = useQuery({ queryKey: ['music-local', term], queryFn: () => artistsApi.catalog(term ? { q: term } : {}), enabled: allow, staleTime: 60_000, retry: false });
  const items = (list.data ?? []) as unknown as Track[];
  if (!allow || !items.length) return null;
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={s.h}>Artistas de Moçambique</Text>
      {items.slice(0, term ? 10 : 8).map(row)}
    </View>
  );
}

const RELATIONS = [['owner', 'Sou o autor ou titular'], ['label', 'Sou a editora'], ['representative', 'Represento o titular'], ['other', 'Outra']] as const;

/** Denunciar uma faixa por violação de direitos de autor. A faixa fica escondida enquanto a equipa analisa. */
export function RightsReportSheet({ track, onClose }: { track: Track; onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [relation, setRelation] = useState<(typeof RELATIONS)[number][0]>('owner');
  const [details, setDetails] = useState('');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const ready = name.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(email.trim()) && details.trim().length >= 10 && sure && !busy;

  async function send() {
    setBusy(true);
    setErr('');
    try {
      await artistsApi.report(track.id, { claimantName: name.trim(), contactEmail: email.trim(), relation, details: details.trim() });
      setDone(true);
    } catch (e) {
      setErr((e as Error).message || 'Não consegui enviar');
    }
    setBusy(false);
  }

  return (
    <Sheet title={done ? 'Denúncia enviada' : 'Direitos de autor'} onClose={onClose}>
      <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
        {done ? (
          <>
            <Text style={ast.cardSub}>Obrigado. «{track.title}» fica escondida enquanto a equipa do Txillapp analisa. Podemos contactar-te por email.</Text>
            <Pressable onPress={onClose} style={ast.primary} accessibilityRole="button"><Text style={ast.primaryTxt}>Fechar</Text></Pressable>
          </>
        ) : (
          <>
            <Text style={ast.cardSub}>Achas que «{track.title}» · {track.artist} usa uma música tua (ou de quem representas) sem autorização? Diz-nos quem és e porquê. A música fica escondida logo, até a equipa decidir.</Text>
            <Text style={[ast.label, { marginTop: 14 }]}>O teu nome (ou da editora)</Text>
            <TextInput value={name} onChangeText={setName} maxLength={80} style={ast.input} accessibilityLabel="Nome" />
            <Text style={[ast.label, { marginTop: 12 }]}>Email para te contactarmos</Text>
            <TextInput value={email} onChangeText={setEmail} maxLength={160} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={ast.input} accessibilityLabel="Email" />
            <Text style={[ast.label, { marginTop: 12 }]}>Quem és</Text>
            <View style={ast.chips}>
              {RELATIONS.map(([k, l]) => (
                <Pressable key={k} onPress={() => setRelation(k)} style={[ast.chip, relation === k && ast.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: relation === k }}>
                  <Text style={[ast.chipTxt, relation === k && { color: '#fff' }]}>{l}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[ast.label, { marginTop: 12 }]}>O que se passa</Text>
            <TextInput value={details} onChangeText={setDetails} multiline maxLength={1000} placeholder="Qual é a obra original, onde está publicada e porque é tua." placeholderTextColor={colors.zinc500} style={[ast.input, { minHeight: 96, textAlignVertical: 'top' }]} accessibilityLabel="Detalhes" />
            <Check on={sure} onChange={setSure}>Confirmo que a informação é verdadeira. Denúncias falsas podem levar à suspensão da conta.</Check>
            {err ? <Text style={ast.err}>{err}</Text> : null}
            <Pressable disabled={!ready} onPress={() => void send()} style={[ast.primary, !ready && { opacity: 0.45 }]} accessibilityRole="button"><Text style={ast.primaryTxt}>{busy ? 'A enviar…' : 'Denunciar'}</Text></Pressable>
            <Text style={[ast.hint, { textAlign: 'center' }]}>
              Também podes escrever para{' '}
              <Text style={{ textDecorationLine: 'underline' }} onPress={() => void Linking.openURL(`mailto:${RIGHTS_CONTACT}?subject=${encodeURIComponent(RIGHTS_SUBJECT)}`)}>{RIGHTS_CONTACT}</Text>
            </Text>
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

/** A linha «♪ Título · Artista» com o nome do artista a levar ao perfil. */
export function LocalTrackLine({ track, style, linkStyle, onArtist }: { track: Track; style: object; linkStyle?: object; onArtist?: () => void }) {
  return (
    <Text style={style} numberOfLines={1}>
      {'♪ '}{track.title}{track.artist ? ' · ' : ''}
      {track.artist ? <Text style={[{ fontWeight: '700' }, linkStyle]} onPress={onArtist} accessibilityRole="link">{track.artist}</Text> : null}
    </Text>
  );
}

const s = StyleSheet.create({
  h: { fontSize: 13, fontWeight: '700', color: colors.zinc500, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
});
