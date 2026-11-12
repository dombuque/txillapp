import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { canSelfUpdate } from '@/lib/distribution';
import { kvGet, kvSet } from '@/lib/kv';
import { colors } from '@/lib/theme';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

/** Onde está a versão mais recente do APK (posta no servidor junto com o APK, em /opt/txillapp/downloads/beta). */
const LATEST_URL = 'https://txillapp.com/app/beta/latest.json';
const SNOOZE_KEY = 'tx_update_snooze';
const SNOOZE_MS = 24 * 60 * 60 * 1000;

interface Latest {
  /** Versão (SemVer) do APK mais recente, ex.: "1.9.0". */
  version: string;
  /** Endereço do APK. */
  url: string;
  /** O que há de novo (uma ou duas frases). */
  notes?: string;
  /** Abaixo desta versão a atualização é obrigatória (o aviso não se pode fechar). */
  min?: string;
}

/** Compara versões SemVer: negativo se a < b, 0 se iguais, positivo se a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * App Android (fora da Play Store): ao abrir e ao voltar à app, pergunta ao servidor qual é a versão mais recente do APK.
 * Se houver nova, mostra o aviso com Atualizar (descarrega o APK; o Android pede para confirmar a instalação).
 * "Agora não" esconde o aviso durante 24 horas, a não ser que a atualização seja obrigatória.
 * Só no APK beta (canal 'beta'). Numa app do Google Play não se pergunta nada ao servidor nem aparece aviso nenhum: a
 * política do Play (Device and Network Abuse) proíbe atualizar ou sugerir um APK por fora da loja; quem atualiza é o Play.
 */
export function AppUpdate() {
  const [latest, setLatest] = useState<Latest | null>(null);
  const mine = Constants.expoConfig?.version ?? '0.0.0';

  useEffect(() => {
    if (Platform.OS !== 'android' || !canSelfUpdate) return;
    let last = 0;
    async function check() {
      if (Date.now() - last < 5 * 60 * 1000) return; // no máximo de 5 em 5 minutos
      last = Date.now();
      try {
        const r = await fetch(`${LATEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return;
        const l = (await r.json()) as Latest;
        if (!l?.version || !l.url || !/^https:\/\/txillapp\.com\//.test(l.url)) return;
        if (compareVersions(l.version, mine) <= 0) return;
        const forced = !!l.min && compareVersions(mine, l.min) < 0;
        const snoozed = Number((await kvGet(SNOOZE_KEY)) ?? 0);
        if (!forced && snoozed && Date.now() - snoozed < SNOOZE_MS) return;
        setLatest(l);
      } catch {
        /* sem rede: tenta na próxima vez */
      }
    }
    void check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void check(); });
    return () => sub.remove();
  }, [mine]);

  if (!latest || !canSelfUpdate) return null;
  const forced = !!latest.min && compareVersions(mine, latest.min) < 0;
  const later = () => { void kvSet(SNOOZE_KEY, String(Date.now())); setLatest(null); };
  const update = () => { void Linking.openURL(latest.url); if (!forced) setLatest(null); };

  return (
    <Sheet onClose={forced ? () => undefined : later} plain>
      <View style={st.wrap}>
        <View style={st.icon}><Icon name="download" size={30} color="#fff" /></View>
        <Text style={st.title}>Nova versão do Txillapp</Text>
        <Text style={st.sub}>A versão {latest.version} já está disponível. Tens a {mine}.</Text>
        {latest.notes ? <Text style={st.notes}>{latest.notes}</Text> : null}
        <Pressable onPress={update} style={({ pressed }) => [st.primary, pressed && { opacity: 0.85 }]} accessibilityRole="button">
          <Text style={st.primaryText}>Atualizar</Text>
        </Pressable>
        <Text style={st.help}>O Android pede para confirmar a instalação: toca em Instalar.</Text>
        {!forced ? (
          <Pressable onPress={later} style={st.ghost} accessibilityRole="button"><Text style={st.ghostText}>Agora não</Text></Pressable>
        ) : null}
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 8, alignItems: 'center' },
  icon: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 16, fontSize: 21, fontWeight: '800', color: colors.zinc900, textAlign: 'center' },
  sub: { marginTop: 6, fontSize: 15, lineHeight: 21, color: colors.zinc600, textAlign: 'center' },
  notes: { marginTop: 12, fontSize: 15, lineHeight: 21, color: colors.zinc800, textAlign: 'center' },
  primary: { marginTop: 22, alignSelf: 'stretch', height: 50, borderRadius: 25, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  help: { marginTop: 10, fontSize: 13, color: colors.zinc500, textAlign: 'center' },
  ghost: { marginTop: 6, height: 44, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 15, fontWeight: '700', color: colors.zinc700 },
});
