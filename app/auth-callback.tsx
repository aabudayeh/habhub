import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { palette } from '@/src/theme';

export default function AuthCallbackScreen() {
  const { status } = useAuth();
  if (status === 'signedIn') return <Redirect href="/" />;
  if (status === 'signedOut') return <Redirect href={'/sign-in' as never} />;
  return <View style={styles.root}><ActivityIndicator color={palette.primary}/><Text style={styles.text}>Securing your session…</Text></View>;
}

const styles = StyleSheet.create({root:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:palette.canvas,gap:11},text:{fontSize:11,fontWeight:'800',color:palette.muted}});
