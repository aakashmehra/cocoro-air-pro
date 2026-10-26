import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Platform, Pressable, RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { client } from './api/client';
import type { AcState, Mode, TimerKind } from './api/types';
import { AcArt, FanSpinner, PowerGlyph, louverAngle, usePop } from './Art';
import { Dial, RollingNumber } from './Dial';
import { useSession } from './session';
import {
  Chip, Glass, GlassButton, Row, Section, Sheet, Skeleton, T, Toggle, errText, fmtMin, fmtTemp, sp, tap, toast, useTheme,
} from './ui';

export const modeInfo: Record<Mode, { label: string; verb: string; icon: SFSymbol }> = {
  auto: { label: 'Auto', verb: 'Auto', icon: 'arrow.triangle.2.circlepath' },
  cool: { label: 'Cool', verb: 'Cooling to', icon: 'snowflake' },
  heat: { label: 'Heat', verb: 'Heating to', icon: 'sun.max' },
  dry: { label: 'Dry', verb: 'Drying at', icon: 'drop' },
  fan: { label: 'Fan', verb: 'Fan only', icon: 'fan' },
};
const timerInfo: Record<TimerKind, { label: string; status: string; icon: SFSymbol }> = {
  on: { label: 'On timer', status: 'On in', icon: 'power' },
  off: { label: 'Off timer', status: 'Off in', icon: 'power.dotted' },
  sleep: { label: 'Sleep timer', status: 'Sleep', icon: 'moon.zzz' },
};
const timerKey = { on: 'onTimerMin', off: 'offTimerMin', sleep: 'sleepTimerMin' } as const;
const timerHours = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 10, 12];
// Sharp's cloud needs a sleep window of at least 3 hours.
const sleepHours = [3, 4, 5, 6, 7, 8, 9, 10];

import { presets as presetStore, type Preset } from './store';

/** Text prompt; Alert.prompt is iOS-only, so other platforms keep the suggested name. */
export function ask(title: string, initial: string, done: (v: string) => void) {
  if (Platform.OS !== 'ios') return done(initial);
  Alert.prompt(title, undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Save', onPress: (v?: string) => v?.trim() && done(v.trim().slice(0, 40)) },
  ], 'plain-text', initial);
}

