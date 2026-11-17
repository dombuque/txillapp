import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';
import { markSeen, useIsNew } from '@/lib/whatsNew';
import { colors } from '@/lib/theme';
import { Icon, type IconName } from './Icon';
import { Sheet } from './Sheet';
import { Button } from './ui/Button';
import { t } from '@/lib/i18n';

interface Point { icon: IconName; title: string; text: string }
interface Intro { icon: IconName; title: string; points: Point[]; note?: string }

/**
 * As boas-vindas a cada função (como o WhatsApp faz ao abrir uma função nova): aparecem uma só vez, na primeira vez que a
 * pessoa a usa. Para acrescentar uma função: uma entrada aqui e `<FeatureIntro id="…" />` no ecrã dela.
 * Guarda-se neste aparelho (a mesma lista das novidades do Início).
 */
export const INTROS: Record<string, Intro> = {
  camera: {
    icon: 'camera',
    get title() { return t('A câmara do Txillapp'); },
    points: [
      { icon: 'camera', get title() { return t('Toca para foto, mantém para vídeo'); }, get text() { return t('Um botão só. Larga para parar de gravar.'); } },
      { icon: 'sparkles', get title() { return t('Filtros a deslizar'); }, get text() { return t('Desliza para o lado para trocar de filtro. Pinça para aproximar.'); } },
      { icon: 'grid', get title() { return t('Layout'); }, get text() { return t('Várias fotos numa só imagem. Depois de tirar, podes editar antes de usar.'); } },
    ],
  },
  zas: {
    icon: 'bolt',
    title: 'Zás!',
    points: [
      { icon: 'camera', get title() { return t('Foto na hora'); }, get text() { return t('Sem galeria: é o momento, como está. O botão tira e envia logo.'); } },
      { icon: 'clock', get title() { return t('Dura 24 horas'); }, get text() { return t('E cada pessoa só vê uma vez. Depois desaparece.'); } },
      { icon: 'users', get title() { return t('Só para a malta'); }, get text() { return t('Chega aos amigos próximos e a quem segues e te segue.'); } },
    ],
    get note() { return t('Vês quem viu e as reações de cada um.'); },
  },
  mimo: {
    icon: 'sparkles',
    get title() { return t('O teu mimo'); },
    points: [
      { icon: 'clock', get title() { return t('Dura 24 horas'); }, get text() { return t('Foto ou vídeo com legenda e música, para quem te segue.'); } },
      { icon: 'heart', get title() { return t('Amigos próximos'); }, get text() { return t('Podes mandar só para a tua lista de amigos próximos.'); } },
      { icon: 'eye', get title() { return t('Quem viu'); }, get text() { return t('Vês quem viu, quem brindou e as respostas, só tu.'); } },
    ],
  },
  geleira: {
    icon: 'snowflake',
    get title() { return t('Enche a tua geleira'); },
    points: [
      { icon: 'search', get title() { return t('Escolhe os teus gostos'); }, get text() { return t('Bebidas, comidas e vibes. Procura e toca para pôr na geleira.'); } },
      { icon: 'snowflake', get title() { return t('Dá a nota em flocos'); }, get text() { return t('Mais flocos, mais gelado, mais gostas. O coração marca os favoritos.'); } },
      { icon: 'trending', get title() { return t('Sobe de nível'); }, get text() { return t('Quantidade, variedade e notas dão pontos. A malta vê o teu nível no perfil.'); } },
    ],
    get note() { return t('As mudanças só vão para o servidor quando carregas em Guardar.'); },
  },
  supertxill: {
    icon: 'sparkles',
    title: 'SuperTxill',
    points: [
      { icon: 'sparkles', get title() { return t('Pergunta o que quiseres'); }, get text() { return t('Onde anda a malta, sítios e eventos perto, Txilladas, planos e legendas. Pode demorar umas dezenas de segundos a pensar.'); } },
      { icon: 'shield', get title() { return t('Fica no Txillapp'); }, get text() { return t('Corre no nosso servidor e só usa o que já podes ver na app. Nunca pede o GPS. Pode errar: confirma o que for importante.'); } },
      { icon: 'users', get title() { return t('Malta para ti'); }, get text() { return t('Pessoas com gostos parecidos com os teus, escolhidas pelo Txillapp.'); } },
    ],
    get note() { return t('Guarda as últimas 60 mensagens, só para ti. Apagas a conversa quando quiseres.'); },
  },
};

/** Monta-se no ecrã da função; só aparece a primeira vez. */
export function FeatureIntro({ id }: { id: string }) {
  const key = `intro:${id}`;
  const fresh = useIsNew(key);
  const intro = INTROS[id];
  if (!fresh || !intro) return null;
  const done = () => markSeen(key);
  return (
    <Sheet onClose={done} plain>
      <View style={st.wrap}>
        <View style={st.hero}>
          <LinearGradient colors={[colors.brand, colors.brandWarm]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={{ position: 'relative' }}><Icon name={intro.icon} size={56} color="#fff" strokeWidth={1.8} /></View>
        </View>
        <Text style={st.title}>{intro.title}</Text>
        <View style={{ gap: 18, marginTop: 20 }}>
          {intro.points.map((p) => (
            <View key={p.title} style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }}>
              <View style={{ width: 28, alignItems: 'center', paddingTop: 2 }}><Icon name={p.icon} size={22} color={colors.zinc700} /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.pTitle}>{p.title}</Text>
                <Text style={st.pText}>{p.text}</Text>
              </View>
            </View>
          ))}
        </View>
        {intro.note ? <Text style={st.note}>{intro.note}</Text> : null}
        <Button label={t('Continuar')} onPress={done} block style={st.btn} />
      </View>
    </Sheet>
  );
}

const st = StyleSheet.create({
  wrap: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 },
  hero: { alignSelf: 'center', width: 120, height: 120, borderRadius: 60, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  title: { textAlign: 'center', fontSize: 26, lineHeight: 31, fontWeight: '800', color: colors.zinc900, letterSpacing: -0.3 },
  pTitle: { fontSize: 16, fontWeight: '700', color: colors.zinc900, lineHeight: 21 },
  pText: { fontSize: 15, lineHeight: 20, color: colors.zinc600, marginTop: 1 },
  note: { marginTop: 22, textAlign: 'center', fontSize: 13, lineHeight: 18, color: colors.zinc500 },
  btn: { marginTop: 22 },
});
