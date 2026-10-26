import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { client, localAvailable, type Connection } from '../api/client';
import { useSession } from '../session';
import { Glass, GlassButton, NumberedSteps, Sheet, T, errText, sp, toast, useTheme } from '../ui';

// Build variant (app.config.js): WIFI_ONLY=1 makes a build with no Sharp account option at all.
const WIFI_ONLY = !!Constants.expoConfig?.extra?.wifiOnly;
let autoConnected = false; // only start connecting by itself on the first screen of a launch

const rows: [string, string][] = WIFI_ONLY
  ? [
      ['wifi', 'Keep this phone on the same Wi‑Fi as your air conditioner.'],
      ['person.crop.circle.badge.xmark', 'No account or sign-in needed.'],
      ['hand.raised', 'When asked, allow access to devices on your local network.'],
    ]
  : [
      ['person.crop.circle', 'Sign in with your Sharp Cocoro Members account.'],
      ['lock', 'Your sign-in stays on this device.'],
      ['wifi', localAvailable
        ? 'Or skip the account and control it directly on your home Wi‑Fi.'
        : 'Your air conditioner must already be set up and online.'],
    ];

// How-to shown from the "i" button. Steps are numbered; tips are the troubleshooting list.
const WIFI_STEPS = [
  'New air conditioner? Tap Set up Wi‑Fi below first. It puts the air conditioner on your home Wi‑Fi in a couple of minutes.',
  'Connect this iPhone to the same Wi‑Fi network. Mobile data or guest Wi‑Fi will not work.',
  'Tap Connect. When iPhone asks to find devices on your local network, tap Allow.',
  'The app finds your air conditioner and remembers it. Next time it opens straight to the controls.',
];
const WIFI_TIPS = [
  "Not found? Open Settings, then Privacy and Security, then Local Network, and make sure Cocoro Air Pro is on. Then tap Connect again.",
  'The air conditioner only needs to be plugged in; it does not need to be running.',
  'Home Wi‑Fi control works only at home. Timers set here run on the unit itself.',
];
const ACCOUNT_STEPS = [
  'Your air conditioner needs to be registered to your Sharp Cocoro Members account.',
  'Tap Sign in. Sharp shows its own sign-in page; your password never goes through this app.',
  'Your air conditioners appear. Sign-in is remembered, so you only do this once.',
];
const ACCOUNT_TIPS = [
  'Sharp account: works from anywhere, including timers and the sleep timer.',
  'Home Wi‑Fi: no account at all, but only while this iPhone is on the same Wi‑Fi. Allow local network access when asked.',
  'New air conditioner? Set up Wi‑Fi puts it on your home Wi‑Fi without any other app.',
  'Try the demo to explore every screen with two pretend air conditioners.',
];

function HowTo({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const steps = WIFI_ONLY ? WIFI_STEPS : ACCOUNT_STEPS;
  const tips = WIFI_ONLY ? WIFI_TIPS : ACCOUNT_TIPS;
  return (
    <Sheet visible={visible} onClose={onClose} title="How it works">
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: sp.l }}>
        <NumberedSteps items={steps} />
        <View style={{ gap: sp.s }}>
          <T weight="semibold">{WIFI_ONLY ? 'Good to know' : 'Ways to connect'}</T>
          {tips.map((text) => (
            <View key={text} style={{ flexDirection: 'row', gap: sp.s }}>
              <T muted size={14} style={{ lineHeight: 20 }}>•</T>
              <T muted size={14} style={{ flex: 1, lineHeight: 20 }}>{text}</T>
            </View>
          ))}
        </View>
      </ScrollView>
    </Sheet>
  );
}

export default function SignIn() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { setSignedIn } = useSession();
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);

  async function signIn(via: Connection) {
    setBusy(true);
    try {
      // cloud: Sharp's own sign-in page in a secure browser sheet. local: scans the home Wi‑Fi.
      await client.signIn(via);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSignedIn(true);
    } catch (e) {
      toast(`${via === 'local' ? "Couldn't connect" : 'Sign in failed'}. ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (WIFI_ONLY && !autoConnected) {
      autoConnected = true;
      signIn('local'); // eslint-disable-line react-hooks/set-state-in-effect -- intentional one-time start
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ flex: 1, paddingBottom: insets.bottom + sp.l }}>
      <ScrollView contentContainerStyle={{ padding: sp.l, paddingTop: insets.top + sp.xl * 2, gap: sp.l }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Glass r={sp.l} style={{ width: 72, height: 72, alignItems: 'center', justifyContent: 'center' }}>
            <SymbolView name="snowflake" size={32} tintColor={t.mode.cool} />
          </Glass>
          <GlassButton icon="info" size={44} accessibilityLabel="How it works" onPress={() => setHelp(true)} />
        </View>
        <T weight="bold" size={34}>Cocoro Air Pro</T>
        <T size={17} muted style={{ lineHeight: 25 }}>
          {WIFI_ONLY
            ? 'Control your Sharp air conditioner straight from your home Wi‑Fi: temperature, modes, airflow, timers and favorites, all in one calm place.'
            : 'Connect your Sharp Cocoro account to control your air conditioners: temperature, modes, airflow, timers and favorites, all in one calm place.'}
        </T>
        <Glass style={{ padding: sp.m, gap: sp.m }}>
          {rows.map(([icon, text]) => (
            <View key={text} style={{ flexDirection: 'row', gap: sp.m, alignItems: 'center' }}>
              <SymbolView name={icon as 'lock'} size={18} tintColor={t.muted} />
              <T size={14} muted style={{ flex: 1 }}>{text}</T>
            </View>
          ))}
        </Glass>
      </ScrollView>
      <View style={{ paddingHorizontal: sp.l, height: 56, justifyContent: 'center' }}>
        {busy ? (
          <ActivityIndicator color={t.text} />
        ) : (
          <GlassButton
            label={WIFI_ONLY ? 'Connect' : 'Sign in'}
            icon={WIFI_ONLY ? 'wifi' : 'arrow.right'}
            size={56}
            tint={t.mode.cool}
            color="#FFFFFF"
            onPress={() => signIn(WIFI_ONLY ? 'local' : 'cloud')}
          />
        )}
      </View>
      {localAvailable && !WIFI_ONLY && (
        <View style={{ paddingHorizontal: sp.l, marginTop: sp.s }}>
          <GlassButton label="Use on home Wi‑Fi" icon="wifi" size={52} disabled={busy} onPress={() => signIn('local')} />
        </View>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: sp.l, marginTop: sp.s }}>
        {localAvailable && (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => router.push('/setup')}
            style={({ pressed }) => ({ height: 44, justifyContent: 'center', opacity: busy ? 0.4 : pressed ? 0.6 : 1 })}
          >
            <T weight="medium" size={15} muted>Set up Wi‑Fi</T>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => signIn('demo')}
          style={({ pressed }) => ({ height: 44, justifyContent: 'center', opacity: busy ? 0.4 : pressed ? 0.6 : 1 })}
        >
          <T weight="medium" size={15} muted>Try the demo</T>
        </Pressable>
      </View>
      <HowTo visible={help} onClose={() => setHelp(false)} />
    </View>
  );
}
