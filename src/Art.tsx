// SVG animations. All motion runs on the UI thread via shared values; React only re-renders on prop changes.
import { useEffect } from 'react';
import Animated, {
  Easing, cancelAnimation, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue,
  withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';
import { useTheme } from './ui';

const APath = Animated.createAnimatedComponent(Path);
const ACircle = Animated.createAnimatedComponent(Circle);
const linear = Easing.linear;
const soft = Easing.inOut(Easing.sin);

/** Louver id -> flap angle in degrees below horizontal (side view, air blowing right). */
export function louverAngle(id: string, ids: string[]) {
  const fixed = ids.filter((x) => x !== 'auto' && x !== 'swing');
  const i = fixed.indexOf(id);
  return i < 0 ? 38 : 14 + (62 * i) / Math.max(1, fixed.length - 1);
}

/**
 * Side view of a wall unit: the flap rotates to the louver angle (sweeps when swinging) and
 * dashed waves flow out along it. speed 0..1 scales the flow; 0 or power off stops it.
 */
export function AcArt({ power, color, angle, swing, speed, width, height = 132 }: {
  power: boolean; color: string; angle: number; swing: boolean; speed: number; width: number; height?: number;
}) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const a = useSharedValue(angle);
  const flow = useSharedValue(0);
  const shown = useSharedValue(power ? 1 : 0);

  useEffect(() => {
    cancelAnimation(a);
    if (swing && power && !reduced) {
      a.value = withSequence(
        withTiming(14, { duration: 900, easing: soft }),
        withRepeat(withTiming(76, { duration: 2600, easing: soft }), -1, true),
      );
    } else {
      a.value = reduced ? angle : withSpring(angle, { damping: 16, stiffness: 120 });
    }
  }, [angle, swing, power, reduced]);

  useEffect(() => {
    shown.value = reduced ? (power ? 1 : 0) : withTiming(power ? 1 : 0, { duration: 500 });
    cancelAnimation(flow);
    if (power && !reduced && speed > 0) {
      flow.value = 0;
      flow.value = withRepeat(withTiming(-48, { duration: 2200 - 1500 * speed, easing: linear }), -1, false);
    }
  }, [power, speed, reduced]);

  // Unit geometry (left wall, unit hanging from it).
  const ux = 20, uy = 18, uw = 112, uh = 52;
  const hx = ux + uw - 14, hy = uy + uh - 4; // flap hinge
  const flapLen = 26;

  const flap = useAnimatedProps(() => {
    const r = (a.value * Math.PI) / 180;
    return { d: `M ${hx} ${hy} L ${hx + flapLen * Math.cos(r)} ${hy + flapLen * Math.sin(r)}` };
  });

  const useWave = (offset: number, phase: number) =>
    useAnimatedProps(() => {
      const r = (a.value * Math.PI) / 180;
      const ux2 = Math.cos(r), uy2 = Math.sin(r);
      const nx = -uy2, ny = ux2;
      const x0 = hx + (flapLen + 6) * ux2, y0 = hy + (flapLen + 6) * uy2;
      let d = '';
      for (let k = 0; k <= 18; k++) {
        const s = (k / 18) * 190;
        const w = offset + 3 * Math.sin(s / 15 + phase);
        d += `${k ? 'L' : 'M'} ${x0 + ux2 * s + nx * w} ${y0 + uy2 * s + ny * w} `;
      }
      return { d, strokeDashoffset: flow.value + phase * 8, opacity: shown.value * (0.9 - Math.abs(offset) / 40) };
    });
  const waves = [useWave(-12, 0), useWave(0, 2), useWave(12, 4)];

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Line x1={ux - 8} y1={0} x2={ux - 8} y2={height} stroke={t.line} strokeWidth={2} />
      {waves.map((p, i) => (
        <APath key={i} animatedProps={p} stroke={color} strokeWidth={2} strokeLinecap="round" strokeDasharray="18 30" fill="none" />
      ))}
      <Rect x={ux} y={uy} width={uw} height={uh} rx={16} fill={t.dark ? '#1A222C' : '#FFFFFF'} stroke={t.line} strokeWidth={1} />
      <Rect x={ux + 14} y={uy + 14} width={28} height={3} rx={1.5} fill={power ? color : t.faint} />
      <Circle cx={ux + uw - 20} cy={uy + 15.5} r={2.5} fill={power ? color : t.faint} />
      <APath animatedProps={flap} stroke={t.text} strokeWidth={4} strokeLinecap="round" fill="none" />
      <Circle cx={hx} cy={hy} r={3} fill={t.text} />
    </Svg>
  );
}

