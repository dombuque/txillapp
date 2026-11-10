import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

/** O alfinete parado ao centro do mapa de "Marcar no mapa" (a ponta fica no centro). Não apanha toques. */
export function PickPin() {
  return (
    <View pointerEvents="none" style={st.wrap} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={st.pin}>
        <Svg width={40} height={48} viewBox="0 0 40 48">
          <Path d="M20 46s-15-13.2-15-25.5a15 15 0 0 1 30 0C35 32.8 20 46 20 46Z" fill="#d6334f" stroke="#fff" strokeWidth={3} />
          <Circle cx={20} cy={20} r={5.5} fill="#fff" />
        </Svg>
      </View>
      <View style={st.dot} />
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  // A ponta do alfinete (em baixo) fica no centro: sobe metade da altura.
  pin: { marginTop: -48 },
  dot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.35)' },
});
