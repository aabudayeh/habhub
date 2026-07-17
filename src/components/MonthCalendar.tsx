import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { dateKey } from '@/src/domain/date';
import { palette } from '@/src/theme';

export function MonthCalendar({ selectedDate, onSelect, hasActivity, dayStatus, dayVisuals, monthDate, onMonthChange }: { selectedDate: string; onSelect: (date: string) => void; hasActivity?: (date: string) => boolean; dayStatus?: (date: string) => 'met' | 'partial' | 'none'; dayVisuals?: (date: string) => { color: string; progress: number }[]; monthDate?: string; onMonthChange?: (date: string) => void }) {
  const initial = new Date(`${monthDate ?? selectedDate}T12:00:00`);
  const [cursor,setCursor]=useState(new Date(initial.getFullYear(),initial.getMonth(),1,12));
  useEffect(()=>{if(monthDate){const next=new Date(`${monthDate}T12:00:00`);setCursor(new Date(next.getFullYear(),next.getMonth(),1,12));}},[monthDate]);
  const days=useMemo(()=>{
    const first=new Date(cursor.getFullYear(),cursor.getMonth(),1,12); const start=new Date(first); start.setDate(1-first.getDay());
    return Array.from({length:42},(_,index)=>{const day=new Date(start);day.setDate(start.getDate()+index);return {key:dateKey(day),number:day.getDate(),current:day.getMonth()===cursor.getMonth()};});
  },[cursor]);
  const title=new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(cursor);
  function shift(delta:number){const next=new Date(cursor.getFullYear(),cursor.getMonth()+delta,1,12);setCursor(next);onMonthChange?.(dateKey(next));}
  const shiftRef=useRef(shift);shiftRef.current=shift;
  const swipe=useMemo(()=>PanResponder.create({onMoveShouldSetPanResponder:(_event,gesture)=>Math.abs(gesture.dx)>20,onPanResponderRelease:(_event,gesture)=>{if(gesture.dx>45)shiftRef.current(-1);if(gesture.dx<-45)shiftRef.current(1);}}),[]);
  return <View {...swipe.panHandlers}>
    <View style={styles.heading}><Pressable onPress={()=>shift(-1)} style={styles.arrow}><Ionicons name="chevron-back" size={19} color={palette.ink}/></Pressable><Text style={styles.title}>{title}</Text><Pressable onPress={()=>shift(1)} style={styles.arrow}><Ionicons name="chevron-forward" size={19} color={palette.ink}/></Pressable></View>
    <View style={styles.grid}>{['S','M','T','W','T','F','S'].map((day,index)=><Text key={`${day}-${index}`} style={styles.weekday}>{day}</Text>)}{days.map((day)=>{const selected=day.key===selectedDate;const status=dayStatus?.(day.key);const visuals=dayVisuals?.(day.key)??[];return <Pressable key={day.key} onPress={()=>onSelect(day.key)} style={[styles.day,status==='met'&&styles.metDay,status==='partial'&&styles.partialDay,selected&&styles.selected]}><Text style={[styles.dayText,!day.current&&styles.muted,selected&&styles.selectedText]}>{day.number}</Text>{visuals.length?<View style={styles.visuals}>{visuals.slice(0,5).map((visual,index)=><View key={index} style={styles.visualTrack}><View style={[styles.visualFill,{backgroundColor:selected?palette.lime:visual.color,width:`${Math.min(Math.max(visual.progress,0),1)*100}%`}]}/></View>)}</View>:hasActivity?.(day.key)||status&&status!=='none'?<View style={[styles.dot,status==='met'&&styles.metDot,selected&&styles.dotSelected]}/>:null}</Pressable>;})}</View>
  </View>;
}
const styles=StyleSheet.create({
  heading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:10},title:{color:palette.ink,fontSize:15,fontWeight:'900'},arrow:{width:36,height:36,borderRadius:12,backgroundColor:palette.canvas,alignItems:'center',justifyContent:'center'},grid:{flexDirection:'row',flexWrap:'wrap'},weekday:{width:'14.285%',textAlign:'center',color:palette.faint,fontSize:9,fontWeight:'900',paddingVertical:7},day:{width:'14.285%',aspectRatio:1,alignItems:'center',justifyContent:'center',borderRadius:12},selected:{backgroundColor:palette.primary},dayText:{color:palette.ink,fontSize:12,fontWeight:'800'},muted:{color:'#C1C9C3'},selectedText:{color:palette.white},dot:{position:'absolute',bottom:5,width:4,height:4,borderRadius:2,backgroundColor:palette.primary},dotSelected:{backgroundColor:palette.lime},
  metDay:{backgroundColor:'#EDF7D5'},partialDay:{backgroundColor:palette.primarySoft},metDot:{backgroundColor:'#79A52B'},
  visuals:{position:'absolute',left:5,right:5,bottom:4,gap:1},visualTrack:{height:2,borderRadius:2,backgroundColor:'rgba(104,117,109,.16)',overflow:'hidden'},visualFill:{height:2,borderRadius:2},
});
