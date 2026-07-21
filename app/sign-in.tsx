import { Ionicons } from '@expo/vector-icons';
import { Redirect, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";

import { Button, Card, Screen } from '@/src/components/ui';
import { useAuth } from '@/src/auth/AuthProvider';
import { palette } from '@/src/theme';

type Mode = 'sign-in' | 'sign-up' | 'magic';

export default function SignInScreen() {
  const auth = useAuth();
  const params = useLocalSearchParams<{ invite?: string }>();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  if (auth.status === 'loading') return <View style={styles.loading}><ActivityIndicator color={palette.primary} /></View>;
  if (auth.status === 'signedIn' || auth.status === 'demo') return <Redirect href={params.invite ? `/join?code=${encodeURIComponent(params.invite)}` : '/'} />;

  const validEmail = email.trim().includes('@');
  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    try { await action(); } catch (error) {
      Alert.alert('Could not continue', error instanceof Error ? error.message : 'Please try again.');
    } finally { setBusy(null); }
  }

  async function submit() {
    if (!validEmail) return Alert.alert('Check your email', 'Enter a valid email address.');
    if (mode !== 'magic' && password.length < 8) return Alert.alert('Password is too short', 'Use at least 8 characters.');
    if (mode === 'magic') {
      await run('email', async () => {
        await auth.sendMagicLink(email);
        Alert.alert('Check your inbox', 'Open the secure MetricRally link on this device.');
      });
      return;
    }
    if (mode === 'sign-up') {
      await run('email', async () => {
        const result = await auth.signUp(email, password);
        if (result === 'verification-required') Alert.alert('Verify your email', 'Use the link we sent, then return to MetricRally.');
      });
      return;
    }
    await run('email', () => auth.signInWithPassword(email, password));
  }

  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen keyboardShouldPersistTaps="handled" contentContainerStyle={styles.screen}>
      <View style={styles.brand}><View style={styles.mark}><Text style={styles.markText}>M</Text></View><Text style={styles.name}>MetricRally</Text><Text style={styles.tagline}>Track anything. Progress together.</Text></View>
      <Card style={styles.card}>
        <Text style={styles.title}>{mode === 'sign-up' ? 'Create your account' : mode === 'magic' ? 'Email sign-in link' : 'Welcome back'}</Text>
        <Text style={styles.subtitle}>Your private data stays available offline and syncs securely when you sign in.</Text>
        <View style={styles.tabs}>
          <Tab label="Sign in" selected={mode === 'sign-in'} onPress={() => setMode('sign-in')} />
          <Tab label="Create account" selected={mode === 'sign-up'} onPress={() => setMode('sign-up')} />
          <Tab label="Magic link" selected={mode === 'magic'} onPress={() => setMode('magic')} />
        </View>
        <Text style={styles.label}>Email</Text>
        <TextInput value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" placeholder="you@example.com" placeholderTextColor={palette.faint} style={styles.input} />
        {mode !== 'magic' ? <><Text style={styles.label}>Password</Text><TextInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} placeholder="At least 8 characters" placeholderTextColor={palette.faint} style={styles.input} /></> : null}
        <Button label={mode === 'sign-up' ? 'Create account' : mode === 'magic' ? 'Send secure link' : 'Sign in'} icon={mode === 'magic' ? 'mail-outline' : 'log-in-outline'} loading={busy === 'email'} onPress={submit} />
        {mode === 'sign-in' && validEmail ? <Pressable onPress={() => run('reset', async () => { await auth.requestPasswordReset(email); Alert.alert('Reset link sent', 'Check your inbox to choose a new password.'); })} style={styles.forgot}><Text style={styles.forgotText}>{busy === 'reset' ? 'Sending…' : 'Forgot password?'}</Text></Pressable> : null}
        <View style={styles.divider}><View style={styles.line}/><Text style={styles.or}>OR</Text><View style={styles.line}/></View>
        <View style={styles.providers}><View style={styles.provider}><Button label="Google" variant="ghost" icon="logo-google" loading={busy === 'google'} onPress={() => run('google', () => auth.signInWithProvider('google'))}/></View>{Platform.OS !== 'android' ? <View style={styles.provider}><Button label="Apple" variant="ghost" icon="logo-apple" loading={busy === 'apple'} onPress={() => run('apple', () => auth.signInWithProvider('apple'))}/></View> : null}</View>
      </Card>
      <Pressable onPress={() => run('demo', auth.continueInDemo)} style={styles.demo}><Ionicons name="flask-outline" size={17} color={palette.primary}/><View><Text style={styles.demoTitle}>Try the full demo first</Text><Text style={styles.demoText}>No account or cloud project required.</Text></View><Ionicons name="chevron-forward" size={16} color={palette.faint}/></Pressable>
      <Text style={styles.terms}>By continuing, you agree to the app’s privacy policy and terms configured by its operator.</Text>
    </Screen>
  </KeyboardAvoidingView>;
}

function Tab({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.tab, selected && styles.tabSelected]}><Text style={[styles.tabText, selected && styles.tabTextSelected]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  root:{flex:1,backgroundColor:palette.canvas},screen:{flexGrow:1,justifyContent:'center',paddingTop:48,paddingBottom:36},loading:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:palette.canvas},brand:{alignItems:'center',marginBottom:22},mark:{width:58,height:58,borderRadius:19,backgroundColor:palette.ink,alignItems:'center',justifyContent:'center'},markText:{color:palette.lime,fontSize:28,fontWeight:'900'},name:{fontSize:25,fontWeight:'900',color:palette.ink,marginTop:10,letterSpacing:-.6},tagline:{fontSize:12,color:palette.muted,marginTop:3},card:{padding:20},title:{fontSize:21,fontWeight:'900',color:palette.ink},subtitle:{fontSize:11,lineHeight:17,color:palette.muted,marginTop:4,marginBottom:16},tabs:{flexDirection:'row',backgroundColor:palette.canvas,borderRadius:12,padding:3,marginBottom:16},tab:{flex:1,alignItems:'center',paddingVertical:8,borderRadius:9},tabSelected:{backgroundColor:palette.white},tabText:{fontSize:9,fontWeight:'800',color:palette.muted},tabTextSelected:{color:palette.primary},label:{fontSize:9,fontWeight:'900',letterSpacing:.5,color:palette.muted,marginBottom:5,textTransform:'uppercase'},input:{borderWidth:1,borderColor:palette.border,borderRadius:13,paddingHorizontal:13,paddingVertical:12,color:palette.ink,marginBottom:13},forgot:{alignSelf:'center',padding:10},forgotText:{fontSize:10,fontWeight:'800',color:palette.primary},divider:{flexDirection:'row',alignItems:'center',gap:10,marginVertical:13},line:{height:1,backgroundColor:palette.border,flex:1},or:{fontSize:8,fontWeight:'900',color:palette.faint},providers:{flexDirection:'row',gap:8},provider:{flex:1},demo:{flexDirection:'row',alignItems:'center',gap:11,marginTop:14,padding:15,borderWidth:1,borderColor:palette.border,borderRadius:17,backgroundColor:palette.white},demoTitle:{fontSize:11,fontWeight:'900',color:palette.ink},demoText:{fontSize:9,color:palette.muted,marginTop:2},terms:{fontSize:8,lineHeight:13,textAlign:'center',color:palette.faint,marginHorizontal:24,marginTop:14},
});
