import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { client } from '../api/client';
import { hostInfo, sendWifi, type HostInfo } from '../api/setup';
import { useSession } from '../session';
import { Glass, GlassButton, NumberedSteps, T, errText, fonts, sp, tap, useTheme } from '../ui';

// First-time Wi‑Fi setup for a new air conditioner, so no other app is ever needed.
type Step = 'choose' | 'wps' | 'join' | 'details' | 'sent';
const back: Record<Step, Step | null> = { choose: null, wps: 'choose', join: 'choose', details: 'join', sent: 'choose' };

const WPS_STEPS = [
  'Make sure the air conditioner is plugged in.',
  'On the remote, hold Menu for 3 seconds. The Connect lamp on the air conditioner starts blinking.',
  'Within 2 minutes, press the Wi‑Fi pairing button on your router. It usually shows two curved arrows.',
  'A melody plays and the Connect lamp stays on. That means it is connected.',
];
const JOIN_STEPS = [
  'On the remote, press and hold Stop until the air conditioner starts its own Wi‑Fi. Its Connect lamp blinks.',
  'Open Settings, then Wi‑Fi, and join the network named AP-SHARP- followed by a number (for example AP-SHARP-15). It has no password.',
  "If iPhone says that network has no internet, that's expected. Then come back here.",
];
const SENT_STEPS = [
  'Open Settings, then Wi‑Fi, and switch this iPhone back to your home Wi‑Fi. The air conditioner may wait for this before it switches over.',
  'Watch the Connect lamp. When it stops blinking and stays on, the air conditioner is on your Wi‑Fi. This can take up to a minute.',
  'Come back here and tap Find my air conditioner.',
];
const SENT_TIPS = [
  'Still blinking after a minute? The Wi‑Fi name or password was probably off. Names and passwords are case sensitive.',
  'Use the 2.4 GHz network. Many routers show two names: the one ending in -G or -g is 2.4 GHz, the one ending in -A or -a is 5 GHz.',
  'Then hold Stop again and repeat the setup, or try the router button method.',
];

