import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { MetricSelector } from '@/src/components/MetricSelector';
import { MonthCalendar } from '@/src/components/MonthCalendar';
import { Avatar, Card, Chip, PageHeader, ProgressBar, Screen } from '@/src/components/ui';
import { dateKey, dateKeyWithOffset } from '@/src/domain/date';
import { leaderboardRows, LeaderboardPeriod, periodDates, periodTitle } from '@/src/domain/leaderboard';
import { memberDisplayName, memberOriginalLabel } from '@/src/domain/members';
import { useApp } from '@/src/state/AppProvider';
import { palette } from '@/src/theme';

const SCORE_ID='__score';

export default function LeaderboardScreen() {
  const { state }=useApp();
  const [period,setPeriod]=useState<LeaderboardPeriod>('today');
  const [anchor,setAnchor]=useState(dateKey());
  const [calendarOpen,setCalendarOpen]=useState(false);
  const tracked=state.metrics.filter((metric)=>metric.scoreWeight>0&&metric.dataType!=='text'&&metric.sections.group);
  const [selectedIds,setSelectedIds]=useState<string[]>([state.selectedGroupMetricId||SCORE_ID]);
  const dates=useMemo(()=>periodDates(period,anchor),[anchor,period]);

  function choosePeriod(next:LeaderboardPeriod){setPeriod(next);if(next==='today')setAnchor(dateKey());if(next==='yesterday')setAnchor(dateKeyWithOffset(-1));setCalendarOpen(next==='custom');}
  async function invite(){await Share.share({message:`Join ${state.group.name} on Paceboard with code ${state.group.inviteCode}`});}
  const selectorOptions=[{id:SCORE_ID,label:'Overall score',icon:'speedometer-outline' as const,color:palette.purple},...tracked.map((metric)=>({id:metric.id,label:metric.name,icon:metric.icon as keyof typeof Ionicons.glyphMap,color:metric.color}))];

  return <Screen>
    <PageHeader eyebrow={state.group.templateName} title="Leaderboard" subtitle={`${state.group.name} · ${state.group.members.length} friends`} action={<View style={styles.headerActions}><Pressable accessibilityLabel="Open alerts" onPress={()=>router.push('/alerts' as never)} style={styles.bell}><Ionicons name="notifications-outline" size={19} color={palette.primary}/><View style={styles.alertDot}/></Pressable><Pressable onPress={invite} style={styles.invite}><Ionicons name="person-add-outline" size={17} color={palette.primary}/><Text style={styles.inviteText}>Invite</Text></Pressable></View>}/>
    <View style={styles.groupActions}><Pressable onPress={()=>router.push('/groups' as never)} style={styles.inline}><Ionicons name="swap-horizontal" size={17} color={palette.primary}/><Text style={styles.link}>Switch or manage groups</Text></Pressable><Pressable onPress={()=>router.push('/recap?scope=group' as never)} style={styles.inline}><Ionicons name="sparkles-outline" size={17} color={palette.primary}/><Text style={styles.link}>Group recap</Text></Pressable><Text style={styles.code}>{state.group.inviteCode}</Text></View>
    <Card style={styles.controls}>
      <View style={styles.periods}><Chip label="Today" selected={period==='today'} onPress={()=>choosePeriod('today')}/><Chip label="Yesterday" selected={period==='yesterday'} onPress={()=>choosePeriod('yesterday')}/><Chip label="7 days" selected={period==='week'} onPress={()=>choosePeriod('week')}/><Chip label="This month" selected={period==='month'} onPress={()=>choosePeriod('month')}/><Chip label="Pick date" icon="calendar-outline" selected={period==='custom'} onPress={()=>choosePeriod('custom')}/></View>
      {period==='custom'?<View style={styles.calendar}><Pressable onPress={()=>setCalendarOpen((value)=>!value)} style={styles.dateButton}><Ionicons name="calendar-outline" size={18} color={palette.primary}/><Text style={styles.dateText}>{periodTitle('custom',anchor)}</Text><Ionicons name={calendarOpen?'chevron-up':'chevron-down'} size={18} color={palette.muted}/></Pressable>{calendarOpen?<View style={styles.calendarBody}><MonthCalendar monthDate={anchor} selectedDate={anchor} onSelect={(date)=>{setAnchor(date);setCalendarOpen(false);}} onMonthChange={setAnchor}/></View>:null}</View>:null}
      <MetricSelector title="Rankings to show" items={selectorOptions} selectedIds={selectedIds} onChange={setSelectedIds}/>
      <Pressable onPress={()=>router.push({pathname:'/leaderboard-detail',params:{period,anchor,metrics:selectedIds.join(',')}} as never)} style={styles.open}><View><Text style={styles.openTitle}>{periodTitle(period,anchor)}</Text><Text style={styles.openSub}>Open all friends, entries, notes and photos</Text></View><Ionicons name="expand-outline" size={21} color={palette.primary}/></Pressable>
    </Card>

    {selectedIds.map((id)=>{
      const metric=state.metrics.find((item)=>item.id===id);const includeScore=id===SCORE_ID;
      const rows=leaderboardRows(state,metric?[metric]:[],dates,state.currentUserId,includeScore);
      return <Card key={id} style={styles.ranking}>
        <View style={styles.rankingHead}><View><Text style={styles.eyebrow}>{dates.length===1?'DAILY RANKING':`${dates.length}-DAY RANKING`}</Text><Text style={styles.title}>{includeScore?'Overall score':metric?.name}</Text></View>{includeScore?<Text style={styles.max}>MAX 100</Text>:null}</View>
        {rows.map((row,index)=>{const result=row.metrics[0]?.result;return <Pressable key={row.member.id} onPress={()=>router.push({pathname:'/member/[id]',params:{id:row.member.id,period,anchor,metrics:id}} as never)} style={[styles.row,row.member.id===state.currentUserId&&styles.current]}><Text style={[styles.rank,index<3&&styles.podium]}>#{index+1}</Text><Avatar initials={row.member.initials} color={row.member.color} uri={row.member.avatarUri} size={41}/><View style={styles.copy}><Text style={styles.name}>{memberDisplayName(state,row.member)}{row.member.id===state.currentUserId?' · You':''}</Text>{memberOriginalLabel(state,row.member)?<Text style={styles.original}>{memberOriginalLabel(state,row.member)}</Text>:null}<Text style={[styles.value,result?.mode==='private'&&styles.private]}>{includeScore?`${Math.round(row.score)} points`:result?.label}{result?.averageLabel?` · ${result.averageLabel}`:''}</Text></View><View style={styles.bar}><Text style={styles.score}>{includeScore?Math.round(row.score):result?.completedDays||result?.visibleDays?`${result.completedDays}/${result.visibleDays}`:''}</Text><ProgressBar progress={row.score/100} color={row.member.color}/></View><Ionicons name="chevron-forward" size={16} color={palette.faint}/></Pressable>})}
      </Card>;
    })}

  </Screen>;
}

const styles=StyleSheet.create({
  headerActions:{flexDirection:'row',alignItems:'center',gap:7},bell:{width:39,height:39,borderRadius:15,backgroundColor:palette.primarySoft,alignItems:'center',justifyContent:'center'},alertDot:{position:'absolute',right:8,top:7,width:7,height:7,borderRadius:4,backgroundColor:palette.red,borderWidth:1.5,borderColor:palette.primarySoft},invite:{flexDirection:'row',alignItems:'center',gap:6,borderWidth:1,borderColor:'#B9DFC9',backgroundColor:palette.primarySoft,borderRadius:18,paddingVertical:9,paddingHorizontal:12},inviteText:{color:palette.primary,fontSize:13,fontWeight:'800'},groupActions:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:14,marginTop:-12,marginBottom:14},inline:{flexDirection:'row',alignItems:'center',gap:5},link:{color:palette.primary,fontSize:11,fontWeight:'800'},code:{marginLeft:'auto',color:palette.faint,fontSize:9,fontWeight:'900',letterSpacing:1},controls:{padding:14,marginBottom:14},periods:{flexDirection:'row',flexWrap:'wrap',gap:7,marginBottom:12},calendar:{borderTopWidth:1,borderTopColor:palette.border,paddingTop:8,marginBottom:10},dateButton:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:6},dateText:{flex:1,color:palette.ink,fontSize:12,fontWeight:'900'},calendarBody:{borderTopWidth:1,borderTopColor:palette.border,paddingTop:10,marginTop:7},open:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingTop:14,marginTop:14,borderTopWidth:1,borderTopColor:palette.border},openTitle:{color:palette.ink,fontSize:14,fontWeight:'900'},openSub:{color:palette.muted,fontSize:9,marginTop:3},ranking:{padding:12,marginBottom:13},rankingHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',padding:7},eyebrow:{color:palette.primary,fontSize:9,fontWeight:'900',letterSpacing:1.1},title:{color:palette.ink,fontSize:19,fontWeight:'900',marginTop:3},max:{color:palette.primary,fontSize:8,fontWeight:'900',padding:7,backgroundColor:palette.primarySoft,borderRadius:10},row:{flexDirection:'row',alignItems:'center',gap:9,minHeight:72,paddingHorizontal:6,paddingVertical:8,borderTopWidth:1,borderTopColor:palette.border},current:{backgroundColor:'#F4FAF6',borderRadius:14,borderTopColor:'transparent'},rank:{width:27,color:palette.faint,fontSize:12,fontWeight:'900'},podium:{color:palette.amber,fontSize:15},copy:{flex:1},name:{color:palette.ink,fontSize:13,fontWeight:'900'},original:{color:palette.faint,fontSize:8,marginTop:1},value:{color:palette.muted,fontSize:9,lineHeight:13,marginTop:3},private:{fontStyle:'italic',color:palette.faint},bar:{width:64,gap:5},score:{color:palette.ink,fontSize:13,fontWeight:'900',textAlign:'right'},
});
