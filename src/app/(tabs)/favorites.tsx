import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { client } from '../../api/client';
import { ask, modeInfo } from '../../Control';
import { useSession } from '../../session';
import { describeSettings, presets, type Preset } from '../../store';
import { Glass, GlassButton, T, errText, sp, toast, useTheme } from '../../ui';

export default function FavoritesTab() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { devices, deviceId } = useSession();
  const device = devices.find((d) => d.id === (deviceId ?? devices[0]?.id));
  const store = presets(device?.id ?? '-');
  const list = store.use();
  const [busy, setBusy] = useState<string | null>(null); // favorite being applied, or 'save'

  async function saveCurrent() {
    if (!device) return;
    setBusy('save');
    try {
      const s = await client.getState(device.id);
      ask('Save favorite', describeSettings(s), (name) => {
        const { mode, targetTemp, fan, louverV, louverH, specials } = s;
        store.set([...list, { id: String(Date.now()), name, mode, targetTemp, fan, louverV, louverH, specials }]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      });
    } catch (e) {
      toast(`Couldn't read the current settings. ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function apply(p: Preset) {
    if (!device || busy) return;
    setBusy(p.id);
    try {
      const { id: _id, name: _name, ...settings } = p;
      await client.setState(device.id, { power: true, ...settings });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast(`${p.name} is on`);
    } catch (e) {
      toast(`Couldn't apply ${p.name}. ${errText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  function edit(p: Preset) {
    Alert.alert(p.name, undefined, [
      { text: 'Rename', onPress: () => ask('Rename favorite', p.name, (name) => store.set(list.map((x) => (x.id === p.id ? { ...x, name } : x)))) },
      { text: 'Delete', style: 'destructive', onPress: () => store.set(list.filter((x) => x.id !== p.id)) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  const label = (options: { id: string; label: string }[] | undefined, id?: string) => options?.find((o) => o.id === id)?.label;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: sp.m, paddingTop: insets.top + sp.m, gap: sp.m }}>
      <View style={{ marginBottom: sp.s }}>
        <T weight="bold" size={34} numberOfLines={1}>Favorites</T>
        <T muted numberOfLines={1}>{devices.length > 1 && device ? device.name : 'One tap to your usual settings'}</T>
      </View>

      {!device ? (
        <T muted>Connect an air conditioner first.</T>
      ) : (
        <>
          <View style={{ height: 52, justifyContent: 'center' }}>
            {busy === 'save'
              ? <ActivityIndicator color={t.text} />
              : <GlassButton label="Save current settings" icon="star" size={52} tint={t.mode.cool} color="#FFFFFF" onPress={saveCurrent} />}
          </View>

          {list.length === 0 && (
            <T muted size={14} style={{ lineHeight: 20, paddingHorizontal: sp.xs }}>
              Set the air conditioner how you like it, then save it here. Favorites can also be used in schedules.
            </T>
          )}

          {list.map((p) => {
            const color = t.mode[p.mode];
            const details = [
              describeSettings(p),
              label(device.caps.fanLevels, p.fan) && `Fan ${label(device.caps.fanLevels, p.fan)!.toLowerCase()}`,
              label(device.caps.louverV, p.louverV) && `Airflow ${label(device.caps.louverV, p.louverV)!.toLowerCase()}`,
            ].filter(Boolean).join(' · ');
            return (
              <Pressable
                key={p.id}
                onPress={() => apply(p)}
                onLongPress={() => edit(p)}
                accessibilityRole="button"
                accessibilityHint="Applies this favorite. Long-press to rename or delete."
                style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
              >
                <Glass interactive style={{ padding: sp.m, minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: sp.m }}>
                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
                    <SymbolView name={modeInfo[p.mode].icon} size={20} tintColor="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T weight="semibold" numberOfLines={1}>{p.name}</T>
                    <T muted size={13} numberOfLines={2}>{details}</T>
                  </View>
                  <View style={{ width: 44, alignItems: 'center' }}>
                    {busy === p.id ? <ActivityIndicator color={color} /> : <SymbolView name="play.circle.fill" size={28} tintColor={color} />}
                  </View>
                </Glass>
              </Pressable>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}