/** Small fan glyph that spins faster at higher levels. speed 0 stops it. */
export function FanSpinner({ speed, color, size = 18 }: { speed: number; color: string; size?: number }) {
  const reduced = useReducedMotion();
  const rot = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(rot);
    if (speed > 0 && !reduced) {
      rot.value = rot.value % 360;
      rot.value = withRepeat(withTiming(rot.value + 360, { duration: 1800 - 1350 * speed, easing: linear }), -1, false);
    }
  }, [speed, reduced]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  const c = 12;
  return (
    <Animated.View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <G fill={color}>
          {[0, 120, 240].map((deg) => (
            <Path key={deg} transform={`rotate(${deg} ${c} ${c})`} d="M12 12 C 10 8, 10 3, 13 2.5 C 16 2.5, 15.5 8, 12 12 Z" />
          ))}
        </G>
        <Circle cx={c} cy={c} r={2} fill={color} />
      </Svg>
    </Animated.View>
  );
}

/** Power symbol that closes its ring and lengthens its bar when on. */
export function PowerGlyph({ on, color, size = 28 }: { on: boolean; color: string; size?: number }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    p.value = reduced ? (on ? 1 : 0) : withSpring(on ? 1 : 0, { damping: 14, stiffness: 160 });
  }, [on, reduced]);
  const ring = useAnimatedProps(() => {
    const gap = 110 - 50 * p.value; // degrees open at the top
    const r = 8, cx = 12, cy = 13;
    const a0 = ((-90 + gap / 2) * Math.PI) / 180, a1 = ((270 - gap / 2) * Math.PI) / 180;
    return {
      d: `M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 1 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`,
    };
  });
  const bar = useAnimatedProps(() => ({ d: `M 12 ${3.5 - p.value} L 12 ${8 + 3 * p.value}` }));
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 0.92 + 0.08 * p.value }] }));
  return (
    <Animated.View style={style}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <APath animatedProps={ring} stroke={color} strokeWidth={2.2} strokeLinecap="round" fill="none" />
        <APath animatedProps={bar} stroke={color} strokeWidth={2.2} strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
  );
}

/** Spring progress arc + knob for the dial. frac 0..1 along a 270 degree sweep. */
export function DialArc({ frac, r, c, stroke, color, bg }: {
  frac: number; r: number; c: number; stroke: number; color: string; bg: string;
}) {
  const reduced = useReducedMotion();
  const p = useSharedValue(frac);
  useEffect(() => {
    p.value = reduced ? frac : withSpring(frac, { damping: 20, stiffness: 240, mass: 0.6 });
  }, [frac, reduced]);
  const len = (r * 270 * Math.PI) / 180;
  const start = (135 * Math.PI) / 180;
  const arc = useAnimatedProps(() => ({ strokeDashoffset: len * (1 - p.value) }));
  const knob = useAnimatedProps(() => {
    const a = start + (270 * p.value * Math.PI) / 180;
    return { cx: c + r * Math.cos(a), cy: c + r * Math.sin(a) };
  });
  const [x0, y0] = [c + r * Math.cos(start), c + r * Math.sin(start)];
  const end = start + (270 * Math.PI) / 180;
  const d = `M ${x0} ${y0} A ${r} ${r} 0 1 1 ${c + r * Math.cos(end)} ${c + r * Math.sin(end)}`;
  return (
    <>
      <APath animatedProps={arc} d={d} stroke={color} strokeWidth={stroke} strokeLinecap="round" fill="none" strokeDasharray={`${len} ${len}`} />
      <ACircle animatedProps={knob} r={stroke * 0.95} fill={bg} stroke={color} strokeWidth={4} />
    </>
  );
}

/** Quick scale pop, e.g. when a favorite is saved. Call the returned trigger. */
export function usePop() {
  const reduced = useReducedMotion();
  const s = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const pop = () => {
    if (reduced) return;
    s.value = withSequence(withTiming(1.35, { duration: 120 }), withSpring(1, { damping: 8, stiffness: 220 }));
  };
  return [style, pop] as const;
}
