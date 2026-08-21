import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { EnergyProfileEditor, MetricGoalsEditor, StreakSettingsEditor } from '@/src/components/ProfileEditors';
import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";
import { Avatar, Card, IconButton, PageHeader, Screen } from '@/src/components/ui';
import { memberRoleLabel } from '@/src/domain/members';
import { useLocalization } from '@/src/i18n';
import { useApp } from '@/src/state/AppProvider';
import { useTutorialSandboxActive } from '@/src/tutorial/TutorialSandboxContext';
import { palette, useAppColors, useGroupAccent } from '@/src/theme';

export default function ProfileScreen(){
  const tutorialSandbox=useTutorialSandboxActive();
  const {state,updateMemberAvatar,updateMemberName}=useApp();
  const colors=useAppColors();
  const accent=useGroupAccent();
  const {t}=useLocalization();
  const me=state.group.members.find((member)=>member.id===state.currentUserId)!;
  const [name,setName]=useState(me.name);
  const [editingName,setEditingName]=useState(false);
  useEffect(()=>{
    if(!editingName)setName(me.name);
  },[editingName,me.name]);
  function saveName(){
    const next=name.trim();
    if(!next)return;
    updateMemberName(me.id,next);
    setName(next);
    setEditingName(false);
  }
  function cancelName(){
    setName(me.name);
    setEditingName(false);
  }
  async function choosePhoto(){
    if(tutorialSandbox)return;
    const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],quality:.8,base64:Platform.OS==='web'});
    if(result.canceled)return;
    const asset=result.assets[0];
    updateMemberAvatar(me.id,asset.base64?`data:${asset.mimeType??'image/jpeg'};base64,${asset.base64}`:asset.uri);
  }
  return <Screen keyboardShouldPersistTaps="handled">
    <PageHeader eyebrow="Personal" title="My profile" subtitle="Your photo, body and energy profile, and tracked goals." showMenu={false} action={<IconButton icon="close" label="Close" onPress={()=>router.back()}/>}/>
    <Card style={styles.identity}>
      <View style={styles.identityRow}>
        <View><Avatar initials={me.initials} color={accent} size={72} uri={me.avatarUri}/><Pressable accessibilityRole="button" accessibilityLabel={t("Edit")} onPress={choosePhoto} style={[styles.camera,{backgroundColor:accent,borderColor:colors.card}]}><Ionicons name="camera" size={15} color={palette.white}/></Pressable></View>
        <View style={styles.copy}><Text translate={false} style={[styles.name,{color:colors.ink}]}>{me.name}</Text><Text style={[styles.meta,{color:colors.muted}]}>{memberRoleLabel(me)} in <Text translate={false}>{state.group.name}</Text></Text></View>
        <View style={styles.identityActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${t("Edit")} ${t("Account display name")}`} onPress={()=>setEditingName(true)} style={({pressed})=>[styles.smallAction,{backgroundColor:colors.primarySoft},pressed&&styles.pressed]}><Ionicons name="pencil-outline" size={17} color={accent}/></Pressable>
          {me.avatarUri?<Pressable accessibilityRole="button" accessibilityLabel="Remove profile photo" onPress={()=>updateMemberAvatar(me.id,undefined)} style={({pressed})=>[styles.smallAction,styles.remove,pressed&&styles.pressed]}><Ionicons name="trash-outline" size={17} color={palette.red}/></Pressable>:null}
        </View>
      </View>
      {editingName?<View style={[styles.nameEditor,{borderTopColor:colors.border}]}>
        <Text style={[styles.fieldLabel,{color:colors.muted}]}>Account display name</Text>
        <View style={styles.nameEditorRow}>
          <TextInput autoFocus value={name} onChangeText={setName} onSubmitEditing={saveName} returnKeyType="done" maxLength={40} placeholder="Your name" placeholderTextColor={colors.faint} style={[styles.input,{color:colors.ink,borderColor:colors.border}]}/>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Save")} disabled={!name.trim()} onPress={saveName} style={({pressed})=>[styles.editorAction,{backgroundColor:accent},!name.trim()&&styles.disabled,pressed&&styles.pressed]}><Ionicons name="checkmark" size={20} color={palette.white}/></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t("Cancel")} onPress={cancelName} style={({pressed})=>[styles.editorAction,{backgroundColor:colors.primarySoft},pressed&&styles.pressed]}><Ionicons name="close" size={20} color={colors.muted}/></Pressable>
        </View>
      </View>:null}
    </Card>
    <EnergyProfileEditor/>
    <MetricGoalsEditor/>
    <StreakSettingsEditor/>
    <Pressable onPress={()=>router.push(`/member/${me.id}` as never)} style={[styles.linkCard,{backgroundColor:colors.card,borderColor:colors.border}]}><View style={[styles.linkIcon,{backgroundColor:colors.primarySoft}]}><Ionicons name="trophy-outline" size={21} color={accent}/></View><View style={styles.copy}><Text style={[styles.linkTitle,{color:colors.ink}]}>Public profile & badge showcase</Text><Text style={[styles.meta,{color:colors.muted}]}>Preview how you appear to friends and choose up to five featured badges.</Text></View><Ionicons name="chevron-forward" size={19} color={colors.faint}/></Pressable>
  </Screen>;
}

const styles=StyleSheet.create({identity:{gap:12},identityRow:{flexDirection:'row',alignItems:'center',gap:13},identityActions:{alignItems:'center',gap:7},smallAction:{width:34,height:34,borderRadius:11,alignItems:'center',justifyContent:'center'},copy:{flex:1},name:{color:palette.ink,fontSize:19,fontWeight:'900'},original:{color:palette.faint,fontSize:10,marginTop:2},meta:{color:palette.muted,fontSize:10,lineHeight:15,marginTop:3},nameEditor:{borderTopWidth:StyleSheet.hairlineWidth,paddingTop:12},nameEditorRow:{flexDirection:'row',alignItems:'center',gap:8},fieldLabel:{fontSize:9,fontWeight:'900',textTransform:'uppercase',letterSpacing:.5,color:palette.muted,marginBottom:5},input:{flex:1,borderWidth:1,borderColor:palette.border,borderRadius:12,paddingHorizontal:12,paddingVertical:10,color:palette.ink},editorAction:{width:40,height:40,borderRadius:12,alignItems:'center',justifyContent:'center'},disabled:{opacity:.45},pressed:{opacity:.72,transform:[{scale:.97}]},camera:{position:'absolute',right:-3,bottom:-3,width:27,height:27,borderRadius:14,backgroundColor:palette.primary,alignItems:'center',justifyContent:'center',borderWidth:2,borderColor:palette.card},remove:{backgroundColor:'#FFF1F0'},linkCard:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:palette.card,borderWidth:1,borderColor:palette.border,borderRadius:20,padding:15,marginBottom:8},linkIcon:{width:44,height:44,borderRadius:14,backgroundColor:palette.primarySoft,alignItems:'center',justifyContent:'center'},linkTitle:{color:palette.ink,fontSize:13,fontWeight:'900'}});
