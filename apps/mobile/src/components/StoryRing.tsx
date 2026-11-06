import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { colors } from '@/lib/theme';

/** Anel de stories: um arco por story (já vistos a cinzento, novos a cores; verde se for só para amigos próximos). */
export function Ring({ count, seenCount = 0, green = false, children }: { count: number; seenCount?: number; green?: boolean; children: React.ReactNode }) {
  const n = Math.max(1, Math.min(count, 12));
  const step = 100 / n;
  const seg = n === 1 ? 100 : step - 3.2;
  const circ = 2 * Math.PI * 33;
  return (
    <View style={styles.ring}>
      <Svg width={72} height={72} viewBox="0 0 72 72" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="sr" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor="#d6334f" />
            <Stop offset="1" stopColor="#fbbf24" />
          </LinearGradient>
          <LinearGradient id="srg" x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor="#059669" />
            <Stop offset="1" stopColor="#4ade80" />
          </LinearGradient>
        </Defs>
        {Array.from({ length: n }, (_, i) => (
          <Circle
            key={i}
            cx={36}
            cy={36}
            r={33}
            fill="none"
            strokeWidth={3.5}
            strokeLinecap="round"
            stroke={i < seenCount ? '#d4d4d8' : green ? 'url(#srg)' : 'url(#sr)'}
            strokeDasharray={`${(seg / 100) * circ} ${circ - (seg / 100) * circ}`}
            strokeDashoffset={-(i * step * circ) / 100}
            rotation={-90}
            origin="36, 36"
          />
        ))}
      </Svg>
      <View style={styles.ringInner}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  ringInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
});
