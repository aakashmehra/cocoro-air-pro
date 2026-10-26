import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { client, type Connection } from '../../api/client';
import { useSession } from '../../session';
import { Glass, GlassButton, Row, T, sp, useTheme } from '../../ui';

export default function Settings() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { setSignedIn, setDevices, setDeviceId, devices } = useSession();
  const [via, setVia] = useState<Connection>('cloud');
  useEffect(() => { client.connection().then(setVia, () => {}); }, []);
  const label = { cloud: 'Sharp Cocoro account', local: 'Home Wi‑Fi', demo: 'Demo' }[via];
  const leave = via === 'cloud' ? 'Sign out' : 'Disconnect';

  function signOut() {
    Alert.alert(`${leave}?`, via === 'cloud' ? 'You can sign back in with your Sharp Cocoro account at any time.' : 'You can connect again at any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: leave, style: 'destructive', onPress: async () => {
          await client.signOut();
          setDevices([]);
          setDeviceId(null);
          setSignedIn(false);
        },
      },
    ]);
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: sp.m, paddingTop: insets.top + sp.m, gap: sp.l }}>
      <T weight="bold" size={34} numberOfLines={1}>Settings</T>
      <Glass style={{ paddingHorizontal: sp.m, paddingVertical: sp.s }}>
        <Row label="Connection" value={label} />
        <Row label="Air conditioners" value={String(devices.length)} />
        <Row label="Status refresh" value="Every 15 seconds" />
        <Row label="Version" value={Constants.expoConfig?.version} />
      </Glass>
      <T muted size={13} style={{ paddingHorizontal: sp.xs, lineHeight: 20 }}>
        Status refreshes automatically while the controls are open. Pull down to refresh now.
      </T>
      <GlassButton label={leave} icon="rectangle.portrait.and.arrow.right" size={52} color={t.mode.heat} onPress={signOut} />
    </ScrollView>
  );
}