export default function Setup() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { setSignedIn } = useSession();
  const [step, setStep] = useState<Step>('choose');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<HostInfo | null>(null);
  const [ssid, setSsid] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);

  async function work(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e)); // stays on screen (and can be copied), unlike a toast
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    setError(null);
    const prev = back[step];
    if (prev) setStep(prev);
    else if (router.canGoBack()) router.back();
    else router.replace('/sign-in'); // opened without history (e.g. from a link): go to the first screen
  }

  const find = () => work(async () => {
    await client.signIn('local');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSignedIn(true);
  });

  const check = () => work(async () => {
    setInfo(await hostInfo());
    setStep('details');
  });

  const send = () => work(async () => {
    if (!ssid) throw new Error('Enter your home Wi‑Fi name');
    if (pass && pass.length < 8) throw new Error('Wi‑Fi passwords are at least 8 characters');
    await sendWifi(ssid.replace(/^\s+|\s+$/g, ''), pass);
    setPass(''); // never kept after it's handed over
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep('sent');
  });

  const title = { choose: 'Set up Wi‑Fi', wps: 'Router button', join: "Air conditioner's Wi‑Fi", details: 'Your home Wi‑Fi', sent: 'Almost done' }[step];
  const action: Record<Step, { label: string; icon: SFSymbol; onPress: () => void } | null> = {
    choose: null,
    wps: { label: 'Find my air conditioner', icon: 'magnifyingglass', onPress: find },
    join: { label: "I've joined it", icon: 'arrow.right', onPress: check },
    details: { label: 'Send to air conditioner', icon: 'paperplane', onPress: send },
    sent: { label: 'Find my air conditioner', icon: 'magnifyingglass', onPress: find },
  };
  const primary = action[step];

  const input = {
    fontFamily: fonts.regular, fontSize: 16, color: t.text, minHeight: 52, paddingHorizontal: sp.m,
  } as const;

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <View style={{ paddingTop: insets.top + sp.s, paddingHorizontal: sp.m, flexDirection: 'row', alignItems: 'center', gap: sp.m }}>
        <GlassButton
          icon="chevron.left"
          accessibilityLabel="Back"
          onPress={goBack}
        />
        <T weight="semibold" size={17} numberOfLines={1} style={{ flex: 1 }}>{title}</T>
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: sp.l, gap: sp.l }}>
        {step === 'choose' && (
          <>
            <T size={17} muted style={{ lineHeight: 25 }}>
              Put a new air conditioner on your home Wi‑Fi. You only need to do this once.
            </T>
            {([
              ['wifi.router', 'Router button', 'Quickest. Your router needs a Wi‑Fi pairing button.', 'wps'],
              ['antenna.radiowaves.left.and.right', "Air conditioner's own Wi‑Fi", "Works with any router. You'll type your Wi‑Fi password.", 'join'],
            ] as const).map(([icon, name, text, next]) => (
              <Pressable key={next} accessibilityRole="button" onPress={() => { tap(); setError(null); setStep(next); }}>
                <Glass interactive style={{ padding: sp.m, flexDirection: 'row', alignItems: 'center', gap: sp.m, minHeight: 72 }}>
                  <SymbolView name={icon} size={24} tintColor={t.mode.cool} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T weight="semibold">{name}</T>
                    <T muted size={14}>{text}</T>
                  </View>
                  <SymbolView name="chevron.right" size={14} tintColor={t.muted} />
                </Glass>
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" disabled={busy} onPress={find} style={{ minHeight: 44, justifyContent: 'center' }}>
              <T muted size={15}>Already on your Wi‑Fi? <T size={15} weight="medium" color={t.mode.cool}>Find it</T></T>
            </Pressable>
          </>
        )}

        {step === 'wps' && (
          <>
            <NumberedSteps items={WPS_STEPS} />
            <Pressable accessibilityRole="button" onPress={() => setStep('join')} style={{ minHeight: 44, justifyContent: 'center' }}>
              <T muted size={14}>
                {"Lamp didn't stay on, or no pairing button? "}
                <T size={14} weight="medium" color={t.mode.cool}>{"Use the air conditioner's own Wi‑Fi"}</T>
              </T>
            </Pressable>
          </>
        )}

        {step === 'join' && <NumberedSteps items={JOIN_STEPS} />}

        {step === 'details' && (
          <>
            {info && (
              <Glass style={{ padding: sp.m, flexDirection: 'row', alignItems: 'center', gap: sp.m }}>
                <SymbolView name="checkmark.circle.fill" size={22} tintColor={t.mode.dry} />
                <View style={{ flex: 1 }}>
                  <T weight="semibold">{info.model ? `Found ${info.model}` : 'Found your air conditioner'}</T>
                  {!!info.mac && <T muted size={13}>{info.mac}</T>}
                </View>
              </Glass>
            )}
            <T muted size={14} style={{ lineHeight: 20 }}>
              {info?.wifi5g
                ? 'Enter the Wi‑Fi this air conditioner should join.'
                : 'Enter your 2.4 GHz Wi‑Fi. This air conditioner cannot join a 5 GHz network. If your router shows two names, use the one ending in -G or -g.'}
            </T>
            <Glass style={{ paddingVertical: sp.xs }}>
              <TextInput
                value={ssid}
                onChangeText={setSsid}
                placeholder="Wi‑Fi name"
                placeholderTextColor={t.muted}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                returnKeyType="next"
                style={input}
              />
              <View style={{ height: 1, backgroundColor: t.line, marginHorizontal: sp.m }} />
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TextInput
                  value={pass}
                  onChangeText={setPass}
                  placeholder="Password"
                  placeholderTextColor={t.muted}
                  secureTextEntry={!showPass}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  textContentType="password"
                  returnKeyType="send"
                  onSubmitEditing={send}
                  style={[input, { flex: 1 }]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={showPass ? 'Hide password' : 'Show password'}
                  onPress={() => setShowPass((v) => !v)}
                  style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}
                >
                  <SymbolView name={showPass ? 'eye.slash' : 'eye'} size={20} tintColor={t.muted} />
                </Pressable>
              </View>
            </Glass>
            <T muted size={13} style={{ lineHeight: 19 }}>
              Your password goes only to the air conditioner, encrypted with its own key. This app does not keep it.
            </T>
          </>
        )}

        {error && (
          <Glass style={{ padding: sp.m, flexDirection: 'row', gap: sp.m }}>
            <SymbolView name="exclamationmark.triangle" size={20} tintColor={t.mode.heat} />
            <T selectable size={14} style={{ flex: 1, lineHeight: 20 }}>{error}</T>
          </Glass>
        )}

        {step === 'sent' && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp.m }}>
              <SymbolView name="checkmark.circle.fill" size={32} tintColor={t.mode.dry} />
              <T weight="semibold" size={20}>Sent to your air conditioner</T>
            </View>
            <NumberedSteps items={SENT_STEPS} />
            <View style={{ gap: sp.s }}>
              {SENT_TIPS.map((tip) => (
                <View key={tip} style={{ flexDirection: 'row', gap: sp.s }}>
                  <T muted size={14} style={{ lineHeight: 20 }}>•</T>
                  <T muted size={14} style={{ flex: 1, lineHeight: 20 }}>{tip}</T>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {primary && (
        <View style={{ paddingHorizontal: sp.l, paddingTop: sp.s, paddingBottom: insets.bottom + sp.m, height: 56 + sp.s + insets.bottom + sp.m, justifyContent: 'center' }}>
          {busy ? (
            <ActivityIndicator color={t.text} />
          ) : (
            <GlassButton label={primary.label} icon={primary.icon} size={56} tint={t.mode.cool} color="#FFFFFF" onPress={primary.onPress} />
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
