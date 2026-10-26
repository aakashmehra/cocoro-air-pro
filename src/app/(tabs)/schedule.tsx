import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { client, type Connection } from '../../api/client';
import { useSession } from '../../session';
import { lastRuns } from '../../shortcuts';
import { describeDays, describeSchedule, describeSettings, presets, schedules, type Schedule, type Settings } from '../../store';
import { Chip, Glass, GlassButton, NumberedSteps, Sheet, T, Toggle, errText, sp, tap, toast, useTheme } from '../../ui';

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const two = (n: number) => String(n).padStart(2, '0');
const toTime = (d: Date) => `${two(d.getHours())}:${two(d.getMinutes())}`;
const fromTime = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
};

function guideSteps(s: Schedule) {
  return [
    'Open the Shortcuts app and tap Automation.',
    'Tap the plus button and choose Time of Day.',
    `Set the time to ${s.time}, choose Daily, then select Run Immediately and tap Next.`,
    'Choose New Blank Automation, tap Add Action, and search for Run air conditioner action.',
    `Tap Action in that step, pick "Schedule: ${describeSchedule(s)}", then tap Done.`,
  ];
}

export default function ScheduleTab() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { devices, deviceId } = useSession();
  const device = devices.find((d) => d.id === (deviceId ?? devices[0]?.id));
  const all = schedules.use();
  const list = all.filter((s) => s.deviceId === device?.id).sort((a, b) => a.time.localeCompare(b.time));
  const favorites = presets(device?.id ?? '-').use();

  const [via, setVia] = useState<Connection>('local');
  const [runs, setRuns] = useState<Record<string, string>>({});
  useFocusEffect(useCallback(() => {
    client.connection().then(setVia, () => {});
    setRuns(lastRuns());
  }, []));

  // Editor
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [choice, setChoice] = useState<string>('current'); // 'current' | 'power' | favorite id
  const [saving, setSaving] = useState(false);
  const [guide, setGuide] = useState<Schedule | null>(null);

  const save = (next: Schedule[]) => schedules.set(next).catch(() => toast("Couldn't save schedules on this device."));

  function startNew() {
    if (!device) return;
    setIsNew(true);
    setChoice('current');
    setEditing({ id: String(Date.now()), deviceId: device.id, time: '07:00', days: [1, 2, 3, 4, 5], action: 'on', enabled: true, linked: false });
  }

  function startEdit(s: Schedule) {
    setIsNew(false);
    setChoice(s.action === 'off' ? 'current' : s.settings ? 'keep' : 'power');
    setEditing(s);
  }

  async function commit() {
    if (!editing || !device) return;
    if (!editing.days.length) return toast('Pick at least one day.');
    setSaving(true);
    try {
      let settings: Settings | undefined = editing.settings;
      if (editing.action === 'off' || choice === 'power') settings = undefined;
      else if (choice === 'current') {
        const { mode, targetTemp, fan, louverV, louverH, specials } = await client.getState(device.id);
        settings = { mode, targetTemp, fan, louverV, louverH, specials };
      } else if (choice !== 'keep') {
        const fav = favorites.find((f) => f.id === choice);
        if (fav) settings = { mode: fav.mode, targetTemp: fav.targetTemp, fan: fav.fan, louverV: fav.louverV, louverH: fav.louverH, specials: fav.specials };
      }
      const prev = all.find((x) => x.id === editing.id);
      // Changing the time means the Shortcuts automation needs the new time too.
      const next: Schedule = { ...editing, settings, linked: !!prev?.linked && prev.time === editing.time };
      await save(prev ? all.map((x) => (x.id === next.id ? next : x)) : [...all, next]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditing(null);
      if (!next.linked) setTimeout(() => setGuide(next), 350); // after the editor sheet closes
    } catch (e) {
      toast(`Couldn't save. ${errText(e)}`);
    } finally {
      setSaving(false);
    }
  }

  function remove(s: Schedule) {
    Alert.alert('Delete schedule?', 'Also delete its automation in the Shortcuts app, or it will show an error at that time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { save(all.filter((x) => x.id !== s.id)); setEditing(null); } },
    ]);
  }

  const toggleDay = (d: number) => editing && setEditing({
    ...editing,
    days: editing.days.includes(d) ? editing.days.filter((x) => x !== d) : [...editing.days, d],
  });

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: sp.m, paddingTop: insets.top + sp.m, gap: sp.m }}>
        <View style={{ marginBottom: sp.s }}>
          <T weight="bold" size={34} numberOfLines={1}>Schedule</T>
          <T muted numberOfLines={1}>{devices.length > 1 && device ? device.name : 'Turn on and off at set times'}</T>
        </View>

        {via === 'cloud' ? (
          <Glass style={{ padding: sp.m, gap: sp.xs }}>
            <T weight="semibold">Timers run on your Sharp account</T>
            <T muted size={14} style={{ lineHeight: 20 }}>Use Timers on the Controls tab. They keep running even when this iPhone is off.</T>
          </Glass>
        ) : !device ? (
          <T muted>Connect an air conditioner first.</T>
        ) : (
          <>
            <GlassButton label="New schedule" icon="plus" size={52} tint={t.mode.cool} color="#FFFFFF" onPress={startNew} />

            {list.length === 0 && (
              <Glass style={{ padding: sp.m, gap: sp.s }}>
                <T weight="semibold">How schedules work</T>
                <T muted size={14} style={{ lineHeight: 20 }}>
                  Your air conditioner has no built-in timer over Wi‑Fi, so this iPhone runs schedules with the Shortcuts app.
                  After you create one, a one-time step in Shortcuts makes it run at that time every day, even with this app closed.
                  This iPhone needs to be on your home Wi‑Fi at that time.
                </T>
              </Glass>
            )}

            {list.map((s) => {
              const ran = runs[`sched:${s.id}`];
              const color = s.action === 'off' ? t.muted : t.mode[s.settings?.mode ?? 'cool'];
              return (
                <Pressable key={s.id} onPress={() => { tap(); startEdit(s); }} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
                  <Glass interactive style={{ padding: sp.m, gap: sp.s }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.m }}>
                      <View style={{ flex: 1 }}>
                        <T weight="semibold" size={34} tabular color={s.enabled ? t.text : t.muted}>{s.time}</T>
                        <T muted size={14} numberOfLines={1}>
                          {describeDays(s.days)} · {s.action === 'off' ? 'Turn off' : describeSettings(s.settings)}
                        </T>
                      </View>
                      <Toggle
                        value={s.enabled}
                        accent={color}
                        label={`Schedule at ${s.time}`}
                        onChange={(v) => save(all.map((x) => (x.id === s.id ? { ...x, enabled: v } : x)))}
                      />
                    </View>
                    {s.linked ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.s }}>
                        <SymbolView name="checkmark.circle" size={14} tintColor={t.mode.dry} />
                        <T muted size={13}>{ran ? `Last ran ${new Date(ran).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Set up in Shortcuts, waiting for its first run'}</T>
                      </View>
                    ) : (
                      <Pressable onPress={() => setGuide(s)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: sp.s, minHeight: 28 }}>
                        <SymbolView name="exclamationmark.circle" size={14} tintColor={t.mode.heat} />
                        <T size={13} weight="medium" color={t.mode.heat}>Finish setup in Shortcuts</T>
                      </Pressable>
                    )}
                  </Glass>
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>

      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={isNew ? 'New schedule' : 'Edit schedule'}>
        {editing && (
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: sp.l }}>
            <View style={{ alignItems: 'center' }}>
              <DateTimePicker
                value={fromTime(editing.time)}
                mode="time"
                display="spinner"
                themeVariant={t.dark ? 'dark' : 'light'}
                onChange={(_, d) => d && setEditing({ ...editing, time: toTime(d) })}
                style={{ height: 160 }}
              />
            </View>

            <View style={{ gap: sp.s }}>
              <T weight="semibold">Repeat</T>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                {DAY_LETTERS.map((letter, d) => {
                  const on = editing.days.includes(d);
                  return (
                    <Pressable
                      key={d}
                      onPress={() => { tap(); toggleDay(d); }}
                      accessibilityRole="button"
                      accessibilityLabel={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]}
                      accessibilityState={{ selected: on }}
                      style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.mode.cool : t.track }}
                    >
                      <T weight="semibold" size={14} color={on ? '#FFFFFF' : t.muted}>{letter}</T>
                    </Pressable>
                  );
                })}
              </View>
              <T muted size={13}>{editing.days.length ? describeDays(editing.days) : 'Pick at least one day'}</T>
            </View>

            <View style={{ gap: sp.s }}>
              <T weight="semibold">Action</T>
              <View style={{ flexDirection: 'row', gap: sp.s }}>
                <Chip label="Turn on" active={editing.action === 'on'} accent={t.mode.cool} onPress={() => setEditing({ ...editing, action: 'on' })} />
                <Chip label="Turn off" active={editing.action === 'off'} accent={t.mode.cool} onPress={() => setEditing({ ...editing, action: 'off' })} />
              </View>
            </View>

            {editing.action === 'on' && (
              <View style={{ gap: sp.s }}>
                <T weight="semibold">Settings</T>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.s }}>
                  {!isNew && editing.settings && (
                    <Chip label={`Keep: ${describeSettings(editing.settings)}`} active={choice === 'keep'} accent={t.mode.cool} onPress={() => setChoice('keep')} />
                  )}
                  <Chip label="Current settings" active={choice === 'current'} accent={t.mode.cool} onPress={() => setChoice('current')} />
                  <Chip label="Just turn on" active={choice === 'power'} accent={t.mode.cool} onPress={() => setChoice('power')} />
                  {favorites.map((f) => (
                    <Chip key={f.id} label={f.name} active={choice === f.id} accent={t.mode.cool} onPress={() => setChoice(f.id)} />
                  ))}
                </ScrollView>
              </View>
            )}

            <View style={{ height: 52, justifyContent: 'center' }}>
              {saving
                ? <ActivityIndicator color={t.text} />
                : <GlassButton label="Save" icon="checkmark" size={52} tint={t.mode.cool} color="#FFFFFF" onPress={commit} />}
            </View>
            {!isNew && (
              <GlassButton label="Delete schedule" icon="trash" size={44} color={t.mode.heat} onPress={() => remove(editing)} />
            )}
          </ScrollView>
        )}
      </Sheet>

      <Sheet visible={!!guide} onClose={() => setGuide(null)} title="Finish in Shortcuts">
        {guide && (
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: sp.l }}>
            <T muted size={14} style={{ lineHeight: 20 }}>
              One time only. After this, the schedule runs by itself at {guide.time}. Days and the on/off switch are handled
              here, so you only need to come back to Shortcuts if you change the time.
            </T>
            <NumberedSteps items={guideSteps(guide)} />
            <GlassButton label="Open Shortcuts" icon="arrow.up.forward.app" size={52} tint={t.mode.cool} color="#FFFFFF" onPress={() => Linking.openURL('shortcuts://')} />
            <GlassButton
              label="I've added it"
              icon="checkmark"
              size={44}
              onPress={() => {
                save(all.map((x) => (x.id === guide.id ? { ...x, linked: true } : x)));
                setGuide(null);
              }}
            />
          </ScrollView>
        )}
      </Sheet>
    </View>
  );
}
