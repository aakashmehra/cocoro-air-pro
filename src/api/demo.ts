// Demo client with two fake air conditioners, used by "Try the demo" on the sign-in screen.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SPEC, capsFromSpec } from './aircon';
import type { AcState, Capabilities, Device, TimerKind } from './types';

const wait = (ms = 250 + Math.random() * 350) => new Promise((r) => setTimeout(r, ms));

// Same capability shape the real client derives from Sharp's model list.
const fullCaps: Capabilities = capsFromSpec({ ...DEFAULT_SPEC, gentle: true, humidity: true });
const smallCaps: Capabilities = capsFromSpec({ ...DEFAULT_SPEC, horz: 0, fan: 2, sleepTimer: false });

const devices: Device[] = [
  { id: 'ac-01', name: 'Living room', room: 'Ground floor', model: 'AY-R40X2', firmware: '2.3.1', caps: fullCaps },
  { id: 'ac-02', name: 'Bedroom', room: 'First floor', model: 'AY-P22H', firmware: '1.8.4', caps: smallCaps },
];

// In-memory device state. Timers are stored as absolute end times so they count down.
const states: Record<string, AcState & { timerEnds: Partial<Record<TimerKind, number>> }> = {
  'ac-01': {
    power: true, mode: 'cool', targetTemp: 24.5, fan: 'auto', louverV: 'auto', louverH: 'front',
    specials: { plasmacluster: true, gentle: false },
    roomTemp: 26.3, humidity: 58, timerEnds: {},
  },
  'ac-02': {
    power: false, mode: 'heat', targetTemp: 21, fan: 'low', louverV: '4',
    specials: { plasmacluster: true },
    roomTemp: 19.8, humidity: 44, timerEnds: {},
  },
};

function snapshot(id: string): AcState {
  const s = states[id];
  if (!s) throw new Error(`Unknown device ${id}`);
  const left = (k: TimerKind) => {
    const end = s.timerEnds[k];
    if (end == null) return null;
    const min = Math.ceil((end - Date.now()) / 60000);
    if (min > 0) return min;
    delete s.timerEnds[k];
    if (k === 'on') s.power = true;
    else s.power = false;
    return null;
  };
  // Small drift so polling visibly does something.
  if (s.roomTemp != null) s.roomTemp = Math.round((s.roomTemp + (Math.random() - 0.5) * 0.2) * 10) / 10;
  const { timerEnds, ...state } = s;
  return {
    ...state,
    specials: { ...state.specials },
    onTimerMin: left('on'),
    offTimerMin: left('off'),
    sleepTimerMin: left('sleep'),
  };
}

export const demo = {
  async isSignedIn() {
    return (await AsyncStorage.getItem('demo:signedIn')) === '1';
  },
  async signIn() {
    await wait(800);
    await AsyncStorage.setItem('demo:signedIn', '1');
  },
  async signOut() {
    await AsyncStorage.removeItem('demo:signedIn');
  },
  async listDevices(): Promise<Device[]> {
    await wait();
    return devices;
  },
  async getState(id: string): Promise<AcState> {
    await wait();
    return snapshot(id);
  },
  async setState(id: string, patch: Partial<AcState>): Promise<AcState> {
    await wait();
    const { onTimerMin, offTimerMin, sleepTimerMin, ...rest } = patch;
    Object.assign(states[id], rest, patch.specials ? { specials: { ...states[id].specials, ...patch.specials } } : {});
    return snapshot(id);
  },
  async setTimer(id: string, kind: TimerKind, minutes: number | null): Promise<AcState> {
    await wait();
    if (minutes == null) delete states[id].timerEnds[kind];
    else states[id].timerEnds[kind] = Date.now() + minutes * 60000;
    return snapshot(id);
  },
};
