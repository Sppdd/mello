import { Pressable, Switch, Text, View } from 'react-native';
import { SKIN_LIST, type CharacterPrefs, type Tone } from '@mello/shared';
import { LiveMello } from './Character';
import { Chip, colors, Field, Label, Muted } from './ui';

const TONES: { tone: Tone; label: string }[] = [
  { tone: 'gentle', label: 'Gentle' },
  { tone: 'balanced', label: 'Balanced' },
  { tone: 'firm', label: 'Firm' },
];

/** Make Mello yours: a colour skin, a nickname, how it talks, and its voice. */
export function CharacterPicker({ value, onChange, showTone = true }: { value: CharacterPrefs; onChange: (v: CharacterPrefs) => void; showTone?: boolean }) {
  return (
    <View style={{ gap: 12 }}>
      <View style={{ alignItems: 'center' }}>
        <LiveMello prefs={value} mood="happy" size={150} />
      </View>
      <Label>Colour</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {SKIN_LIST.map((s) => {
          const selected = value.skin === s.id;
          return (
            <Pressable
              key={s.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${s.name} skin`}
              onPress={() => onChange({ ...value, skin: s.id })}
              style={{ alignItems: 'center', gap: 4, padding: 6, borderRadius: 14, borderWidth: 2, borderColor: selected ? s.colors.accent : colors.border, backgroundColor: colors.card }}
            >
              <View style={{ flexDirection: 'row' }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: s.colors.shell }} />
                <View style={{ width: 22, height: 22, borderRadius: 11, marginLeft: -6, backgroundColor: s.colors.skin, borderWidth: 2, borderColor: colors.card }} />
              </View>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink }}>{s.name}</Text>
            </Pressable>
          );
        })}
      </View>
      <Field label="Give Mello a nickname (optional)" value={value.nickname ?? ''} onChangeText={(t) => onChange({ ...value, nickname: t.trim() ? t.slice(0, 24) : null })} placeholder="Mello" />
      {showTone && (
        <>
          <Label>How should Mello talk to you?</Label>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {TONES.map((t) => (
              <Chip key={t.tone} label={t.label} selected={value.tone === t.tone} onPress={() => onChange({ ...value, tone: t.tone })} />
            ))}
          </View>
        </>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Muted>Talk out loud</Muted>
        <Switch value={value.voiceOn} onValueChange={(voiceOn) => onChange({ ...value, voiceOn })} />
      </View>
    </View>
  );
}
