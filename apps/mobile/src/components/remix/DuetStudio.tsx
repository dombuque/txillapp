import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator } from '@/components/PontoLoader';
import { api, isTcheka } from '@/lib/api';
import { abs, SITE_URL } from '@/lib/config';
import { enqueuePublish } from '@/lib/publishQueue';
import { duetHref } from '@/lib/remix';
import { colors } from '@/lib/theme';
import { Icon } from '../Icon';
import type { Shot } from '../TxCamera';
import { DuetGlyph } from './RemixParts';
import { RemixRecorder, type RemixOriginal } from './RemixRecorder';
import { DarkToggle, RemixReview } from './RemixReview';

/** Um ecrã escuro com uma mensagem e «Voltar» (dueto indisponível, no telemóvel, ou erro ao carregar). */
export function RemixMessage({ title, text, action, onClose }: { title: string; text: string; action?: { label: string; onPress: () => void }; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[st.msgRoot, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <DuetGlyph size={56} />
      <Text style={st.msgTitle}>{title}</Text>
      <Text style={st.msgText}>{text}</Text>
      {action ? <Pressable onPress={action.onPress} style={st.msgCta} accessibilityRole="button"><Text style={st.msgCtaText}>{action.label}</Text></Pressable> : null}
      <Pressable onPress={onClose} style={st.msgBack} accessibilityRole="button"><Text style={st.msgBackText}>Voltar</Text></Pressable>
    </View>
  );
}

/**
 * O estúdio do dueto (/tcheka/nova?dueto=<postId>): ecrã dividido com a câmara à esquerda e a tcheka original à direita,
 * a tocar enquanto se grava; a montagem sai lado a lado, com o som do original e (se ligado) o microfone. Depois: legenda,
 * «Som do original» na publicação e «Publicar» (em segundo plano, como as outras publicações).
 * No telemóvel (nativo) ainda não há gravação lado a lado: mostra «O dueto ainda só está no site».
 */
export function DuetStudio({ postId }: { postId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const close = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/')), [router]);
  const q = useQuery({ queryKey: ['post', postId], queryFn: () => api.getPost(postId), retry: false });
  const [shot, setShot] = useState<Shot | null>(null);
  const [keepSound, setKeepSound] = useState(true);
  const [busy, setBusy] = useState(false);
  const p = q.data;
  const original = useMemo<RemixOriginal | null>(() => {
    const m = p && isTcheka(p) ? p.media[0] : null;
    return m ? { url: abs(m.url)!, durationMs: m.durationMs ?? null, posterUrl: abs(m.posterUrl) ?? null } : null;
  }, [p]);
  const onDone = useCallback((s: Shot) => setShot(s), []);

  if (Platform.OS !== 'web') {
    return (
      <RemixMessage
        title="O dueto ainda só está no site"
        text="Para gravar ao lado desta tcheka, abre o Txillapp no browser do telemóvel ou do computador. Em breve chega à app."
        action={{ label: 'Abrir no site', onPress: () => void Linking.openURL(`${SITE_URL || 'https://txillapp.com'}${duetHref(postId)}`) }}
        onClose={close}
      />
    );
  }
  if (q.isLoading) return <View style={st.loading}><ActivityIndicator color="#fff" /></View>;
  if (!p) return <RemixMessage title="Tcheka não encontrada" text="Pode ter sido apagada, ou a conta passou a privada." onClose={close} />;
  if (!original) return <RemixMessage title="Só dá para fazer dueto com uma tcheka" text="Esta publicação não é uma tcheka (um vídeo só)." onClose={close} />;
  if (!p.canRemix) return <RemixMessage title="Duetos desligados" text={`${p.author.displayName} não deixa fazer duetos nem responder com tchekas.`} onClose={close} />;

  const who = `@${p.author.username}`;
  if (!shot) return <RemixRecorder original={original} title={`Dueto com ${who}`} onDone={onDone} onClose={close} />;

  function publish(body: string) {
    if (!shot || busy) return;
    setBusy(true);
    enqueuePublish({
      assets: [{ uri: shot.uri, mime: shot.mime, video: true, signed: shot.signed }],
      // Sem música escolhida: o servidor dá-lhe o som do original (music por mandar); «sem som do original» manda null.
      post: { body, remixOf: { postId, kind: 'duet' }, ...(keepSound ? {} : { music: null }) },
    }, qc);
    router.replace('/');
  }
  return (
    <RemixReview
      uri={shot.uri}
      title={`Dueto com ${who}`}
      busy={busy}
      onBack={() => { URL.revokeObjectURL(shot.uri); setShot(null); }}
      onPublish={publish}
      options={
        <>
          <DarkToggle
            on={keepSound}
            onChange={setKeepSound}
            title={p.sound || p.music ? `Som do original: ${p.sound?.title ?? p.music?.title}` : 'Som do original'}
            sub={keepSound ? 'O dueto fica ligado ao som desta tcheka' : 'O dueto fica só com o som gravado'}
          />
          <View style={st.credit}>
            <Icon name="info" size={14} color="rgba(255,255,255,0.7)" />
            <Text style={st.creditText}>Aparece «Dueto com {who}», com ligação à tcheka original.</Text>
          </View>
        </>
      }
    />
  );
}

const st = StyleSheet.create({
  loading: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  msgRoot: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  msgTitle: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  msgText: { color: 'rgba(255,255,255,0.75)', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  msgCta: { marginTop: 12, height: 46, paddingHorizontal: 24, borderRadius: 23, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  msgCtaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  msgBack: { height: 44, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  msgBackText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  credit: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  creditText: { color: 'rgba(255,255,255,0.7)', fontSize: 12, flex: 1 },
});
