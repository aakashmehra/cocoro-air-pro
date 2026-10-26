import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Modal, Pressable, Text, View, useColorScheme,
  type PressableProps, type StyleProp, type TextProps, type ViewStyle,
} from 'react-native';
import Animated, { FadeInUp, FadeOutUp, SlideInDown, useAnimatedStyle, useReducedMotion, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Mode } from './api/types';

const palettes = {
  dark: {
    bg: '#0B0F14', text: '#E8EDF2', muted: '#8A96A3', faint: '#4A5562', line: 'rgba(255,255,255,0.08)',
    fill: 'rgba(28,36,46,0.62)', track: 'rgba(255,255,255,0.08)', scrim: 'rgba(0,0,0,0.45)', skeleton: 'rgba(255,255,255,0.06)',
    mode: { auto: '#A497FF', cool: '#5AA9FF', heat: '#FF9F5A', dry: '#4FD1C5', fan: '#A9B6C4' } as Record<Mode, string>,
  },
  light: {
    bg: '#EDF0F3', text: '#0E141B', muted: '#5B6672', faint: '#A5AEB8', line: 'rgba(0,0,0,0.07)',
    fill: 'rgba(255,255,255,0.72)', track: 'rgba(0,0,0,0.07)', scrim: 'rgba(0,0,0,0.25)', skeleton: 'rgba(0,0,0,0.05)',
    mode: { auto: '#6E5CE6', cool: '#2B7FE0', heat: '#E0702A', dry: '#16A394', fan: '#5F6B78' } as Record<Mode, string>,
  },
};
export type Theme = typeof palettes.dark & { dark: boolean };

export function useTheme(): Theme {
  const dark = useColorScheme() !== 'light';
  return { ...(dark ? palettes.dark : palettes.light), dark };
}

/** 8pt grid. */
export const sp = { xs: 4, s: 8, m: 16, l: 24, xl: 32 };
export const radius = { s: 12, m: 16, l: 24, xl: 32 };

export const fonts = { regular: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold' };

/** Text that always uses Inter. Never pass fontWeight; use `weight`. Dynamic Type is capped so layouts hold. */
export function T({ weight = 'regular', size = 15, color, muted, tabular, style, ...rest }: TextProps & {
  weight?: keyof typeof fonts; size?: number; color?: string; muted?: boolean; tabular?: boolean;
}) {
  const t = useTheme();
  return (
    <Text
      maxFontSizeMultiplier={1.35}
      {...rest}
      style={[
        { fontFamily: fonts[weight], fontSize: size, color: color ?? (muted ? t.muted : t.text) },
        tabular && { fontVariant: ['tabular-nums'] },
        style,
      ]}
    />
  );
}

const liquid = isLiquidGlassAvailable();

/** iOS 26 liquid glass, falling back to a blur with a translucent fill. */
export function Glass({ style, children, interactive, tint, r = radius.l }: {
  style?: StyleProp<ViewStyle>; children?: ReactNode; interactive?: boolean; tint?: string; r?: number;
}) {
  const t = useTheme();
  const shape = { borderRadius: r, overflow: 'hidden' as const };
  if (liquid) {
    return (
      <GlassView style={[shape, style]} isInteractive={interactive} tintColor={tint}>
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView
      intensity={40}
      tint={t.dark ? 'dark' : 'light'}
      style={[shape, { backgroundColor: tint ?? t.fill, borderWidth: 1, borderColor: t.line }, style]}
    >
      {children}
    </BlurView>
  );
}

export const tap = () => Haptics.selectionAsync();

/** Round or pill glass button. Pass `children` for a custom glyph. */
export function GlassButton({ icon, label, onPress, size = 44, tint, color, style, disabled, children, ...rest }: Omit<PressableProps, 'children'> & {
  icon?: SFSymbol; label?: string; size?: number; tint?: string; color?: string; style?: StyleProp<ViewStyle>; children?: ReactNode;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={size < 44 ? (44 - size) / 2 : undefined}
      onPress={(e) => { tap(); onPress?.(e); }}
      style={({ pressed }) => [{ opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }, style]}
      {...rest}
    >
      <Glass
        interactive
        tint={tint}
        r={size / 2}
        style={{
          height: size, minWidth: size, paddingHorizontal: label ? sp.l : 0, gap: sp.s,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {icon && <SymbolView name={icon} size={size * 0.42} tintColor={color ?? t.text} />}
        {children}
        {label && <T weight="semibold" color={color} numberOfLines={1}>{label}</T>}
      </Glass>
    </Pressable>
  );
}

/** Selectable glass chip. */
export function Chip({ label, active, accent, disabled, onPress, onLongPress }: {
  label: string; active?: boolean; accent?: string; disabled?: boolean; onPress: () => void; onLongPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      disabled={disabled}
      onPress={() => { tap(); onPress(); }}
      onLongPress={onLongPress && (() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLongPress(); })}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: !!disabled }}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Glass interactive r={radius.m} tint={active ? accent : undefined} style={{ minHeight: 40, paddingHorizontal: sp.m, paddingVertical: sp.s, justifyContent: 'center' }}>
        <T weight={active ? 'semibold' : 'medium'} size={14} color={active ? '#FFFFFF' : t.text} numberOfLines={1}>{label}</T>
      </Glass>
    </Pressable>
  );
}

/** On/off toggle. Replaces RN's Switch, which draws off-centre on iOS 26. */
export function Toggle({ value, onChange, accent, label }: { value: boolean; onChange: (v: boolean) => void; accent: string; label: string }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: reduced ? (value ? 20 : 0) : withSpring(value ? 20 : 0, { damping: 18, stiffness: 260 }) }],
  }));
  const track = useAnimatedStyle(() => ({
    backgroundColor: reduced ? (value ? accent : t.track) : withTiming(value ? accent : t.track, { duration: 160 }),
  }));
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      hitSlop={8}
      onPress={() => { tap(); onChange(!value); }}
    >
      <Animated.View style={[{ width: 52, height: 32, borderRadius: 16, padding: 2 }, track]}>
        <Animated.View
          style={[{
            width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFF',
            shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
          }, thumb]}
        />
      </Animated.View>
    </Pressable>
  );
}

