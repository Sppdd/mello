import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import type { AppCategory, UsageDay } from '@mello/shared';
import { selfApi } from '@/lib/api';
import { cachedConfig } from '@/lib/kid';
import { buildUsageDay } from '@/lib/self';
import { CharacterSays } from '@/components/Character';
import { Card, colors, ErrorText, Label, Muted, Screen } from '@/components/ui';

const CATEGORIES: { key: AppCategory; label: string; color: string }[] = [
  { key: 'social', label: 'Social', color: '#E26D5C' },
  { key: 'video', label: 'Video', color: '#E8A33A' },
  { key: 'game', label: 'Games', color: '#9B6BD6' },
  { key: 'reading', label: 'Reading', color: '#3E8E6A' },
  { key: 'audio', label: 'Listening', color: '#3A7BD5' },
  { key: 'other', label: 'Other', color: '#9CA3AF' },
];

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Today next to your 7-day average, per category, plus the apps you open most. All computed from daily totals. */
export default function Insights() {
  const config = useMemo(() => cachedConfig(), []);
  const prefs = config?.kid.settings.character;
  const [today, setToday] = useState<UsageDay | null>(null);
  const [past, setPast] = useState<UsageDay[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (config) buildUsageDay(config).then(setToday).catch(setError);
    selfApi()
      .usage(8)
      .then((r) => setPast(r.days))
      .catch(setError);
  }, [config]);

  // Server days include today's partial upload; compare against the days before it.
  const before = past.filter((d) => d.day !== today?.day).slice(0, 7);
  const avgOf = (k: AppCategory) => avg(before.map((d) => d.categories[k] ?? 0));
  const max = Math.max(1, ...CATEGORIES.flatMap((c) => [today?.categories[c.key] ?? 0, avgOf(c.key)]));

  return (
    <Screen>
      <CharacterSays prefs={prefs} mood="happy" text={observation(today, before)} />
      <ErrorText error={error} />

      <Card>
        <Label>Today vs your usual</Label>
        {CATEGORIES.map((c) => {
          const t = today?.categories[c.key] ?? 0;
          const a = Math.round(avgOf(c.key));
          if (!t && !a) return null;
          return (
            <View key={c.key} style={{ gap: 4 }}>
              <Text style={{ color: colors.ink }}>
                {c.label}: {t} min <Text style={{ color: colors.muted }}>(usually {a})</Text>
              </Text>
              <View style={{ height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden' }}>
                <View style={{ width: `${(t / max) * 100}%`, height: 10, backgroundColor: c.color }} />
              </View>
              <View style={{ height: 4, width: `${(a / max) * 100}%`, backgroundColor: colors.muted, borderRadius: 2 }} />
            </View>
          );
        })}
        {!today && <Muted>Loading…</Muted>}
      </Card>

      <Card>
        <Label>Most opened today</Label>
        {(today?.apps ?? [])
          .slice()
          .sort((a, b) => b.opens - a.opens)
          .slice(0, 5)
          .map((a) => (
            <Text key={a.packageName} style={{ color: colors.ink, fontSize: 16 }}>
              {a.label}: opened {a.opens}×, {a.minutes} min
            </Text>
          ))}
        {today && <Muted>Phone unlocked {today.unlocks} times. {today.focusMinutes} min in focus.</Muted>}
      </Card>

      <Card>
        <Label>Last 7 days</Label>
        {before.map((d) => (
          <Text key={d.day} style={{ color: colors.ink }}>
            {d.day}: social {d.categories.social ?? 0}m · reading {d.categories.reading ?? 0}m · listening {d.categories.audio ?? 0}m · focus {d.focusMinutes}m
            {d.guardOn < 0.9 ? ' · guard off part of the day' : ''}
          </Text>
        ))}
        {before.length === 0 && <Muted>Come back tomorrow: I need a day or two to see your usual.</Muted>}
      </Card>
      <Muted>Only these daily totals are stored, for 30 days. Delete them from Sign out → Delete my history.</Muted>
    </Screen>
  );
}

/** One plain observation, no AI needed: the biggest change against the usual. */
function observation(today: UsageDay | null, before: UsageDay[]): string {
  if (!today) return 'Let me look…';
  if (before.length < 2) return `So far today: ${today.categories.social ?? 0} min social, ${(today.categories.reading ?? 0) + (today.categories.audio ?? 0)} min reading and listening.`;
  const usual = (k: AppCategory) => avg(before.map((d) => d.categories[k] ?? 0));
  const social = today.categories.social ?? 0;
  const good = (today.categories.reading ?? 0) + (today.categories.audio ?? 0) + today.focusMinutes;
  const usualGood = usual('reading') + usual('audio') + avg(before.map((d) => d.focusMinutes));
  if (good > usualGood + 5) return `You've already read or listened ${Math.round(good)} min today, more than usual. Lovely.`;
  if (social > usual('social') * 1.3 && social > 20) return `Social is at ${social} min, above your usual ${Math.round(usual('social'))}. Maybe a short focus break?`;
  if (social < usual('social') * 0.7) return `Social is well under your usual today (${social} vs ${Math.round(usual('social'))} min). Nice.`;
  return `A pretty usual day so far: ${social} min social, ${good} min reading, listening and focus.`;
}
