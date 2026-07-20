import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { MetricSelector } from '@/src/components/MetricSelector';
import { MonthCalendar } from '@/src/components/MonthCalendar';
import { Avatar, Card, PageHeader, ProgressBar, Screen } from '@/src/components/ui';
import { dateKey, dateKeyWithOffset, relativeTime } from '@/src/domain/date';
import { groupInviteMessage } from '@/src/domain/invites';
import { LeaderboardPeriod, leaderboardRows, periodDates, periodTitle } from '@/src/domain/leaderboard';
import { memberDisplayName, memberOriginalLabel } from '@/src/domain/members';
import { useApp } from '@/src/state/AppProvider';
import { palette, useAppColors, useGroupAccent } from '@/src/theme';

const SCORE_ID='__score';

export default function LeaderboardScreen() {
  const { state,updateSettings }=useApp();
  const colors=useAppColors();const accent=useGroupAccent();
  const [period,setPeriod]=useState<LeaderboardPeriod>('today');
  const [anchor,setAnchor]=useState(dateKey());
  const [calendarOpen,setCalendarOpen]=useState(false);
  const tracked=state.metrics.filter((metric)=>metric.scoreWeight>0&&metric.dataType!=='text'&&metric.sections.group);
  const [selectedIds,setSelectedIds]=useState<string[]>(state.settings.leaderboardMetricIdsByGroup?.[state.group.id]??[state.selectedGroupMetricId||SCORE_ID]);
  const dates=useMemo(()=>periodDates(period,anchor),[anchor,period]);

  function choosePeriod(next:LeaderboardPeriod){setPeriod(next);if(next==='today')setAnchor(dateKey());if(next==='yesterday')setAnchor(dateKeyWithOffset(-1));setCalendarOpen(next==='custom');}
  async function invite(){await Share.share({message:groupInviteMessage(state.group.name,state.group.inviteCode)});}
  const selectorOptions=[{id:SCORE_ID,label:'Overall score',icon:'speedometer-outline' as const,color:palette.purple},...tracked.map((metric)=>({id:metric.id,label:metric.name,icon:metric.icon as keyof typeof Ionicons.glyphMap,color:metric.color}))];
  const periodOptions=[{id:'today',label:'Today',icon:'today-outline' as const},{id:'yesterday',label:'Yesterday',icon:'play-back-outline' as const},{id:'week',label:'Last 7 days',icon:'calendar-outline' as const},{id:'month',label:'This month',icon:'calendar-number-outline' as const},{id:'custom',label:'Pick a date',icon:'calendar-clear-outline' as const}];

  return <Screen>
    <PageHeader eyebrow={state.group.templateName} title="Leaderboard" subtitle={`${state.group.name} · ${state.group.members.length} friends`} action={<View style={styles.headerActions}><Pressable accessibilityLabel="Open alerts" onPress={()=>router.push('/alerts' as never)} style={[styles.bell,{backgroundColor:colors.primarySoft}]}><Ionicons name="notifications-outline" size={19} color={accent}/><View style={styles.alertDot}/></Pressable><Pressable onPress={invite} style={[styles.invite,{backgroundColor:colors.primarySoft,borderColor:colors.border}]}><Ionicons name="person-add-outline" size={17} color={accent}/><Text style={[styles.inviteText,{color:accent}]}>Invite</Text></Pressable></View>}/>
    <View style={styles.groupActions}><Pressable onPress={()=>router.push('/groups' as never)} style={styles.inline}><Ionicons name="swap-horizontal" size={17} color={accent}/><Text style={[styles.link,{color:accent}]}>Switch or manage groups</Text></Pressable><Pressable onPress={()=>router.push('/recap?scope=group' as never)} style={styles.inline}><Ionicons name="sparkles-outline" size={17} color={accent}/><Text style={[styles.link,{color:accent}]}>Group recap</Text></Pressable><Text style={[styles.code,{color:colors.faint}]}>{state.group.inviteCode}</Text></View>
    <Card style={styles.controls}>
      <MetricSelector title="Time range" items={periodOptions} selectedIds={[period]} onChange={(ids)=>choosePeriod(ids[0] as LeaderboardPeriod)} multiple={false}/>
      {period==='custom'?<View style={[styles.calendar,{borderTopColor:colors.border}]}><Pressable onPress={()=>setCalendarOpen((value)=>!value)} style={styles.dateButton}><Ionicons name="calendar-outline" size={18} color={accent}/><Text style={[styles.dateText,{color:colors.ink}]}>{periodTitle('custom',anchor)}</Text><Ionicons name={calendarOpen?'chevron-up':'chevron-down'} size={18} color={colors.muted}/></Pressable>{calendarOpen?<View style={[styles.calendarBody,{borderTopColor:colors.border}]}><MonthCalendar monthDate={anchor} selectedDate={anchor} onSelect={(date)=>{setAnchor(date);setCalendarOpen(false);}} onMonthChange={setAnchor}/></View>:null}</View>:null}
      <MetricSelector title="What to compare" items={selectorOptions} selectedIds={selectedIds} onChange={(ids)=>{setSelectedIds(ids);updateSettings({leaderboardMetricIdsByGroup:{...state.settings.leaderboardMetricIdsByGroup,[state.group.id]:ids}});}}/>
      <Pressable onPress={()=>router.push({pathname:'/leaderboard-detail',params:{period,anchor,metrics:selectedIds.join(',')}} as never)} style={[styles.open,{borderTopColor:colors.border}]}><View><Text style={[styles.openTitle,{color:colors.ink}]}>{periodTitle(period,anchor)}</Text><Text style={[styles.openSub,{color:colors.muted}]}>Open all friends, entries, notes and photos</Text></View><Ionicons name="expand-outline" size={21} color={accent}/></Pressable>
    </Card>

    {selectedIds.map((id)=>{
      const metric=state.metrics.find((item)=>item.id===id);const includeScore=id===SCORE_ID;
      const rows=leaderboardRows(state,metric?[metric]:[],dates,state.currentUserId,includeScore);
      return <Card key={id} style={styles.ranking}>
        <View style={styles.rankingHead}><View><Text style={[styles.eyebrow,{color:accent}]}>{dates.length===1?'DAILY RANKING':`${dates.length}-DAY RANKING`}</Text><Text style={[styles.title,{color:colors.ink}]}>{includeScore?'Overall score':metric?.name}</Text></View>{includeScore?<Text style={[styles.max,{color:accent,backgroundColor:colors.primarySoft}]}>MAX 100</Text>:null}</View>
        {rows.map((row,index)=>{const result=row.metrics[0]?.result;const streakText=result?.streak&&result.streak>1?`${result.streak}d streak`:'';const lastSync=result?.lastRecordedAt?relativeTime(result.lastRecordedAt):'';const subtextParts=[includeScore?`${Math.round(row.score)} points`:result?.averageLabel||'',streakText,lastSync].filter(Boolean);return <Pressable key={row.member.id} onPress={()=>router.push({pathname:'/member/[id]',params:{id:row.member.id,period,anchor,metrics:id}} as never)} style={[styles.row,{borderTopColor:colors.border},row.member.id===state.currentUserId&&{backgroundColor:colors.primarySoft,borderRadius:14,borderTopColor:'transparent'}]}><Text style={[styles.rank,{color:colors.faint},index<3&&styles.podium]}>#{index+1}</Text><Avatar initials={row.member.initials} color={row.member.color} uri={row.member.avatarUri} size={41}/><View style={styles.copy}><Text style={[styles.name,{color:colors.ink}]}>{memberDisplayName(state,row.member)}{row.member.id===state.currentUserId?' · You':''}</Text>{memberOriginalLabel(state,row.member)?<Text style={[styles.original,{color:colors.faint}]}>{memberOriginalLabel(state,row.member)}</Text>:null}<Text style={[styles.value,{color:colors.muted},result?.mode==='private'&&styles.private]}>{subtextParts.join(' · ')}</Text></View><View style={styles.bar}><Text style={[styles.score,{color:colors.ink}]}>{result?.label}</Text><ProgressBar progress={row.score/100} color={row.member.color}/></View><Ionicons name="chevron-forward" size={16} color={colors.faint}/></Pressable>})}
      </Card>;
    })}

  </Screen>;
}

const styles=StyleSheet.create({
  headerActions:{flexDirection:'row',alignItems:'center',gap:7},bell:{width:39,height:39,borderRadius:15,backgroundColor:palette.primarySoft,alignItems:'center',justifyContent:'center'},alertDot:{position:'absolute',right:8,top:7,width:7,height:7,borderRadius:4,backgroundColor:palette.red,borderWidth:1.5,borderColor:palette.primarySoft},invite:{flexDirection:'row',alignItems:'center',gap:6,borderWidth:1,borderColor:'#B9DFC9',backgroundColor:palette.primarySoft,borderRadius:18,paddingVertical:9,paddingHorizontal:12},inviteText:{color:palette.primary,fontSize:13,fontWeight:'800'},groupActions:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:14,marginTop:-12,marginBottom:14},inline:{flexDirection:'row',alignItems:'center',gap:5},link:{color:palette.primary,fontSize:11,fontWeight:'800'},code:{marginLeft:'auto',color:palette.faint,fontSize:9,fontWeight:'900',letterSpacing:1},controls:{padding:14,marginBottom:14,gap:8},calendar:{borderTopWidth:1,borderTopColor:palette.border,paddingTop:8,marginBottom:10},dateButton:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:6},dateText:{flex:1,color:palette.ink,fontSize:12,fontWeight:'900'},calendarBody:{borderTopWidth:1,borderTopColor:palette.border,paddingTop:10,marginTop:7},open:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingTop:14,marginTop:6,borderTopWidth:1,borderTopColor:palette.border},openTitle:{color:palette.ink,fontSize:14,fontWeight:'900'},openSub:{color:palette.muted,fontSize:9,marginTop:3},ranking:{padding:12,marginBottom:13},rankingHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',padding:7},eyebrow:{color:palette.primary,fontSize:9,fontWeight:'900',letterSpacing:1.1},title:{color:palette.ink,fontSize:19,fontWeight:'900',marginTop:3},max:{color:palette.primary,fontSize:8,fontWeight:'900',padding:7,backgroundColor:palette.primarySoft,borderRadius:10},row:{flexDirection:'row',alignItems:'center',gap:9,minHeight:72,paddingHorizontal:6,paddingVertical:8,borderTopWidth:1,borderTopColor:palette.border},current:{backgroundColor:'#F4FAF6',borderRadius:14,borderTopColor:'transparent'},rank:{width:27,color:palette.faint,fontSize:12,fontWeight:'900'},podium:{color:palette.amber,fontSize:15},copy:{flex:1},name:{color:palette.ink,fontSize:13,fontWeight:'900'},original:{color:palette.faint,fontSize:8,marginTop:1},value:{color:palette.muted,fontSize:9,lineHeight:13,marginTop:3},private:{fontStyle:'italic',color:palette.faint},bar:{width:64,gap:5},score:{color:palette.ink,fontSize:13,fontWeight:'900',textAlign:'right'},
});
