import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { EnergyProfileEditor, MetricGoalsEditor } from '@/src/components/ProfileEditors';
import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";
import { Avatar, Button, Card, IconButton, PageHeader, Screen, SectionHeader } from '@/src/components/ui';
import { memberDisplayName, memberOriginalLabel, memberRoleLabel } from '@/src/domain/members';
import { useApp } from '@/src/state/AppProvider';
import { palette, useAppColors, useGroupAccent } from '@/src/theme';

export default function ProfileScreen(){
  const {state,updateMemberAvatar,updateMemberName}=useApp();
  const colors=useAppColors();
  const accent=useGroupAccent();
  const me=state.group.members.find((member)=>member.id===state.currentUserId)!;
  const vacationActive=(state.settings.vacationPeriods??[]).some((period)=>!period.to);
  const [name,setName]=useState(me.name);
  async function choosePhoto(){
    const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],quality:.8,base64:Platform.OS==='web'});
    if(result.canceled)return;
    const asset=result.assets[0];
    updateMemberAvatar(me.id,asset.base64?`data:${asset.mimeType??'image/jpeg'};base64,${asset.base64}`:asset.uri);
  }
  return <Screen keyboardShouldPersistTaps="handled">
    <PageHeader eyebrow="Personal" title="My profile" subtitle="Your photo, body and energy profile, and personal metric goals." showMenu={false} action={<IconButton icon="close" label="Close" onPress={()=>router.back()}/>}/>
    <Card style={styles.identity}>
      <View><Avatar initials={me.initials} color={accent} size={72} uri={me.avatarUri}/><Pressable onPress={choosePhoto} style={[styles.camera,{backgroundColor:accent,borderColor:colors.card}]}><Ionicons name="camera" size={15} color={palette.white}/></Pressable></View>
      <View style={styles.copy}><Text style={[styles.name,{color:colors.ink}]}>{memberDisplayName(state,me)}</Text>{memberOriginalLabel(state,me)?<Text style={[styles.original,{color:colors.faint}]}>{memberOriginalLabel(state,me)}</Text>:null}<Text style={[styles.meta,{color:colors.muted}]}>{memberRoleLabel(me)} in {state.group.name}</Text></View>
      {me.avatarUri?<Pressable accessibilityLabel="Remove profile photo" onPress={()=>updateMemberAvatar(me.id,undefined)} style={styles.remove}><Ionicons name="trash-outline" size={18} color={palette.red}/></Pressable>:null}
    </Card>
    <Card style={styles.nameCard}><View style={styles.copy}><Text style={[styles.fieldLabel,{color:colors.muted}]}>Account display name</Text><TextInput value={name} onChangeText={setName} maxLength={40} placeholder="Your name" placeholderTextColor={colors.faint} style={[styles.input,{color:colors.ink,borderColor:colors.border}]}/></View><Button label="Save" variant="ghost" onPress={()=>updateMemberName(me.id,name)}/></Card>
    <Text style={[styles.note,{color:colors.muted}]}>Your account name comes from your profile. Friend nicknames are set separately inside each group.</Text>
    <EnergyProfileEditor/>
    <MetricGoalsEditor/>
    <SectionHeader title="More profile details"/>
    <Pressable onPress={()=>router.push('/vacation')} style={[styles.linkCard,{backgroundColor:colors.card,borderColor:vacationActive?'#E76FA8':colors.border}]}><View style={[styles.linkIcon,{backgroundColor:vacationActive?'#E76FA81C':colors.primarySoft}]}><Ionicons name="airplane-outline" size={21} color={vacationActive?'#E76FA8':accent}/></View><View style={styles.copy}><Text style={[styles.linkTitle,{color:colors.ink}]}>Vacation mode</Text><Text style={[styles.meta,{color:colors.muted}]}>{vacationActive?'Active · your streaks are protected':'Pause goal streaks without changing logged measurements.'}</Text></View><Ionicons name="chevron-forward" size={19} color={colors.faint}/></Pressable>
    <Pressable onPress={()=>router.push(`/member/${me.id}` as never)} style={[styles.linkCard,{backgroundColor:colors.card,borderColor:colors.border}]}><View style={[styles.linkIcon,{backgroundColor:colors.primarySoft}]}><Ionicons name="trophy-outline" size={21} color={accent}/></View><View style={styles.copy}><Text style={[styles.linkTitle,{color:colors.ink}]}>Public profile & badge showcase</Text><Text style={[styles.meta,{color:colors.muted}]}>Preview how you appear to friends and choose up to five featured badges.</Text></View><Ionicons name="chevron-forward" size={19} color={colors.faint}/></Pressable>
  </Screen>;
}

const styles=StyleSheet.create({identity:{flexDirection:'row',alignItems:'center',gap:13},nameCard:{flexDirection:'row',alignItems:'flex-end',gap:10,marginTop:10},copy:{flex:1},name:{color:palette.ink,fontSize:19,fontWeight:'900'},original:{color:palette.faint,fontSize:10,marginTop:2},meta:{color:palette.muted,fontSize:10,lineHeight:15,marginTop:3},fieldLabel:{fontSize:9,fontWeight:'900',textTransform:'uppercase',letterSpacing:.5,color:palette.muted,marginBottom:5},input:{borderWidth:1,borderColor:palette.border,borderRadius:12,paddingHorizontal:12,paddingVertical:10,color:palette.ink},camera:{position:'absolute',right:-3,bottom:-3,width:27,height:27,borderRadius:14,backgroundColor:palette.primary,alignItems:'center',justifyContent:'center',borderWidth:2,borderColor:palette.card},remove:{width:40,height:40,borderRadius:13,backgroundColor:'#FFF1F0',alignItems:'center',justifyContent:'center'},note:{color:palette.muted,fontSize:10,lineHeight:15,paddingHorizontal:7,marginTop:8},linkCard:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:palette.card,borderWidth:1,borderColor:palette.border,borderRadius:20,padding:15,marginBottom:8},linkIcon:{width:44,height:44,borderRadius:14,backgroundColor:palette.primarySoft,alignItems:'center',justifyContent:'center'},linkTitle:{color:palette.ink,fontSize:13,fontWeight:'900'}});
