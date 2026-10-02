import { Text, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Polygon, Rect } from 'react-native-svg';
import { characterOf, displayName, type CharacterPrefs, type Mood } from '@mello/shared';
import { colors } from './ui';

/**
 * The user's character, drawn as simple vectors so every species and mood is one component.
 * 100×100 viewBox: body around the centre, face at y≈52.
 */
export function CharacterArt({ prefs, mood = 'happy', size = 96 }: { prefs: Partial<CharacterPrefs> | null | undefined; mood?: Mood; size?: number }) {
  const c = characterOf(prefs);
  const { body, accent, ink } = c.colors;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel={`${c.name} the ${c.species}, ${mood}`}>
      <Species id={c.id} body={body} accent={accent} ink={ink} />
      <Face mood={mood} ink={c.id === 'luna' ? '#F4F1E8' : ink} cheeks={c.id !== 'bruno'} />
      {c.id === 'pip' && <Polygon points="50,58 45,64 55,64" fill={accent} />}
    </Svg>
  );
}

function Species({ id, body, accent, ink }: { id: string; body: string; accent: string; ink: string }) {
  switch (id) {
    case 'mello':
      return <Rect x={18} y={20} width={64} height={70} rx={26} fill={body} stroke={accent} strokeWidth={2.5} />;
    case 'pip':
      return (
        <G>
          <Path d="M20 62 Q8 70 18 80 Q28 74 30 66 Z" fill={accent} />
          <Circle cx={52} cy={56} r={34} fill={body} />
          <Ellipse cx={52} cy={74} rx={20} ry={14} fill="#FFF1DC" />
          <Path d="M30 30 Q40 18 52 22 Q46 26 44 32 Z" fill={accent} />
        </G>
      );
    case 'sage':
      return (
        <G>
          <Polygon points="24,26 34,10 40,28" fill={accent} />
          <Polygon points="76,26 66,10 60,28" fill={accent} />
          <Ellipse cx={50} cy={58} rx={34} ry={36} fill={body} />
          <Ellipse cx={50} cy={74} rx={18} ry={16} fill="#EFEAE0" />
          <Circle cx={38} cy={50} r={12} fill="#FFFFFF" stroke={accent} strokeWidth={2} />
          <Circle cx={62} cy={50} r={12} fill="#FFFFFF" stroke={accent} strokeWidth={2} />
          <Polygon points="50,58 46,64 54,64" fill="#D9A441" />
        </G>
      );
    case 'bruno':
      return (
        <G>
          <Circle cx={24} cy={26} r={11} fill={body} />
          <Circle cx={76} cy={26} r={11} fill={body} />
          <Circle cx={24} cy={26} r={5} fill={ink} opacity={0.35} />
          <Circle cx={76} cy={26} r={5} fill={ink} opacity={0.35} />
          <Circle cx={50} cy={56} r={36} fill={body} />
          <Ellipse cx={50} cy={66} rx={14} ry={10} fill="#E4C7A6" />
          <Ellipse cx={50} cy={61} rx={4.5} ry={3} fill={ink} />
        </G>
      );
    case 'luna':
      return (
        <G>
          <Polygon points="18,34 24,8 42,26" fill={body} />
          <Polygon points="82,34 76,8 58,26" fill={body} />
          <Circle cx={50} cy={56} r={36} fill={body} />
          <Circle cx={74} cy={22} r={5} fill={accent} />
          <Line x1={20} y1={62} x2={34} y2={60} stroke={accent} strokeWidth={1.5} />
          <Line x1={20} y1={68} x2={34} y2={64} stroke={accent} strokeWidth={1.5} />
          <Line x1={80} y1={62} x2={66} y2={60} stroke={accent} strokeWidth={1.5} />
          <Line x1={80} y1={68} x2={66} y2={64} stroke={accent} strokeWidth={1.5} />
        </G>
      );
    default:
      return <Circle cx={50} cy={55} r={36} fill={body} />;
  }
}

function Face({ mood, ink, cheeks }: { mood: Mood; ink: string; cheeks: boolean }) {
  const eyeY = 50;
  const eyes = {
    happy: (
      <G>
        <Circle cx={38} cy={eyeY} r={3.6} fill={ink} />
        <Circle cx={62} cy={eyeY} r={3.6} fill={ink} />
      </G>
    ),
    proud: (
      <G>
        <Path d={`M33 ${eyeY + 1} Q38 ${eyeY - 5} 43 ${eyeY + 1}`} stroke={ink} strokeWidth={2.6} fill="none" strokeLinecap="round" />
        <Path d={`M57 ${eyeY + 1} Q62 ${eyeY - 5} 67 ${eyeY + 1}`} stroke={ink} strokeWidth={2.6} fill="none" strokeLinecap="round" />
      </G>
    ),
    sleepy: (
      <G>
        <Line x1={33} y1={eyeY} x2={43} y2={eyeY} stroke={ink} strokeWidth={2.6} strokeLinecap="round" />
        <Line x1={57} y1={eyeY} x2={67} y2={eyeY} stroke={ink} strokeWidth={2.6} strokeLinecap="round" />
      </G>
    ),
    worried: (
      <G>
        <Circle cx={38} cy={eyeY} r={3.2} fill={ink} />
        <Circle cx={62} cy={eyeY} r={3.2} fill={ink} />
        <Line x1={33} y1={eyeY - 9} x2={42} y2={eyeY - 6} stroke={ink} strokeWidth={2} strokeLinecap="round" />
        <Line x1={67} y1={eyeY - 9} x2={58} y2={eyeY - 6} stroke={ink} strokeWidth={2} strokeLinecap="round" />
      </G>
    ),
    stern: (
      <G>
        <Circle cx={38} cy={eyeY} r={3.2} fill={ink} />
        <Circle cx={62} cy={eyeY} r={3.2} fill={ink} />
        <Line x1={33} y1={eyeY - 6} x2={43} y2={eyeY - 9} stroke={ink} strokeWidth={2.4} strokeLinecap="round" />
        <Line x1={67} y1={eyeY - 6} x2={57} y2={eyeY - 9} stroke={ink} strokeWidth={2.4} strokeLinecap="round" />
      </G>
    ),
  }[mood];
  const mouth = {
    happy: 'M43 66 Q50 72 57 66',
    proud: 'M41 64 Q50 76 59 64',
    sleepy: 'M47 68 Q50 70 53 68',
    worried: 'M43 70 Q50 65 57 70',
    stern: 'M44 68 L56 68',
  }[mood];
  return (
    <G>
      {eyes}
      <Path d={mouth} stroke={ink} strokeWidth={2.6} fill="none" strokeLinecap="round" />
      {cheeks && (mood === 'happy' || mood === 'proud') && (
        <G opacity={0.35}>
          <Ellipse cx={30} cy={60} rx={5} ry={3} fill="#F28C8C" />
          <Ellipse cx={70} cy={60} rx={5} ry={3} fill="#F28C8C" />
        </G>
      )}
    </G>
  );
}

/** Character plus a speech bubble: how the app talks to the user everywhere in self mode. */
export function CharacterSays({ prefs, mood, text, size = 72 }: { prefs: Partial<CharacterPrefs> | null | undefined; mood?: Mood; text: string; size?: number }) {
  const c = characterOf(prefs);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <CharacterArt prefs={prefs} mood={mood} size={size} />
      <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: c.colors.accent, padding: 12, gap: 2 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: c.colors.accent }}>{displayName(prefs)}</Text>
        <Text style={{ fontSize: 16, color: colors.ink }}>{text}</Text>
      </View>
    </View>
  );
}
