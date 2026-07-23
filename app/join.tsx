import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { AppText as Text } from "@/src/components/AppText";

import { useAuth } from '@/src/auth/AuthProvider';
import { useCloudSync } from '@/src/cloud/CloudSyncProvider';
import { Button, Card, Screen } from '@/src/components/ui';
import { useApp } from '@/src/state/AppProvider';
import { palette } from '@/src/theme';
import { clearPendingInvite, rememberPendingInvite } from '@/src/domain/invites';

export default function JoinGroupScreen() {
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const code = (Array.isArray(params.code) ? params.code[0] : params.code ?? '').trim().toUpperCase();
  const auth = useAuth();
  const cloud = useCloudSync();
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const attempted = useRef(false);

  const join = useCallback(async () => {
    if (!code) return Alert.alert('Invalid invitation', 'This invitation is missing its group code.');
    if (auth.status === 'signedOut') {
      await rememberPendingInvite(code);
      return router.replace({ pathname: '/sign-in', params: { invite: code } });
    }
    setBusy(true);
    try {
      const result = auth.status === 'signedIn' ? await cloud.joinGroup(code) : (app.joinGroup(code), 'active' as const);
      if (result === 'pending') {
        Alert.alert('Request sent', 'You will enter the group as soon as an admin approves you.');
      } else {
        await clearPendingInvite();
      }
      router.replace('/');
    } catch (error) {
      const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Check that the invitation is still valid.';
      Alert.alert('Could not join group', message);
    } finally { setBusy(false); }
  }, [app, auth.status, cloud, code]);

  useEffect(() => {
    if (!code || attempted.current || (auth.status !== 'signedIn' && auth.status !== 'demo')) return;
    attempted.current = true;
    void join();
  }, [auth.status, code, join]);

  return <Screen contentContainerStyle={styles.screen}><Card style={styles.card}>
    <View style={styles.icon}><Ionicons name="people" size={30} color={palette.white}/></View>
    <Text style={styles.title}>You’re invited</Text>
    <Text style={styles.body}>Join this MetricRally group to share the progress you choose, chat, and compete.</Text>
    <View style={styles.code}><Text style={styles.codeLabel}>INVITE CODE</Text><Text style={styles.codeValue}>{code || 'Missing'}</Text></View>
    <Button label={auth.status === 'signedOut' ? 'Sign in to join' : busy ? 'Joining…' : 'Join group'} icon="enter-outline" loading={busy} onPress={join}/>
    <Button label="Not now" variant="ghost" onPress={() => router.replace('/')}/>
  </Card></Screen>;
}

const styles = StyleSheet.create({screen:{flexGrow:1,justifyContent:'center'},card:{alignItems:'center',gap:13,padding:24},icon:{width:58,height:58,borderRadius:20,backgroundColor:palette.primary,alignItems:'center',justifyContent:'center'},title:{fontSize:22,fontWeight:'900',color:palette.ink},body:{fontSize:12,lineHeight:18,color:palette.muted,textAlign:'center'},code:{alignSelf:'stretch',backgroundColor:palette.canvas,borderRadius:15,padding:14,alignItems:'center'},codeLabel:{fontSize:8,fontWeight:'900',letterSpacing:1.2,color:palette.faint},codeValue:{fontSize:18,fontWeight:'900',letterSpacing:1.5,color:palette.primary,marginTop:4}});
