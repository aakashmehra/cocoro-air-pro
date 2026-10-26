import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { client } from '../api/client';
import type { Device } from '../api/types';
import { SessionContext } from '../session';
import { Toasts, useTheme } from '../ui';

export default function RootLayout() {
  const t = useTheme();
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    client.isSignedIn().then(setSignedIn, () => setSignedIn(false));
  }, []);

  if (!fontsLoaded || signedIn === null) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  const navTheme = t.dark ? DarkTheme : DefaultTheme;
  return (
    <SessionContext.Provider value={{ signedIn, setSignedIn, devices, setDevices, deviceId, setDeviceId }}>
      <ThemeProvider value={{ ...navTheme, colors: { ...navTheme.colors, background: t.bg } }}>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="sign-in" />
            <Stack.Screen name="setup" />
          </Stack.Protected>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(tabs)" />
          </Stack.Protected>
        </Stack>
        <Toasts />
      </ThemeProvider>
    </SessionContext.Provider>
  );
}
