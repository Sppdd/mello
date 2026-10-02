import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import { Image } from 'expo-image';
import { characterOf, displayName, Skin, type CharacterPrefs, type Mood, type SkinColors } from '@mello/shared';
import { melloArt, type Frame } from '@/assets/mello';
import { useMelloSpeaking } from '@/lib/voice';
import { colors } from './ui';

type Prefs = Partial<CharacterPrefs> | null | undefined;

/**
 * Mello, alive: breathes, sways, blinks every few seconds, moves its mouth while it talks, and bounces
 * when tapped. Shows the rendered art for the current skin and mood when it has been added
 * (src/assets/mello.ts), otherwise the drawing below. Respects the system's reduce-motion setting.
 */
export function LiveMello({
  prefs,
  mood = 'happy',
  size = 96,
  speaking,
  onPress,
}: {
  prefs: Prefs;
  mood?: Mood;
  size?: number;
  /** Defaults to whether Mello's voice is playing right now. */
  speaking?: boolean;
  onPress?: () => void;
}) {
  const skin = Skin.catch('classic').parse(prefs?.skin ?? 'classic');
  const talkingNow = useMelloSpeaking();
  const talking = speaking ?? talkingNow;
  const reduce = useReducedMotion();
  const [blink, setBlink] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(false);
  const [tapped, setTapped] = useState(false);

  // Idle life: a slow breath, a gentle sway and a tiny bob, out of phase so it never looks mechanical.
  const breath = useSharedValue(1);
  const sway = useSharedValue(0);
  const pop = useSharedValue(1);
  useEffect(() => {
    if (reduce) return;
    breath.value = withRepeat(withSequence(withTiming(1.025, { duration: 1700, easing: Easing.inOut(Easing.sin) }), withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.sin) })), -1);
    sway.value = withRepeat(withSequence(withTiming(1.4, { duration: 2600, easing: Easing.inOut(Easing.sin) }), withTiming(-1.4, { duration: 2600, easing: Easing.inOut(Easing.sin) })), -1, true);
  }, [reduce, breath, sway]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - breath.value) * size * 0.6 }, { rotate: `${sway.value}deg` }, { scaleY: breath.value }, { scale: pop.value }],
  }));

  // Blink every 2.5–6 s, sometimes twice.
  useEffect(() => {
    if (reduce) return;
    let t: ReturnType<typeof setTimeout>;
    const schedule = () => {
      t = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 130);
        if (Math.random() < 0.25) setTimeout(() => (setBlink(true), setTimeout(() => setBlink(false), 120)), 280);
        schedule();
      }, 2500 + Math.random() * 3500);
    };
    schedule();
    return () => clearTimeout(t);
  }, [reduce]);

  // Mouth flaps while the voice plays.
  useEffect(() => {
    if (!talking) return setMouthOpen(false);
    const t = setInterval(() => setMouthOpen((o) => !o), 150);
    return () => clearInterval(t);
  }, [talking]);

  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (tapTimer.current && clearTimeout(tapTimer.current)), []);
  const onTap = () => {
    pop.value = withSequence(withSpring(1.12, { damping: 6, stiffness: 300 }), withSpring(1, { damping: 8 }));
    setTapped(true);
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => setTapped(false), 1200);
    onPress?.();
  };

  const shownMood: Mood = tapped ? 'excited' : mood;
  const frame: Frame = blink && shownMood !== 'sleepy' ? 'blink' : mouthOpen ? 'talk' : shownMood;
  // Rendered art when it exists: the exact frame, else the mood's still; otherwise the drawing.
  const art = melloArt(skin, frame) ?? melloArt(skin, shownMood);
  const body = art ? (
    <Image source={art} style={{ width: size, height: size }} contentFit="contain" />
  ) : (
    <MelloDrawing colors={characterOf(prefs).colors} mood={shownMood} blink={frame === 'blink'} mouthOpen={frame === 'talk'} size={size} />
  );

  return (
    <Pressable onPress={onTap} accessibilityRole="image" accessibilityLabel={`${displayName(prefs)} the tortoise, ${shownMood}${talking ? ', talking' : ''}`}>
      <Animated.View style={[{ width: size, height: size, transformOrigin: 'bottom' }, style]}>
        <Animated.View key={shownMood} entering={reduce ? undefined : FadeIn.duration(180)}>
          {body}
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

/**
 * Drawn Mello, after the character sheet: a wide rounded head with the pale nose-ridge plate, big
 * wide-set eyes, a long gentle smile, a long neck and the domed shell behind. 100×100 viewBox.
 */
export function MelloDrawing({ colors: c, mood, blink = false, mouthOpen = false, size = 96 }: { colors: SkinColors; mood: Mood; blink?: boolean; mouthOpen?: boolean; size?: number }) {
  const eyesClosed = blink || mood === 'content' || mood === 'proud';
  const tilt = mood === 'curious' ? -7 : 0;
  const eye = (cx: number, big = false) =>
    eyesClosed ? (
      <Path key={cx} d={`M${cx - 5} 33 Q${cx} ${mood === 'proud' ? 28 : 36} ${cx + 5} 33`} stroke={c.ink} strokeWidth={2.4} fill="none" strokeLinecap="round" />
    ) : mood === 'sleepy' ? (
      <Path key={cx} d={`M${cx - 5} 33 L${cx + 5} 33`} stroke={c.ink} strokeWidth={2.4} strokeLinecap="round" />
    ) : (
      <G key={cx}>
        <Circle cx={cx} cy={32} r={big ? 6.4 : 5.6} fill={c.ink} />
        <Circle cx={cx + 1.8} cy={30} r={1.8} fill="#FFFFFF" />
      </G>
    );
  const wink = mood === 'cheerful' && !blink;
  const mouth = mouthOpen || mood === 'excited' ? (
    <G>
      <Path d="M34 41 Q50 56 66 41 Q50 47 34 41 Z" fill={c.ink} />
      <Ellipse cx={50} cy={49} rx={6} ry={2.6} fill="#F28C8C" />
    </G>
  ) : (
    <Path
      d={{ worried: 'M36 45 Q50 40 64 45', stern: 'M37 43 L63 43', sleepy: 'M42 43 Q50 46 58 43' }[mood as 'worried' | 'stern' | 'sleepy'] ?? (mood === 'proud' ? 'M32 40 Q50 53 68 40' : 'M33 41 Q50 50 67 41')}
      stroke={c.ink}
      strokeWidth={2.4}
      fill="none"
      strokeLinecap="round"
    />
  );

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* shell behind, legs, neck */}
      <Ellipse cx={50} cy={95} rx={34} ry={3.5} fill={c.ink} opacity={0.12} />
      <Path d="M10 80 Q12 50 50 48 Q88 50 90 80 Z" fill={c.shell} stroke={c.shellLine} strokeWidth={2} />
      <Path d="M24 66 L36 58 L50 62 L64 58 L76 66 M36 58 L38 50 M64 58 L62 50 M50 62 L50 78" stroke={c.shellLine} strokeWidth={1.6} fill="none" />
      <Rect x={22} y={78} width={16} height={16} rx={7} fill={c.skin} stroke={c.ink} strokeWidth={1.4} />
      <Rect x={62} y={78} width={16} height={16} rx={7} fill={c.skin} stroke={c.ink} strokeWidth={1.4} />
      <Path d="M36 46 Q35 70 38 84 L62 84 Q65 70 64 46 Z" fill={c.skin} stroke={c.ink} strokeWidth={1.4} />
      <Path d="M40 60 Q50 64 60 60 M40 68 Q50 72 60 68" stroke={c.ink} strokeWidth={1} opacity={0.35} fill="none" />
      {/* head */}
      <G rotation={tilt} origin="50, 46">
        <Path d="M18 34 Q18 8 50 7 Q82 8 82 34 Q82 52 50 53 Q18 52 18 34 Z" fill={c.skin} stroke={c.ink} strokeWidth={1.6} />
        <Path d="M27 42 Q50 56 73 42 Q66 52 50 53 Q34 52 27 42 Z" fill={c.plate} opacity={0.9} />
        <Path d="M45 14 Q50 12 55 14 L54 34 Q50 37 46 34 Z" fill={c.plate} stroke={c.ink} strokeWidth={0.8} />
        <Circle cx={45} cy={11.5} r={1.7} fill={c.ink} />
        <Circle cx={55} cy={11.5} r={1.7} fill={c.ink} />
        {eye(31, mood === 'curious')}
        {wink ? <Path d="M64 33 Q69 29 74 33" stroke={c.ink} strokeWidth={2.4} fill="none" strokeLinecap="round" /> : eye(69, mood === 'curious')}
        {mood === 'worried' && <Path d="M25 23 L35 25 M75 23 L65 25" stroke={c.ink} strokeWidth={1.8} strokeLinecap="round" />}
        {mood === 'stern' && <Path d="M25 25 L35 23 M75 25 L65 23" stroke={c.ink} strokeWidth={1.8} strokeLinecap="round" />}
        {mood === 'focused' && (
          <G stroke={c.ink} strokeWidth={1.6} fill="none">
            <Circle cx={31} cy={32} r={9} />
            <Circle cx={69} cy={32} r={9} />
            <Path d="M40 32 Q50 28 60 32" />
          </G>
        )}
        {mouth}
      </G>
    </Svg>
  );
}

/** Kept for existing screens: Mello at a size, alive. */
export function CharacterArt(props: { prefs: Prefs; mood?: Mood; size?: number }) {
  return <LiveMello {...props} />;
}

/** Mello plus a speech bubble: how the app talks to the user. */
export function CharacterSays({ prefs, mood, text, size = 72 }: { prefs: Prefs; mood?: Mood; text: string; size?: number }) {
  const c = characterOf(prefs);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <LiveMello prefs={prefs} mood={mood} size={size} />
      <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: c.colors.accent, padding: 12, gap: 2 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: c.colors.accent }}>{displayName(prefs)}</Text>
        <Text style={{ fontSize: 16, color: colors.ink }}>{text}</Text>
      </View>
    </View>
  );
}
