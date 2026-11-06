import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { colors } from '@/lib/theme';
import { Icon, type IconName } from './Icon';

interface Step { icon: IconName; title: string; text: string }

const STEPS: Step[] = [
  { icon: 'sparkles', title: 'Bem-vindo ao Txillapp', text: 'Dois minutos e já sabes onde está tudo. Podes saltar quando quiseres.' },
  { icon: 'home', title: 'Início', text: 'O feed da malta e dos sítios onde andam. Toca outra vez no ícone para voltar ao topo e atualizar.' },
  { icon: 'search', title: 'Pesquisar', text: 'No canto de cima: procura pessoas, hashtags e sítios a bater perto de ti.' },
  { icon: 'plus', title: 'Publicar', text: 'Foto, vídeo ou só texto, com sítio e malta identificada. A tua vibe, tu mandas.' },
  { icon: 'send', title: 'Mensagens', text: 'Conversas, grupos e notas de 24 horas. Manda fotos, voz, stickers e a tua localização.' },
  { icon: 'film', title: 'Reels', text: 'Vídeos curtos a tocar sem parar. Brinda, comenta e presenteia sem sair do vídeo.' },
  { icon: 'user', title: 'O teu perfil', text: 'Aqui moram as tuas publicações, as definições e a tua geleira.' },
  { icon: 'snowflake', title: 'Enche a tua geleira', text: 'Diz-nos as tuas vibes, bebidas, comidas e sítios favoritos. É assim que a malta fica a saber quem tu és.' },
];

/** Visita guiada para quem acabou de registar: cartão passo a passo sobre o Início. Só aparece uma vez (o servidor guarda). */
export function WelcomeTour() {
  const qc = useQueryClient();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const privacy = useQuery({ queryKey: ['privacy'], queryFn: api.privacy, staleTime: 60_000 });
  const [i, setI] = useState(0);
  const p = privacy.data;
  if (!p || p.welcomed !== false) return null;
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  function finish(openGeleira: boolean) {
    qc.setQueryData(['privacy'], { ...p!, welcomed: true }); // fecha já; o servidor confirma a seguir
    api.setWelcomed().then((r) => qc.setQueryData(['privacy'], r)).catch(() => undefined);
    if (openGeleira) router.push('/geleira');
  }

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => finish(false)} statusBarTranslucent>
      <View style={[st.back, { paddingBottom: insets.bottom + 96 }]} accessibilityViewIsModal accessibilityLabel="Visita guiada">
        <View style={st.card}>
          <View style={st.head}>
            <View style={st.iconWrap}><Icon name={step.icon} size={22} color={colors.brand} /></View>
            <Text style={st.title}>{step.title}</Text>
          </View>
          <Text style={st.text}>{step.text}</Text>
          <View style={st.foot}>
            <View style={st.dots} accessibilityLabel={`Passo ${i + 1} de ${STEPS.length}`}>
              {STEPS.map((_, n) => <View key={n} style={[st.dot, n === i && st.dotOn]} />)}
            </View>
            <View style={st.actions}>
              {!last && <Pressable onPress={() => finish(false)} style={st.ghost} accessibilityRole="button"><Text style={st.ghostText}>Saltar</Text></Pressable>}
              {last ? (
                <>
                  <Pressable onPress={() => finish(false)} style={st.ghost} accessibilityRole="button"><Text style={st.ghostText}>Depois</Text></Pressable>
                  <Pressable onPress={() => finish(true)} style={st.primary} accessibilityRole="button"><Text style={st.primaryText}>Encher agora</Text></Pressable>
                </>
              ) : (
                <Pressable onPress={() => setI(i + 1)} style={st.primary} accessibilityRole="button"><Text style={st.primaryText}>Seguinte</Text></Pressable>
              )}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  back: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 16 },
  card: { width: '100%', maxWidth: 384, borderRadius: 24, backgroundColor: colors.white, padding: 20, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.zinc900, lineHeight: 24 },
  text: { marginTop: 12, fontSize: 16, lineHeight: 22, color: colors.zinc700 },
  foot: { marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.zinc300 },
  dotOn: { width: 20, backgroundColor: colors.brand },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ghost: { height: 44, paddingHorizontal: 12, justifyContent: 'center' },
  ghostText: { fontSize: 14, fontWeight: '600', color: colors.zinc600 },
  primary: { height: 44, paddingHorizontal: 20, borderRadius: 22, backgroundColor: colors.brand, justifyContent: 'center' },
  primaryText: { fontSize: 15, fontWeight: '700', color: colors.white },
});
