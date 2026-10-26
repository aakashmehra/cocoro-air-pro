import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { client } from '../../api/client';
import type { AcState } from '../../api/types';
import { Control } from '../../Control';
import { useSession } from '../../session';
import { setShortcutDevices } from '../../shortcuts';
import { Glass, GlassButton, Skeleton, T, errText, fmtTemp, sp, tap, useTheme } from '../../ui';

const CARD_H = 128;
const modeVerb = { auto: 'Auto', cool: 'Cooling', heat: 'Heating', dry: 'Drying', fan: 'Fan' };

/** Controls tab: one air conditioner opens straight to its controls; several show a list first. */
export default function ControlsTab() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { devices, setDevices, deviceId, setDeviceId } = useSession();
  const [states, setStates] = useState<Record<string, AcState>>({});
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await client.listDevices();
      setDevices(list);
      setShortcutDevices(list);
      setError(null);
      if (list.length > 1) {
        const entries = await Promise.all(list.map(async (d) => [d.id, await client.getState(d.id)] as const));
        setStates(Object.fromEntries(entries));
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [setDevices]);

  useFocusEffect(useCallback(() => { if (!devices.length) load(); }, [devices.length, load]));

  const current = deviceId ?? (devices.length === 1 ? devices[0].id : null);
  if (current) return <Control id={current} onSwitch={devices.length > 1 ? () => setDeviceId(null) : undefined} />;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: sp.m, paddingTop: insets.top + sp.m, gap: sp.m }}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={async () => { setPulling(true); await load(); setPulling(false); }} tintColor={t.muted} />}
    >
      <View style={{ marginBottom: sp.s }}>
        <T weight="bold" size={34} numberOfLines={1}>Home</T>
        <T muted numberOfLines={1}>{devices.length < 2 ? ' ' : `${devices.length} air conditioners`}</T>
      </View>

      {!loading && devices.length === 0 && (
        <Glass style={{ padding: sp.m, gap: sp.s }}>
          <T weight="semibold">{error ? "Couldn't load your air conditioners" : 'No air conditioners found'}</T>
          <T muted size={14} style={{ lineHeight: 20 }}>
            {error ? `${error}.` : 'Make sure this iPhone is on the same Wi‑Fi as your air conditioner.'}
          </T>
          <GlassButton label="Search again" icon="arrow.clockwise" size={44} onPress={load} />
        </Glass>
      )}
      {loading && devices.length === 0 && [0, 1].map((i) => <Skeleton key={i} height={CARD_H} />)}

      {devices.map((d) => {
        const s = states[d.id];
        const accent = s?.power ? t.mode[s.mode] : t.faint;
        return (
          <Pressable
            key={d.id}
            onPress={() => { tap(); setDeviceId(d.id); }}
            style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
            accessibilityRole="button"
            accessibilityLabel={`${d.name}, ${s?.power ? 'on' : 'off'}`}
          >
            <Glass interactive style={{ padding: sp.l, minHeight: CARD_H, flexDirection: 'row', alignItems: 'center', gap: sp.m }}>
              <View style={{ flex: 1, gap: sp.xs }}>
                <T weight="semibold" size={19} numberOfLines={1}>{d.name}</T>
                <T muted size={14} numberOfLines={1}>{[d.room, d.model].filter(Boolean).join(' · ')}</T>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.s, marginTop: sp.s }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent }} />
                  <T weight="medium" size={14} color={s?.power ? accent : t.muted} numberOfLines={1} style={{ flexShrink: 1 }}>
                    {!s ? 'Loading' : s.power ? `${modeVerb[s.mode]}${d.caps.tempRange[s.mode] ? ` to ${fmtTemp(s.targetTemp)}` : ''}` : 'Off'}
                  </T>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T weight="medium" size={36} tabular maxFontSizeMultiplier={1.15}>{fmtTemp(s?.roomTemp)}</T>
                <T muted size={13}>Room</T>
              </View>
            </Glass>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