/** Controls for one air conditioner. `onSwitch` shows a button to pick another unit. */
export function Control({ id, onSwitch }: { id: string; onSwitch?: () => void }) {
  const device = useSession().devices.find((d) => d.id === id);
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [s, setS] = useState<AcState | null>(null);
  const [online, setOnline] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sheet, setSheet] = useState<'info' | 'timers' | null>(null);
  const [starStyle, popStar] = usePop();

  // Every local edit bumps `edits`. A server snapshot is applied only if no edit happened since its
  // request started and nothing is still pending, so polls never overwrite what the user just changed.
  const edits = useRef(0);
  const inflight = useRef(0);
  const busy = useRef(new Set<string>()); // command keys currently sending
  const queued = useRef(new Map<string, () => void>()); // latest pending command per busy key
  const tempTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const accept = (next: AcState, gen: number) => {
    setOnline(true);
    setUpdatedAt(new Date());
    if (gen === edits.current && inflight.current === 0 && !tempTimer.current) setS(next);
  };

  const refresh = useCallback(async () => {
    const gen = edits.current;
    try { accept(await client.getState(id), gen); } catch { setOnline(false); }
  }, [id]);

  useFocusEffect(useCallback(() => {
    refresh();
    const iv = setInterval(refresh, 15000);
    return () => clearInterval(iv);
  }, [refresh]));

  useEffect(() => () => { if (tempTimer.current) clearTimeout(tempTimer.current); }, []);

  /** Timer commands: one per kind at a time; a newer choice made meanwhile is sent next (latest wins). */
  function run(key: string, call: () => Promise<AcState>, optimistic: (cur: AcState) => AcState) {
    const gen = ++edits.current;
    setS((cur) => cur && optimistic(cur));
    if (busy.current.has(key)) {
      queued.current.set(key, () => run(key, call, optimistic));
      return;
    }
    busy.current.add(key);
    send(call, gen).finally(() => {
      busy.current.delete(key);
      const next = queued.current.get(key);
      queued.current.delete(key);
      next?.();
    });
  }

  function send(call: () => Promise<AcState>, gen: number) {
    inflight.current++;
    return call()
      .then((next) => { inflight.current--; accept(next, gen); })
      .catch((e) => {
        inflight.current--;
        setOnline(false);
        toast(`Couldn't update the air conditioner. ${errText(e)}`);
        refresh(); // restore what the unit really has
      });
  }

  // State changes go out one at a time (the unit rejects overlapping commands). Changes made while
  // one is sending show immediately and are merged into a single follow-up command.
  const pending = useRef<Partial<AcState> | null>(null);
  const sending = useRef(false);
  const merge = (a: Partial<AcState> | null, b: Partial<AcState>): Partial<AcState> => ({
    ...a, ...b, ...((a?.specials || b.specials) && { specials: { ...a?.specials, ...b.specials } }),
  });

  function update(patch: Partial<AcState>) {
    edits.current++;
    setS((cur) => cur && { ...cur, ...patch, specials: { ...cur.specials, ...patch.specials } });
    pending.current = merge(pending.current, patch);
    flush();
  }

  function flush() {
    const patch = pending.current;
    if (sending.current || !patch) return;
    pending.current = null;
    sending.current = true;
    send(() => client.setState(id, patch), ++edits.current).finally(() => {
      sending.current = false;
      flush();
    });
  }

  function setTemp(v: number) {
    edits.current++;
    setS((cur) => cur && { ...cur, targetTemp: v });
    if (tempTimer.current) clearTimeout(tempTimer.current);
    tempTimer.current = setTimeout(() => {
      tempTimer.current = null;
      update({ targetTemp: v }); // latest value always wins
    }, 600);
  }

  // Favorites (shared with the Favorites tab)
  const store = presetStore(id);
  const presets = store.use();
  const savePresets = (list: Preset[]) => store.set(list).catch(() => toast("Couldn't save favorites on this device."));

  if (!device) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: sp.m, padding: sp.l }}>
        <T muted style={{ textAlign: 'center' }}>This air conditioner is no longer available.</T>
        {onSwitch && <GlassButton label="Choose another" onPress={onSwitch} />}
      </View>
    );
  }
  const caps = device.caps;
  const range = s ? caps.tempRange[s.mode] : null;
  const accent = s?.power ? t.mode[s.mode] : t.faint;
  const dialSize = Math.min(width - sp.l * 2, 320);
  const fanLevels = caps.fanLevels.filter((f) => f.id !== 'auto');
  const fanIdx = s ? fanLevels.findIndex((f) => f.id === s.fan) : -1;
  const fanSpeed = !s?.power ? 0 : fanIdx < 0 ? 0.5 : (fanIdx + 1) / fanLevels.length;

  function setMode(mode: Mode) {
    const r = caps.tempRange[mode];
    const patch: Partial<AcState> = { mode };
    if (r && s) patch.targetTemp = Math.min(r.max, Math.max(r.min, s.targetTemp));
    update(patch);
  }

  function savePreset() {
    if (!s) return;
    ask('Save favorite', `${modeInfo[s.mode].label}${range ? ` ${s.targetTemp}°` : ''}`, (name) => {
      const { mode, targetTemp, fan, louverV, louverH, specials } = s;
      savePresets([...presets, { id: String(Date.now()), name, mode, targetTemp, fan, louverV, louverH, specials }]);
      popStar();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
  }

  function applyPreset(p: Preset) {
    if (tempTimer.current) { clearTimeout(tempTimer.current); tempTimer.current = null; }
    const { id: _id, name: _name, ...state } = p;
    update({ power: true, ...state });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function editPreset(p: Preset) {
    Alert.alert(p.name, undefined, [
      ...(Platform.OS === 'ios'
        ? [{ text: 'Rename', onPress: () => ask('Rename favorite', p.name, (name) => savePresets(presets.map((x) => (x.id === p.id ? { ...x, name } : x)))) }]
        : []),
      { text: 'Delete', style: 'destructive', onPress: () => savePresets(presets.filter((x) => x.id !== p.id)) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const timerKinds = (Object.keys(timerInfo) as TimerKind[]).filter((k) => caps.timers[k]);
  const activeTimers = s ? timerKinds.filter((k) => s[timerKey[k]] != null) : [];
  const off = !s?.power;

  return (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top + sp.s, paddingHorizontal: sp.m, paddingBottom: sp.s, flexDirection: 'row', alignItems: 'center', gap: sp.m }}>
        {onSwitch
          ? <GlassButton icon="chevron.up.chevron.down" accessibilityLabel="Switch air conditioner" onPress={onSwitch} />
          : <View style={{ width: 44 }} />}
        <View style={{ flex: 1, alignItems: 'center' }}>
          <T weight="semibold" size={17} numberOfLines={1}>{device.name}</T>
          <T muted size={12} numberOfLines={1}>
            {!s ? 'Connecting' : online ? (s.power ? 'On' : 'Off') : 'Offline'}{device.room ? ` · ${device.room}` : ''}
          </T>
        </View>
        <GlassButton icon="info" accessibilityLabel="Device info" onPress={() => setSheet('info')} />
      </View>

      <ScrollView
        scrollEnabled={!dragging}
        contentInsetAdjustmentBehavior="automatic" // clears the tab bar
        contentContainerStyle={{ paddingHorizontal: sp.m, paddingTop: sp.s, paddingBottom: sp.xl, gap: sp.l }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={t.muted} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false); }} />}
      >
        {/* Hero: dial + power. Same footprint while loading so nothing shifts. */}
        <View style={{ alignItems: 'center' }}>
          <View style={{ opacity: s?.power ? 1 : 0.55 }}>
            <Dial
              size={dialSize}
              value={s?.targetTemp ?? 0}
              min={range?.min ?? 0}
              max={range?.max ?? 1}
              step={range?.step ?? 1}
              color={accent}
              disabled={!range || off}
              onChange={setTemp}
              onDragging={setDragging}
            >
              <T muted size={15} weight="medium" numberOfLines={1}>{!s ? ' ' : s.power ? modeInfo[s.mode].verb : 'Off'}</T>
              {s && range ? (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <RollingNumber value={s.targetTemp} size={Math.round(dialSize * 0.24)} />
                  <T weight="medium" size={22} muted maxFontSizeMultiplier={1} style={{ marginTop: dialSize * 0.06 }}>°C</T>
                </View>
              ) : (
                <View style={{ height: Math.round(dialSize * 0.24) * 1.25, justifyContent: 'center' }}>
                  {s ? <SymbolView name={modeInfo[s.mode].icon} size={dialSize * 0.18} tintColor={accent} /> : <T size={dialSize * 0.2} muted>–</T>}
                </View>
              )}
              <T muted size={14} tabular numberOfLines={1}>Room {fmtTemp(s?.roomTemp)}</T>
            </Dial>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.m, marginTop: -sp.l }}>
            <GlassButton
              icon="minus" size={52} accessibilityLabel="Lower temperature" disabled={!s || !range || off}
              onPress={() => s && range && setTemp(Math.max(range.min, s.targetTemp - range.step))}
            />
            <GlassButton
              size={72} accessibilityLabel={s?.power ? 'Turn off' : 'Turn on'} disabled={!s}
              tint={s?.power ? t.mode[s.mode] : undefined}
              onPress={() => {
                if (s) { update({ power: !s.power }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }
              }}
            >
              <PowerGlyph on={!!s?.power} color={s?.power ? '#FFFFFF' : t.text} size={30} />
            </GlassButton>
            <GlassButton
              icon="plus" size={52} accessibilityLabel="Raise temperature" disabled={!s || !range || off}
              onPress={() => s && range && setTemp(Math.min(range.max, s.targetTemp + range.step))}
            />
          </View>
        </View>

        {/* Readouts */}
        <View style={{ flexDirection: 'row', gap: sp.s }}>
          {([
            ['thermometer.medium', 'Room', fmtTemp(s?.roomTemp)],
            // Humidity needs the unit's sensor; outdoor temp is only reported over home Wi‑Fi.
            ...(caps.humidity ? [['humidity', 'Humidity', s?.humidity == null ? '–' : `${s.humidity}%`] as const] : []),
            ...(caps.outdoor ? [['cloud.sun', 'Outdoor', fmtTemp(s?.outdoorTemp)] as const] : []),
          ] as const).map(([icon, name, value]) => (
            <Glass key={name} style={{ flex: 1, padding: sp.m, gap: sp.s }}>
              <SymbolView name={icon} size={16} tintColor={t.muted} />
              <T weight="semibold" size={20} tabular numberOfLines={1} adjustsFontSizeToFit>{value}</T>
              <T muted size={12} numberOfLines={1}>{name}</T>
            </Glass>
          ))}
        </View>

        {!s ? (
          <View style={{ gap: sp.l }}>
            <Skeleton height={72} />
            <Skeleton height={180} />
            <Skeleton height={120} />
          </View>
        ) : (
          <>
            {/* Favorites */}
            <Section
              title="Favorites"
              right={
                <Animated.View style={starStyle}>
                  <GlassButton icon="star" size={32} accessibilityLabel="Save current setting as a favorite" onPress={savePreset} />
                </Animated.View>
              }
            >
              {presets.length === 0 ? (
                <T muted size={14} style={{ paddingHorizontal: sp.xs }}>Tap the star to save the current setting. Long-press a favorite to rename or delete it.</T>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -sp.m }} contentContainerStyle={{ gap: sp.s, paddingHorizontal: sp.m }}>
                  {presets.map((p) => (
                    <Chip key={p.id} label={p.name} onPress={() => applyPreset(p)} onLongPress={() => editPreset(p)} />
                  ))}
                </ScrollView>
              )}
            </Section>

            {/* Mode */}
            <Section title="Mode">
              <Glass style={{ flexDirection: 'row', padding: sp.xs }}>
                {caps.modes.map((m) => {
                  const on = s.mode === m;
                  return (
                    <Pressable
                      key={m}
                      onPress={() => { tap(); setMode(m); }}
                      accessibilityRole="button"
                      accessibilityLabel={modeInfo[m].label}
                      accessibilityState={{ selected: on }}
                      style={{ flex: 1, alignItems: 'center', paddingVertical: sp.s + sp.xs, gap: sp.xs, borderRadius: 20, backgroundColor: on ? t.mode[m] : 'transparent' }}
                    >
                      <SymbolView name={modeInfo[m].icon} size={20} tintColor={on ? '#FFFFFF' : t.muted} />
                      <T size={13} weight={on ? 'semibold' : 'medium'} color={on ? '#FFFFFF' : t.muted} numberOfLines={1} maxFontSizeMultiplier={1.15}>{modeInfo[m].label}</T>
                    </Pressable>
                  );
                })}
              </Glass>
            </Section>

            <Section title="Fan speed" right={<FanSpinner speed={fanSpeed} color={s.power ? accent : t.faint} />}>
              <ChipRow>
                {caps.fanLevels.map((f) => (
                  <Chip key={f.id} label={f.label} active={s.fan === f.id} accent={t.mode[s.mode]} onPress={() => update({ fan: f.id })} />
                ))}
              </ChipRow>
            </Section>

            <Section title="Vertical airflow">
              <Glass style={{ paddingVertical: sp.s, alignItems: 'center' }}>
                <AcArt
                  width={width - sp.m * 2 - sp.m * 2}
                  power={s.power}
                  color={t.mode[s.mode]}
                  angle={louverAngle(s.louverV, caps.louverV.map((o) => o.id))}
                  swing={s.louverV === 'swing'}
                  speed={fanSpeed}
                />
              </Glass>
              <ChipRow>
                {caps.louverV.map((o) => (
                  <Chip key={o.id} label={o.label} active={s.louverV === o.id} accent={t.mode[s.mode]} onPress={() => update({ louverV: o.id })} />
                ))}
              </ChipRow>
            </Section>

            {caps.louverH && (
              <Section title="Horizontal airflow">
                <ChipRow>
                  {caps.louverH.map((o) => (
                    <Chip key={o.id} label={o.label} active={s.louverH === o.id} accent={t.mode[s.mode]} onPress={() => update({ louverH: o.id })} />
                  ))}
                </ChipRow>
              </Section>
            )}

            {caps.specials.length > 0 && (
              <Section title="Special modes">
                <Glass style={{ paddingHorizontal: sp.m }}>
                  {caps.specials.map((o, i) => (
                    <View key={o.id} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.m, minHeight: 56, borderTopWidth: i ? 1 : 0, borderColor: t.line }}>
                      <T weight="medium" style={{ flex: 1 }}>{o.label}</T>
                      <Toggle
                        value={!!s.specials[o.id]}
                        accent={t.mode[s.mode]}
                        label={o.label}
                        onChange={(v) => update({ specials: { [o.id]: v } })}
                      />
                    </View>
                  ))}
                </Glass>
              </Section>
            )}

            {timerKinds.length > 0 && (
              <Section title="Timers">
                <Pressable onPress={() => { tap(); setSheet('timers'); }} accessibilityRole="button" accessibilityLabel="Timers">
                  <Glass interactive style={{ padding: sp.m, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: sp.m }}>
                    <SymbolView name="timer" size={22} tintColor={activeTimers.length ? accent : t.muted} />
                    <T weight="medium" tabular style={{ flex: 1 }}>
                      {activeTimers.length
                        ? activeTimers.map((k) => `${timerInfo[k].status} ${fmtMin(s[timerKey[k]]!)}`).join(' · ')
                        : 'No timers set'}
                    </T>
                    <SymbolView name="chevron.right" size={14} tintColor={t.muted} />
                  </Glass>
                </Pressable>
              </Section>
            )}
          </>
        )}
      </ScrollView>

      <Sheet visible={sheet === 'info'} onClose={() => setSheet(null)} title="Device info">
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: sp.l }}>
          <View>
            <Row label="Model" value={device.model} />
            <Row label="Firmware" value={device.firmware} />
            <Row label="Device id" value={device.id} />
            <Row label="Connection" value={online ? 'Connected' : 'Offline'} />
            <Row label="Last updated" value={updatedAt?.toLocaleTimeString()} />
            {s?.powerW != null && <Row label="Power usage" value={`${s.powerW} W`} />}
            {s?.fault && <Row label="Error code" value={s.fault} />}
          </View>
          <View style={{ gap: sp.s }}>
            <T weight="semibold">Help</T>
            <T muted size={14} style={{ lineHeight: 20 }}>
              Drag around the dial or use plus and minus to set the temperature; changes are sent after a short pause.
              Status refreshes every 15 seconds while this screen is open, or pull down to refresh now. Save settings
              you use often with the star; manage them and set schedules in the tabs below.
            </T>
          </View>
        </ScrollView>
      </Sheet>

      <Sheet visible={sheet === 'timers'} onClose={() => setSheet(null)} title="Timers">
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: sp.l }}>
          {s && timerKinds.map((k) => {
            const left = s[timerKey[k]];
            return (
              <View key={k} style={{ gap: sp.s }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.s, minHeight: 32 }}>
                  <SymbolView name={timerInfo[k].icon} size={18} tintColor={left != null ? accent : t.muted} />
                  <View style={{ flex: 1 }}>
                    <T weight="semibold" numberOfLines={1}>{timerInfo[k].label}</T>
                    <T muted size={13} tabular numberOfLines={1}>{left != null ? `${fmtMin(left)} left` : 'Not set'}</T>
                  </View>
                  {left != null && (
                    <Chip label="Cancel" onPress={() => run(`timer.${k}`, () => client.setTimer(id, k, null), (cur) => ({ ...cur, [timerKey[k]]: null }))} />
                  )}
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: sp.s }}>
                  {(k === 'sleep' ? sleepHours : timerHours).map((h) => (
                    <Chip
                      key={h}
                      label={`${h}h`}
                      onPress={() => run(`timer.${k}`, () => client.setTimer(id, k, h * 60), (cur) => ({ ...cur, [timerKey[k]]: h * 60 }))}
                    />
                  ))}
                </ScrollView>
              </View>
            );
          })}
        </ScrollView>
      </Sheet>
    </View>
  );
}

/** One line of chips that scrolls sideways, bleeding to the screen edges. */
function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -sp.m }}
      contentContainerStyle={{ gap: sp.s, paddingHorizontal: sp.m }}
    >
      {children}
    </ScrollView>
  );
}
