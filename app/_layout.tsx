import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import 'react-native-reanimated';

import { AuthProvider, useAuth } from '@/src/auth/AuthProvider';
import { CloudSyncProvider, useCloudSync } from '@/src/cloud/CloudSyncProvider';
import { HealthSyncProvider } from '@/src/health/HealthSyncProvider';
import { AppProvider, useApp } from '@/src/state/AppProvider';
import { CompactModeProvider, DarkModeProvider, GroupAccentProvider, palette } from '@/src/theme';
import '@/src/notifications/push';

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: palette.canvas, primary: palette.primary, text: palette.ink },
};

export default function RootLayout() {
  return (
    <AuthProvider>
      <AppProvider>
        <HealthSyncProvider>
          <CloudSyncProvider>
            <RootNavigator />
          </CloudSyncProvider>
        </HealthSyncProvider>
      </AppProvider>
    </AuthProvider>
  );
}

function RootNavigator() {
  const auth = useAuth();
  const cloud = useCloudSync();
  const { state } = useApp();
  const segments = useSegments();
  const rootSegment = String(segments[0] ?? '');
  const inAuthRoute = rootSegment === 'sign-in' || rootSegment === 'auth-callback' || rootSegment === 'update-password' || rootSegment === 'join';

  if (auth.status === 'loading') {
    return <View style={styles.loading}><View style={styles.mark}><Text style={styles.initial}>P</Text></View><ActivityIndicator color={palette.primary}/></View>;
  }
  if (auth.status === 'signedIn' && (cloud.status === 'disabled' || cloud.status === 'initializing')) {
    return <View style={styles.loading}><View style={styles.mark}><Text style={styles.initial}>P</Text></View><ActivityIndicator color={palette.primary}/></View>;
  }
  if (auth.configured && auth.status === 'signedOut' && !inAuthRoute) return <Redirect href={'/sign-in' as never} />;
  if (auth.status === 'signedIn' && auth.passwordRecovery && rootSegment !== 'update-password') return <Redirect href={'/update-password' as never} />;

  const accent = state.group.themeColor ?? palette.primary;
  const activeTheme = { ...theme, dark:state.settings.darkMode, colors: { ...theme.colors, primary: accent,background:state.settings.darkMode?'#0F1411':palette.canvas,text:state.settings.darkMode?'#F1F5F2':palette.ink,card:state.settings.darkMode?'#18201B':palette.card,border:state.settings.darkMode?'#2B3730':palette.border } };
  return <GroupAccentProvider color={accent}><DarkModeProvider dark={state.settings.darkMode}><CompactModeProvider compact={state.settings.compactMode}><ThemeProvider value={activeTheme}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.canvas } }}>
          <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
          <Stack.Screen name="auth-callback" options={{ animation: 'fade' }} />
          <Stack.Screen name="update-password" options={{ presentation: 'modal' }} />
          <Stack.Screen name="join" options={{ presentation: 'modal' }} />
          <Stack.Screen name="food-search" options={{ presentation: 'modal' }} />
          <Stack.Screen name="metric-detail" options={{ presentation: 'modal' }} />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="customize" options={{ presentation: 'modal' }} />
          <Stack.Screen name="metric-editor" options={{ presentation: 'modal' }} />
          <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
          <Stack.Screen name="profile" options={{ presentation: 'modal' }} />
          <Stack.Screen name="notifications" options={{ presentation: 'modal' }} />
          <Stack.Screen name="group-settings" options={{ presentation: 'modal' }} />
          <Stack.Screen name="badges" options={{ presentation: 'modal' }} />
          <Stack.Screen name="alerts" options={{ presentation: 'modal' }} />
          <Stack.Screen name="recap" options={{ presentation: 'modal' }} />
          <Stack.Screen name="menu" options={{ presentation: 'transparentModal', animation: 'fade' }} />
          <Stack.Screen name="member/[id]" />
          <Stack.Screen name="day/[date]" />
          <Stack.Screen name="leaderboard-detail" />
          <Stack.Screen name="groups" options={{ presentation: 'modal' }} />
        </Stack>
        <StatusBar style="dark" />
      </ThemeProvider></CompactModeProvider></DarkModeProvider></GroupAccentProvider>
}

const styles = StyleSheet.create({loading:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:palette.canvas,gap:18},mark:{width:54,height:54,borderRadius:18,alignItems:'center',justifyContent:'center',backgroundColor:palette.ink},initial:{color:palette.lime,fontSize:26,fontWeight:'900'}});
