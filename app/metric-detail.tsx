import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ExpandableImage } from '@/src/components/ExpandableImage';
import { Button, Card, IconButton, PageHeader, Screen } from '@/src/components/ui';
import { dateKey, dateKeyWithOffset, dateWithOffsetFrom } from '@/src/domain/date';
import { formatMetricValue, safeMetricValue } from '@/src/domain/metrics';
import { useApp } from '@/src/state/AppProvider';
import { palette } from '@/src/theme';

export default function MetricDetailScreen(){
  const {metric:metricId}=useLocalSearchParams<{metric:string}>();const {state}=useApp();const [day,setDay]=useState(dateKey());
  const weekly=metricId==='weekly_deficit';const metric=state.metrics.find((item)=>item.id===metricId);
  const entries=metric?state.entries.filter((entry)=>entry.userId===state.currentUserId&&entry.metricId===metric.id&&entry.localDate===day).sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt)):[];
  const weekday=(new Date().getDay()+6)%7;const weekDays=Array.from({length:weekday+1},(_,index)=>dateKeyWithOffset(index-weekday));
  const title=weekly?'Weekly deficit balance':metric?.name??'Metric details';
  return <Screen><PageHeader eyebrow={weekly?'Current week':day} title={title} subtitle={weekly?'Only days with food logged count toward the balance.':'Review individual entries before adding another.'} showMenu={false} action={<IconButton icon="close" label="Close" onPress={()=>router.back()}/>}/>
    {weekly?<View style={styles.list}>{weekDays.map((date)=>{const hasFood=state.entries.some((entry)=>entry.userId===state.currentUserId&&entry.metricId==='food'&&entry.localDate===date);const deficit=state.metrics.find((item)=>item.id==='deficit');const value=deficit&&hasFood?safeMetricValue(state,deficit,state.currentUserId,date):null;return <Card key={date} style={styles.row}><Text style={styles.date}>{date}</Text><Text style={styles.value}>{value===null?'Not counted':`${Math.round(value)} kcal deficit`}</Text></Card>;})}</View>:metric?<><View style={styles.dayNav}><Pressable onPress={()=>setDay(dateWithOffsetFrom(day,-1))}><Ionicons name="chevron-back" size={22} color={palette.primary}/></Pressable><Text style={styles.day}>{day}</Text><Pressable onPress={()=>setDay(dateWithOffsetFrom(day,1))}><Ionicons name="chevron-forward" size={22} color={palette.primary}/></Pressable></View>
      <Card style={styles.summary}><Text style={styles.label}>DAY TOTAL</Text><Text style={styles.total}>{formatMetricValue(metric,safeMetricValue(state,metric,state.currentUserId,day))}</Text></Card>
      <View style={styles.list}>{entries.map((entry)=><Card key={entry.id}><Text style={styles.entryTitle}>{entry.label||metric.name}</Text><Text style={styles.entryValue}>{typeof entry.value==='boolean'?(entry.value?'Completed':'Not completed'):typeof entry.value==='number'?formatMetricValue(metric,entry.value):entry.value}</Text>{entry.note?<Text style={styles.note}>{entry.note}</Text>:null}{entry.nutrition?<Text style={styles.note}>{Object.entries(entry.nutrition).filter(([,value])=>Number(value)>0).map(([key,value])=>`${key.replace(/G$|Mg$|Mcg$/,'')}: ${Math.round(Number(value)*10)/10}`).join(' · ')}</Text>:null}{entry.imageUri?<ExpandableImage uri={entry.imageUri} thumbnailStyle={styles.image}/>:null}</Card>)}</View>
      {!entries.length?<Card><Text style={styles.empty}>No individual entries were logged for this date.</Text></Card>:null}
      {metric.dataType!=='calculated'&&metric.dataType!=='photo'?<Button label={`Add ${metric.name}`} icon="add" onPress={()=>router.push({pathname:'/(tabs)/log',params:{metric:metric.id}})}/>:null}</>:null}
  </Screen>;
}
const styles=StyleSheet.create({list:{gap:8,marginBottom:14},row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},date:{color:palette.muted,fontSize:11,fontWeight:'800'},value:{color:palette.ink,fontSize:12,fontWeight:'900'},dayNav:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:10},day:{color:palette.ink,fontSize:13,fontWeight:'900'},summary:{marginBottom:10},label:{color:palette.faint,fontSize:8,fontWeight:'900'},total:{color:palette.ink,fontSize:25,fontWeight:'900',marginTop:4},entryTitle:{color:palette.ink,fontSize:12,fontWeight:'900'},entryValue:{color:palette.primary,fontSize:15,fontWeight:'900',marginTop:4},note:{color:palette.muted,fontSize:10,lineHeight:15,marginTop:7},image:{width:110,height:80,borderRadius:10,marginTop:8},empty:{color:palette.muted,fontSize:11,textAlign:'center'}});
