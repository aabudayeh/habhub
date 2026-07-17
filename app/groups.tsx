import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { useCloudSync } from '@/src/cloud/CloudSyncProvider';
import { isCloudGroupId } from '@/src/cloud/groupCloud';
import { Avatar, Button, Card, IconButton, PageHeader, Screen, SectionHeader } from '@/src/components/ui';
import { useApp } from '@/src/state/AppProvider';
import { palette } from '@/src/theme';

export default function GroupsScreen() {
  const { state, createGroup, joinGroup, switchGroup, leaveGroup } = useApp();
  const auth = useAuth();
  const cloud = useCloudSync();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create'|'join'|'switch'|'leave'|null>(null);
  const activeMember = state.group.members.find((member) => member.id === state.currentUserId);
  const canManage = activeMember?.role === 'owner' || activeMember?.role === 'admin';

  async function create() {
    if (!name.trim()) return Alert.alert('Name your group', 'Enter a group name first.');
    setBusy('create');
    try { if(auth.status==='signedIn') await cloud.createGroup(name); else createGroup(name); setName(''); }
    catch(error){Alert.alert('Could not create group',error instanceof Error?error.message:'Try again.');}
    finally{setBusy(null);}
  }
  async function join() {
    if (!code.trim()) return Alert.alert('Invite code needed', 'Enter the code a friend shared with you.');
    setBusy('join');
    try { if(auth.status==='signedIn') await cloud.joinGroup(code); else joinGroup(code); setCode(''); }
    catch(error){Alert.alert('Could not join group',error instanceof Error?error.message:'Check the invite code and try again.');}
    finally{setBusy(null);}
  }
  async function invite() {
    await Share.share({ message: `Join ${state.group.name} on Paceboard with code ${state.group.inviteCode}` });
  }
  function confirmLeave(groupId: string, groupName: string) {
    if (state.groups.length <= 1) return Alert.alert('Keep one group', 'Create or join another group before leaving this one.');
    Alert.alert(`Leave ${groupName}?`, 'You will stop seeing this group until you join it again.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: () => {
        if(auth.status==='signedIn'&&isCloudGroupId(groupId)){setBusy('leave');cloud.leaveGroup(groupId).catch((error)=>Alert.alert('Could not leave group',error instanceof Error?error.message:'Try again.')).finally(()=>setBusy(null));}
        else leaveGroup(groupId);
      } },
    ]);
  }

  return <Screen keyboardShouldPersistTaps="handled">
    <PageHeader eyebrow="Memberships" title="Your groups" subtitle="Switch groups without losing your personal logs." showMenu={false} action={<IconButton icon="close" label="Close" onPress={() => router.back()} />} />
    <View style={styles.list}>{state.groups.map((group) => {
      const active = group.id === state.group.id;
      const currentMember = group.members.find((member) => member.id === state.currentUserId);
      return <Pressable key={group.id} disabled={busy==='switch'} onPress={() => {if(auth.status==='signedIn'&&isCloudGroupId(group.id)){setBusy('switch');cloud.switchGroup(group.id).catch((error)=>Alert.alert('Could not open group',error instanceof Error?error.message:'Try again.')).finally(()=>setBusy(null));}else switchGroup(group.id);}}>
        <Card style={[styles.groupCard, active && styles.activeCard]}>
          <View style={styles.groupIcon}><Ionicons name="people" size={21} color={active ? palette.white : palette.primary} /></View>
          <View style={styles.copy}><Text style={styles.groupName}>{group.name}</Text><Text style={styles.meta}>{group.members.length} member{group.members.length === 1 ? '' : 's'} · {currentMember?.role === 'owner' ? 'Admin' : 'Member'} · {group.inviteCode}</Text></View>
          {active ? <View style={styles.active}><Text style={styles.activeText}>ACTIVE</Text></View> : <Ionicons name="chevron-forward" size={18} color={palette.faint} />}
          <Pressable accessibilityLabel={`Leave ${group.name}`} onPress={() => confirmLeave(group.id, group.name)} style={styles.leave}><Ionicons name="exit-outline" size={18} color={palette.red} /></Pressable>
        </Card>
      </Pressable>;
    })}</View>

    <Card style={styles.inviteCard}><View style={styles.inviteTop}><Avatar initials={state.group.name.slice(0, 2).toUpperCase()} color={palette.primary} /><View style={styles.copy}><Text style={styles.cardTitle}>{state.group.name}</Text><Text style={styles.meta}>Share code {state.group.inviteCode}{canManage ? ' · You can manage this group' : ''}</Text></View></View><View style={styles.groupButtons}><View style={styles.buttonGrow}><Button label="Share invitation" icon="share-outline" variant="secondary" onPress={invite} /></View>{canManage ? <View style={styles.buttonGrow}><Button label="Group settings" icon="settings-outline" onPress={() => router.push('/group-settings' as never)} /></View> : null}</View></Card>

    <SectionHeader title="Create a group" />
    <Card><TextInput value={name} onChangeText={setName} placeholder="e.g. Office Step League" placeholderTextColor={palette.faint} style={styles.input} /><Button label={auth.status==='signedIn'?"Create cloud group":"Create and switch"} icon="add" loading={busy==='create'} onPress={create} /></Card>
    <SectionHeader title="Join with a code" />
    <Card><TextInput value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="PACE-7K2M" placeholderTextColor={palette.faint} style={styles.input} /><Button label="Join and switch" icon="enter-outline" loading={busy==='join'} onPress={join} /></Card>
    <Text style={styles.note}>In cloud mode, invite codes resolve the real group, members, scoring rules, and permissions. Demo mode keeps these group memberships on this device.</Text>
  </Screen>;
}

const styles = StyleSheet.create({
  list:{gap:9},groupCard:{flexDirection:'row',alignItems:'center',gap:11,padding:13},activeCard:{borderColor:'#ABD8BE',backgroundColor:'#F4FBF7'},groupIcon:{width:42,height:42,borderRadius:14,backgroundColor:palette.primarySoft,alignItems:'center',justifyContent:'center'},copy:{flex:1},groupName:{color:palette.ink,fontSize:15,fontWeight:'900'},meta:{color:palette.muted,fontSize:10,lineHeight:15,marginTop:3},active:{backgroundColor:palette.primary,borderRadius:9,paddingHorizontal:7,paddingVertical:4},activeText:{color:palette.white,fontSize:8,fontWeight:'900',letterSpacing:.8},leave:{padding:8},inviteCard:{marginTop:14,gap:14},inviteTop:{flexDirection:'row',alignItems:'center',gap:11},groupButtons:{flexDirection:'row',flexWrap:'wrap',gap:8},buttonGrow:{flex:1,minWidth:145},cardTitle:{color:palette.ink,fontSize:14,fontWeight:'900'},input:{height:48,borderWidth:1,borderColor:palette.border,borderRadius:14,paddingHorizontal:13,color:palette.ink,fontSize:14,marginBottom:10},note:{color:palette.muted,fontSize:10,lineHeight:15,marginTop:14,textAlign:'center'},
});
