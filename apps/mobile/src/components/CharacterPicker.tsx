import { Pressable, Switch, Text, View } from 'react-native';
import { CHARACTER_LIST, type CharacterId, type CharacterPrefs, type Tone } from '@mello/shared';
import { CharacterArt } from './Character';
import { Chip, colors, Field, Label, Muted } from './ui';

const TONES: { tone: Tone; label: string }[] = [
  { tone: 'gentle', label: 'Gentle' },
  { tone: 'balanced', label: 'Balanced' },
  { tone: 'firm', label: 'Firm' },
];

/** Pick a character and make it yours: nickname, tone, voice. `allowed` limits the choice (kids). */
export function CharacterPicker({
  value,
  onChange,
  allowed,
  showTone = true,
}: {
  value: CharacterPrefs;
  onChange: (v: CharacterPrefs) => void;
  allowed?: CharacterId[];
  showTone?: boolean;
}) {
  const list = CHARACTER_LIST.filter((c) => !allowed?.length || allowed.includes(c.id));
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {list.map((c) => {
          const selected = value.characterId === c.id;
          return (
            <Pressable
              key={c.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange({ ...value, characterId: c.id, nickname: null })}
              style={{
                width: '47%',
                padding: 10,
                borderRadius: 14,
                borderWidth: 2,
                borderColor: selected ? c.colors.accent : colors.border,
                backgroundColor: colors.card,
                alignItems: 'center',
                gap: 4,
              }}
            >
              <CharacterArt prefs={{ characterId: c.id }} mood={selected ? 'proud' : 'happy'} size={72} />
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{c.name}</Text>
              <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center' }}>{c.tagline}</Text>
            </Pressable>
          );
        })}
      </View>
      <Field
        label="Give them a name (optional)"
        value={value.nickname ?? ''}
        onChangeText={(t) => onChange({ ...value, nickname: t.trim() ? t.slice(0, 24) : null })}
        placeholder={CHARACTER_LIST.find((c) => c.id === value.characterId)?.name}
      />
      {showTone && (
        <>
          <Label>How should they talk to you?</Label>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {TONES.map((t) => (
              <Chip key={t.tone} label={t.label} selected={value.tone === t.tone} onPress={() => onChange({ ...value, tone: t.tone })} />
            ))}
          </View>
        </>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Muted>Read messages out loud</Muted>
        <Switch value={value.voiceOn} onValueChange={(voiceOn) => onChange({ ...value, voiceOn })} />
      </View>
    </View>
  );
}
