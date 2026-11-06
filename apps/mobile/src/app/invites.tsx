import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Empty } from '@/components/Empty';
import { Icon, type IconName } from '@/components/Icon';
import { StackPage } from '@/components/StackPage';
import { api } from '@/lib/api';
import { colors } from '@/lib/theme';

/** Convida a tua malta: o teu código e ligação, quantos entraram e o que já ganhaste. */
export default function Invites() {
  const q = useQuery({ queryKey: ['invites'], queryFn: api.invites, staleTime: 30_000 });
  const [copied, setCopied] = useState(false);
  const d = q.data;

  async function share() {
    if (!d) return;
    try {
      await Share.share({ message: `Entra no Txillapp com o meu convite e ganhamos Txills os dois: ${d.link}`, url: d.link });
    } catch {
      /* cancelado */
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
    <View style={st.stat}>
      <Text style={{ fontSize: 24, fontWeight: '800', color: colors.zinc900 }}>{n}</Text>
      <Text style={{ fontSize: 13, lineHeight: 16, color: colors.zinc600, textAlign: 'center' }}>{label}</Text>
    </View>
  );
  const li = (icon: IconName, color: string, text: string) => (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <View style={{ marginTop: 2 }}><Icon name={icon} size={18} color={color} /></View>
      <Text style={{ flex: 1, fontSize: 15, lineHeight: 21, color: colors.zinc700 }}>{text}</Text>
    </View>
  );

  return (
    <StackPage title="Convida a tua malta">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {q.isLoading && <ActivityIndicator style={{ marginTop: 40 }} color={colors.brand} />}
        {q.isError && <Empty icon="user-plus" title="Não consegui abrir os convites." />}
        {d && (
          <>
            <LinearGradient colors={[colors.brand, '#ff8a5b']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.hero}>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600', opacity: 0.9 }}>O teu código</Text>
              <Text style={{ color: '#fff', fontSize: 38, fontWeight: '900', letterSpacing: 7, marginTop: 4 }}>{d.code}</Text>
              <Text style={{ color: '#fff', fontSize: 15, lineHeight: 21, textAlign: 'center', marginTop: 8, maxWidth: 300 }}>
                Quando quem convidas ficar ativo, os dois ganham {d.rules.reward} Txills.
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 16, alignSelf: 'stretch' }}>
                <Pressable onPress={() => void share()} style={[st.btn, { backgroundColor: '#fff' }]} accessibilityRole="button">
                  <Icon name="share" size={19} color={colors.brand} />
                  <Text style={{ fontWeight: '700', fontSize: 16, color: colors.brand }}>Partilhar</Text>
                </Pressable>
                <Pressable onPress={() => void copy()} style={[st.btn, { backgroundColor: 'rgba(255,255,255,0.2)' }]} accessibilityRole="button">
                  <Icon name={copied ? 'check' : 'link'} size={19} color="#fff" />
                  <Text style={{ fontWeight: '700', fontSize: 16, color: '#fff' }}>{copied ? 'Copiado' : 'Copiar'}</Text>
                </Pressable>
              </View>
            </LinearGradient>

            {d.note ? <Text style={st.note} accessibilityRole="text">{d.note}</Text> : null}

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
              {stat(d.stats.invited, 'Entraram')}
              {stat(d.stats.active, 'Ficaram ativos')}
              {stat(d.stats.earned, 'Txills ganhos')}
            </View>
            {d.stats.pending > 0 && <Text style={{ marginTop: 8, textAlign: 'center', fontSize: 13, color: colors.zinc500 }}>{d.stats.pending} em espera: o teu prémio chega {d.rules.holdDays} dias depois de a pessoa ficar ativa.</Text>}

            <Text style={{ marginTop: 28, marginBottom: 8, fontSize: 18, fontWeight: '800', color: colors.zinc900 }}>Como funciona</Text>
            <View style={{ gap: 8 }}>
              {li('check-circle', '#059669', 'A pessoa entra pela tua ligação ou com o teu código.')}
              {li('check-circle', '#059669', `Fica ativa quando confirma o email e publica algo, ou segue 3 pessoas. Aí ela ganha logo ${d.rules.reward} Txills.`)}
              {li('check-circle', '#059669', `Tu ganhas ${d.rules.reward} Txills passados ${d.rules.holdDays} dias, se ela continuar por cá.`)}
              {li('info', colors.zinc500, `Até ${d.rules.perDay} convites por dia e ${d.rules.maxPaid} no total. Depois disso o convite continua a funcionar, mas sem Txills.`)}
              {li('info', colors.zinc500, 'Contas repetidas, emails temporários e registos em massa não contam. Os Txills são pontos da app.')}
            </View>
          </>
        )}
      </ScrollView>
    </StackPage>
  );
}

const st = StyleSheet.create({
  hero: { borderRadius: 26, paddingHorizontal: 20, paddingVertical: 24, alignItems: 'center', boxShadow: '0 6px 18px rgba(214,51,79,0.35)' },
  btn: { flex: 1, height: 48, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  stat: { flex: 1, borderRadius: 16, backgroundColor: '#fafafa', borderWidth: 1, borderColor: colors.zinc100, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center' },
  note: { marginTop: 16, borderRadius: 16, backgroundColor: '#fffbeb', paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, color: '#78350f' },
});
