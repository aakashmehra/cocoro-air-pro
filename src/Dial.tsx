import { useEffect, useRef, type ReactNode } from 'react';
import { PanResponder, View, type GestureResponderEvent } from 'react-native';
import Animated, { FadeInDown, FadeInUp, useReducedMotion } from 'react-native-reanimated';
import Svg, { Line, Path } from 'react-native-svg';
import { DialArc } from './Art';
import { T, tap, useTheme } from './ui';

const START = 135; // degrees, 0 = 3 o'clock, clockwise
const SWEEP = 270;

/** Map a touch angle (deg) to a stepped value; the bottom gap snaps to the nearest end. */
export function angleToValue(deg: number, min: number, max: number, step: number) {
  let a = (deg + 360) % 360;
  if (a < START) a += 360; // now in [135, 495)
  if (a > START + SWEEP) a = a < START + SWEEP + (360 - SWEEP) / 2 ? START + SWEEP : START;
  const raw = min + ((a - START) / SWEEP) * (max - min);
  return Math.min(max, Math.max(min, Math.round(raw / step) * step));
}

export function Dial({ size, value, min, max, step, color, disabled, onChange, onDragging, children }: {
  size: number; value: number; min: number; max: number; step: number; color: string; disabled?: boolean;
  onChange: (v: number) => void; onDragging: (d: boolean) => void; children?: ReactNode;
}) {
  const t = useTheme();
  const stroke = 14;
  const c = size / 2;
  const r = c - stroke - 12;
  const latest = useRef({ min, max, step, disabled, onChange, onDragging, last: value });
  latest.current = { min, max, step, disabled, onChange, onDragging, last: value };

  const handle = (e: GestureResponderEvent) => {
    const { locationX: x, locationY: y } = e.nativeEvent;
    const p = latest.current;
    const v = angleToValue((Math.atan2(y - c, x - c) * 180) / Math.PI, p.min, p.max, p.step);
    if (v !== p.last) { p.last = v; tap(); p.onChange(v); }
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: (e) => {
      if (latest.current.disabled) return false;
      const { locationX: x, locationY: y } = e.nativeEvent;
      const d = Math.hypot(x - c, y - c);
      return d > r - 44 && d < r + 32; // only the ring band, so the center stays scroll-friendly
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { latest.current.onDragging(true); handle(e); },
    onPanResponderMove: handle,
    onPanResponderRelease: () => latest.current.onDragging(false),
    onPanResponderTerminate: () => latest.current.onDragging(false),
  })).current;

  const pt = (deg: number, rad: number) => {
    const a = (deg * Math.PI) / 180;
    return [c + rad * Math.cos(a), c + rad * Math.sin(a)] as const;
  };
  const [x0, y0] = pt(START, r);
  const [x1, y1] = pt(START + SWEEP, r);
  const frac = max === min ? 0 : (value - min) / (max - min);
  const ticks = disabled ? [] : Array.from({ length: Math.floor(max - min) + 1 }, (_, i) => min + i);

  return (
    <View style={{ width: size, height: size }} {...pan.panHandlers}>
      <View pointerEvents="none" style={{ position: 'absolute', inset: 0 }}>
        <Svg width={size} height={size}>
          {ticks.map((v) => {
            const a = START + (SWEEP * (v - min)) / (max - min);
            const [ax, ay] = pt(a, r + stroke / 2 + 6);
            const [bx, by] = pt(a, r + stroke / 2 + (v % 2 === 0 ? 12 : 9));
            const lit = v <= value;
            return <Line key={v} x1={ax} y1={ay} x2={bx} y2={by} stroke={lit ? color : t.faint} strokeWidth={1.5} strokeLinecap="round" opacity={lit ? 0.9 : 0.6} />;
          })}
          <Path d={`M ${x0} ${y0} A ${r} ${r} 0 1 1 ${x1} ${y1}`} stroke={t.track} strokeWidth={stroke} strokeLinecap="round" fill="none" />
          {!disabled && <DialArc frac={frac} r={r} c={c} stroke={stroke} color={color} bg={t.bg} />}
        </Svg>
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </View>
    </View>
  );
}

/** Big number that rolls in from below when rising and from above when falling. */
export function RollingNumber({ value, size }: { value: number; size: number }) {
  const reduced = useReducedMotion();
  const prev = useRef(value);
  const up = value >= prev.current;
  useEffect(() => { prev.current = value; }, [value]);
  const entering = reduced ? undefined : (up ? FadeInDown : FadeInUp).duration(180);
  return (
    // Fixed height so the dial content never shifts while digits animate.
    <View style={{ height: size * 1.25, justifyContent: 'center', overflow: 'hidden' }}>
      <Animated.View key={value} entering={entering}>
        <T weight="medium" size={size} tabular maxFontSizeMultiplier={1} style={{ letterSpacing: -2 }}>{value.toFixed(1)}</T>
      </Animated.View>
    </View>
  );
}
