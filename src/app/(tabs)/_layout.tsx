import { NativeTabs } from 'expo-router/native-tabs';
import { fonts, useTheme } from '../../ui';

// Apple's own tab bar (liquid glass on iOS 26).
export default function TabsLayout() {
  const t = useTheme();
  return (
    <NativeTabs tintColor={t.mode.cool} labelStyle={{ fontFamily: fonts.medium, fontSize: 11 }} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'snowflake', selected: 'snowflake' }} />
        <NativeTabs.Trigger.Label>Controls</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="schedule">
        <NativeTabs.Trigger.Icon sf={{ default: 'clock', selected: 'clock.fill' }} />
        <NativeTabs.Trigger.Label>Schedule</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="favorites">
        <NativeTabs.Trigger.Icon sf={{ default: 'star', selected: 'star.fill' }} />
        <NativeTabs.Trigger.Label>Favorites</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