/** Numbered instructions (help sheet, Wi‑Fi setup). */
export function NumberedSteps({ items }: { items: string[] }) {
  const t = useTheme();
  return (
    <View style={{ gap: sp.m }}>
      {items.map((text, i) => (
        <View key={text} style={{ flexDirection: 'row', gap: sp.m }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: t.mode.cool, alignItems: 'center', justifyContent: 'center' }}>
            <T weight="semibold" size={14} color="#FFFFFF">{i + 1}</T>
          </View>
          <T size={15} style={{ flex: 1, lineHeight: 22 }}>{text}</T>
        </View>
      ))}
    </View>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ gap: sp.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: sp.xs, minHeight: 32, gap: sp.s }}>
        <T weight="semibold" size={13} muted numberOfLines={1} style={{ flexShrink: 1 }}>{title}</T>
        {right}
      </View>
      {children}
    </View>
  );
}

/** Fixed-size placeholder so content never jumps in when it loads. */
export function Skeleton({ height, style }: { height: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ height, borderRadius: radius.l, backgroundColor: t.skeleton }, style]} />;
}

/** Bottom sheet built on a transparent modal. */
export function Sheet({ visible, onClose, title, children }: {
  visible: boolean; onClose: () => void; title: string; children: ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: t.scrim }} onPress={onClose} accessibilityLabel="Close" />
      <Animated.View
        entering={reduced ? undefined : SlideInDown.springify().damping(22).stiffness(220)}
        style={{ position: 'absolute', left: sp.s, right: sp.s, bottom: Math.max(sp.s, insets.bottom - sp.m), maxHeight: '85%' }}
      >
      <Glass r={radius.xl} style={{ padding: sp.l, gap: sp.m }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp.s }}>
          <T weight="bold" size={20} numberOfLines={1} style={{ flexShrink: 1 }}>{title}</T>
          <GlassButton icon="xmark" size={32} onPress={onClose} accessibilityLabel="Close" />
        </View>
        {children}
      </Glass>
      </Animated.View>
      <Toasts />
    </Modal>
  );
}

export function Row({ label, value }: { label: string; value?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: sp.m, paddingVertical: sp.s + sp.xs, borderBottomWidth: 1, borderColor: t.line }}>
      <T muted>{label}</T>
      <T weight="medium" selectable style={{ flexShrink: 1, textAlign: 'right' }}>{value ?? '–'}</T>
    </View>
  );
}

// Toasts: call toast('...') from anywhere; <Toasts /> renders at the top of the root and inside sheets.
const listeners = new Set<(m: { id: number; text: string } | null) => void>();
let toastId = 0;
export function toast(text: string) {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  const m = { id: ++toastId, text };
  listeners.forEach((l) => l(m));
}

export function Toasts() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<{ id: number; text: string } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const l = (m: { id: number; text: string } | null) => {
      setMsg(m);
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 3500);
    };
    listeners.add(l);
    return () => { listeners.delete(l); clearTimeout(timer); };
  }, []);
  if (!msg) return null;
  return (
    <Animated.View
      key={msg.id}
      entering={FadeInUp.duration(220)}
      exiting={FadeOutUp.duration(180)}
      style={{ position: 'absolute', top: insets.top + sp.s, left: sp.m, right: sp.m, alignItems: 'center' }}
      accessibilityLiveRegion="polite"
    >
      <Pressable onPress={() => setMsg(null)} accessibilityRole="alert">
        <Glass r={radius.l} style={{ flexDirection: 'row', alignItems: 'center', gap: sp.s, paddingHorizontal: sp.m, paddingVertical: sp.s + sp.xs }}>
          <SymbolView name="exclamationmark.circle" size={18} tintColor={t.mode.heat} />
          <T weight="medium" size={14} style={{ flexShrink: 1 }}>{msg.text}</T>
        </Glass>
      </Pressable>
    </Animated.View>
  );
}

export const fmtTemp = (v?: number) => (v == null ? '–' : `${v.toFixed(1)}°`);
export const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m}m`);
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
