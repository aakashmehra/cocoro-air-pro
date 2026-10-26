export type Mode = 'auto' | 'cool' | 'heat' | 'dry' | 'fan';

export type Option = { id: string; label: string };

export type AcState = {
  power: boolean;
  mode: Mode;
  targetTemp: number;
  fan: string;
  louverV: string;
  louverH?: string;
  specials: Record<string, boolean>;
  roomTemp?: number;
  humidity?: number;
  outdoorTemp?: number;
  /** Remaining minutes, null when not set. */
  onTimerMin?: number | null;
  offTimerMin?: number | null;
  sleepTimerMin?: number | null;
  /** Unit error code (e.g. "28-0") while the unit reports a fault. */
  fault?: string;
  /** Current power draw in watts, if the unit reports it. */
  powerW?: number;
};

export type Capabilities = {
  modes: Mode[];
  /** null = target temperature not adjustable in that mode. */
  tempRange: Record<Mode, { min: number; max: number; step: number } | null>;
  fanLevels: Option[];
  louverV: Option[];
  louverH?: Option[];
  specials: Option[];
  timers: { on: boolean; off: boolean; sleep: boolean };
  /** Unit has a humidity sensor. */
  humidity?: boolean;
  /** Unit reports outdoor temperature (home Wi‑Fi connection only). */
  outdoor?: boolean;
};

export type Device = {
  id: string;
  name: string;
  model: string;
  room?: string;
  firmware?: string;
  caps: Capabilities;
};

export type TimerKind = 'on' | 'off' | 'sleep';
