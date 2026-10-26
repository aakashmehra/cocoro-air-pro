// Favorites and schedules, saved on this device and shared live by every screen that shows them.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';
import type { AcState, Mode } from './api/types';

export type Settings = Pick<AcState, 'mode' | 'targetTemp' | 'fan' | 'louverV' | 'louverH' | 'specials'>;
export type Preset = Settings & { id: string; name: string };
export type Schedule = {
  id: string;
  deviceId: string;
  time: string; // "HH:mm", local time
  days: number[]; // 0 = Sunday
  action: 'on' | 'off';
  settings?: Settings; // turn on with these; none = just power on
  enabled: boolean;
  linked: boolean; // the user finished the one-time Shortcuts step
};

const EMPTY: never[] = [];
const changed = new Set<() => void>();
/** Called after any favorite or schedule changes (used to keep Shortcuts in sync). */
export const onAnyChange = (fn: () => void) => changed.add(fn);

function createStore<T>(key: string) {
  let value: T[] | null = null;
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const load = () => (loading ??= AsyncStorage.getItem(key).then(
    (v) => { value ??= v ? JSON.parse(v) : []; emit(); },
    () => { value ??= []; emit(); },
  ));
  return {
    load,
    get: () => value ?? EMPTY,
    async set(next: T[]) {
      value = next;
      emit();
      changed.forEach((fn) => fn());
      await AsyncStorage.setItem(key, JSON.stringify(next));
    },
    use(): T[] {
      useEffect(() => { load(); }, []);
      return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => value ?? EMPTY);
    },
  };
}

const presetStores = new Map<string, ReturnType<typeof createStore<Preset>>>();
/** Favorites for one air conditioner (same storage key the app has always used). */
export const presets = (deviceId: string) => {
  if (!presetStores.has(deviceId)) presetStores.set(deviceId, createStore<Preset>(`presets:${deviceId}`));
  return presetStores.get(deviceId)!;
};
export const schedules = createStore<Schedule>('schedules');

// --- Labels ---

const MODE: Record<Mode, string> = { auto: 'Auto', cool: 'Cool', heat: 'Heat', dry: 'Dry', fan: 'Fan' };
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeSettings(s?: Settings) {
  if (!s) return 'Turn on';
  return s.mode === 'cool' || s.mode === 'heat' ? `${MODE[s.mode]} ${s.targetTemp}°` : MODE[s.mode];
}

export function describeDays(days: number[]) {
  const set = [...days].sort().join('');
  if (set === '0123456') return 'Every day';
  if (set === '12345') return 'Weekdays';
  if (set === '06') return 'Weekends';
  return [...days].sort().map((d) => DAY[d]).join(', ');
}

export const describeSchedule = (s: Schedule) =>
  `${s.time} ${s.action === 'off' ? 'Turn off' : `Turn on, ${describeSettings(s.settings)}`} (${describeDays(s.days)})`;
