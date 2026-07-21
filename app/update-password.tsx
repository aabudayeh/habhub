import { Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, StyleSheet,} from 'react-native';
import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";

import { useAuth } from '@/src/auth/AuthProvider';
import { Button, Card, PageHeader, Screen } from '@/src/components/ui';
import { palette } from '@/src/theme';

export default function UpdatePasswordScreen(){
  const auth=useAuth();const [password,setPassword]=useState('');const [confirm,setConfirm]=useState('');const [busy,setBusy]=useState(false);
  if(auth.status==='signedOut')return <Redirect href={'/sign-in' as never}/>;
  async function save(){if(password.length<8)return Alert.alert('Password is too short','Use at least 8 characters.');if(password!==confirm)return Alert.alert('Passwords do not match','Enter the same password twice.');setBusy(true);try{await auth.updatePassword(password);Alert.alert('Password updated','Your new password is ready.');router.replace('/' as never);}catch(error){Alert.alert('Could not update password',error instanceof Error?error.message:'Try again.');}finally{setBusy(false);}}
  return <Screen keyboardShouldPersistTaps="handled"><PageHeader eyebrow="Account recovery" title="Choose a new password" subtitle="This secure screen was opened from your reset link." showMenu={false}/><Card><Text style={styles.label}>New password</Text><TextInput value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" placeholder="At least 8 characters" placeholderTextColor={palette.faint} style={styles.input}/><Text style={styles.label}>Confirm password</Text><TextInput value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" placeholder="Repeat password" placeholderTextColor={palette.faint} style={styles.input}/><Button label="Update password" icon="lock-closed-outline" loading={busy} onPress={save}/></Card></Screen>;
}

const styles=StyleSheet.create({label:{fontSize:9,fontWeight:'900',letterSpacing:.5,color:palette.muted,marginBottom:5,textTransform:'uppercase'},input:{borderWidth:1,borderColor:palette.border,borderRadius:13,paddingHorizontal:13,paddingVertical:12,color:palette.ink,marginBottom:14}});
