import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Modal } from '@/components/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { useOverlay } from '@/lib/overlays';
import { colors, typo } from '@/lib/theme';
import { Icon, type IconName } from './Icon';
import { Button } from './ui/Button';

interface Step { icon: IconName; title: string; text: string }

const STEPS: Step[] = [
  { icon: 'sparkles', title: 'Bem-vindo ao Txillapp', text: 'Dois minutos e já sabes onde está tudo. Podes saltar quando quiseres.' },
  { icon: 'home', title: 'Início', text: 'O feed da malta e dos sítios onde andam. Toca outra vez no ícone para voltar ao topo e atualizar.' },
  { icon: 'search', title: 'Pesquisar', text: 'No canto de cima: procura pessoas, hashtags e sítios a bater perto de ti.' },
  { icon: 'plus', title: 'Publicar', text: 'Foto, vídeo ou só texto, com sítio e malta identificada. A tua vibe, tu mandas.' },
  { icon: 'messages', title: 'Mensagens', text: 'Conversas, TxillGroups e notas de 24 horas. Manda fotos, voz, stickers e a tua localização.' },
  { icon: 'film', title: 'Tchekas', text: 'Vídeos curtos a tocar sem parar. Brinda, comenta e oferece vibes sem sair do vídeo.' },
  { icon: 'user', title: 'O teu perfil', text: 'Aqui moram as tuas publicações, as definições e a tua geleira.' },
  { icon: 'snowflake', title: 'Enche a tua geleira', text: 'Diz-nos as tuas ambientes, bebidas, comidas e sítios favoritos. É assim que a malta fica a saber quem tu és.' },
];

/** Visita guiada para quem acabou de registar: cartão passo a passo sobre o Início. Só aparece uma vez (o servidor guarda). */
export function WelcomeTour() {
  const qc = useQueryClient();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const privacy = useQuery({ queryKey: ['privacy'], queryFn: api.privacy, staleTime: 60_000 });
  const [i, setI] = useState(0);
  const p = privacy.data;
  useOverlay(!!p && p.welcomed === false);
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
              {!last && <Button label="Saltar" kind="ghost" size="md" onPress={() => finish(false)} style={st.ghost} />}
              {last ? (
                <>
                  <Button label="Depois" kind="ghost" size="md" onPress={() => finish(false)} style={st.ghost} />
                  <Button label="Encher agora" size="md" onPress={() => finish(true)} />
                </>
              ) : (
                <Button label="Seguinte" size="md" onPress={() => setI(i + 1)} />
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
  title: { flex: 1, ...typo.title, color: colors.zinc900, lineHeight: 24 },
  text: { marginTop: 12, fontSize: 16, lineHeight: 22, color: colors.zinc700 },
  foot: { marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.zinc300 },
  dotOn: { width: 20, backgroundColor: colors.brand },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ghost: { paddingHorizontal: 12 },
});
