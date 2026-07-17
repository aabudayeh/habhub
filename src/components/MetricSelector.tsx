import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette, shadow } from '@/src/theme';

export type MetricSelectorItem = {
  id: string;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  color?: string;
  sublabel?: string;
};

export function MetricSelector({ items, selectedIds, onChange, multiple = true, title = 'Metrics', emptyLabel = 'No logged metrics' }: {
  items: MetricSelectorItem[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  title?: string;
  emptyLabel?: string;
}) {
  const [open,setOpen]=useState(false);
  const selected=items.filter((item)=>selectedIds.includes(item.id));
  function choose(id:string){
    if(!multiple){onChange([id]);setOpen(false);return;}
    onChange(selectedIds.includes(id)?selectedIds.length>1?selectedIds.filter((item)=>item!==id):selectedIds:[...selectedIds,id]);
  }
  return <View style={styles.wrap}>
    <Pressable accessibilityRole="button" onPress={()=>setOpen((value)=>!value)} style={styles.button}><View style={styles.icon}><Ionicons name="options-outline" size={18} color={palette.primary}/></View><View style={styles.copy}><Text style={styles.title}>{title}</Text><Text numberOfLines={1} style={styles.summary}>{selected.length?selected.map((item)=>item.label).join(', '):emptyLabel}</Text></View><Ionicons name={open?'chevron-up':'chevron-down'} size={18} color={palette.muted}/></Pressable>
    {open?<View style={styles.menu}>{items.length?items.map((item)=>{const checked=selectedIds.includes(item.id);return <Pressable key={item.id} onPress={()=>choose(item.id)} style={[styles.row,checked&&styles.rowSelected]}><View style={[styles.itemIcon,{backgroundColor:`${item.color??palette.primary}18`}]}><Ionicons name={item.icon??'analytics-outline'} size={17} color={item.color??palette.primary}/></View><View style={styles.copy}><Text style={styles.itemLabel}>{item.label}</Text>{item.sublabel?<Text style={styles.sublabel}>{item.sublabel}</Text>:null}</View><Ionicons name={multiple?(checked?'checkbox':'square-outline'):(checked?'radio-button-on':'radio-button-off')} size={20} color={checked?palette.primary:palette.faint}/></Pressable>}):<Text style={styles.empty}>{emptyLabel}</Text>}<Pressable onPress={()=>setOpen(false)} style={styles.done}><Text style={styles.doneText}>Done</Text></Pressable></View>:null}
  </View>;
}

const styles=StyleSheet.create({
  wrap:{zIndex:20},button:{minHeight:58,flexDirection:'row',alignItems:'center',gap:10,borderWidth:1,borderColor:palette.border,backgroundColor:palette.card,borderRadius:17,padding:10},icon:{width:36,height:36,borderRadius:12,backgroundColor:palette.primarySoft,alignItems:'center',justifyContent:'center'},copy:{flex:1},title:{color:palette.ink,fontSize:11,fontWeight:'900'},summary:{color:palette.muted,fontSize:10,marginTop:2},menu:{marginTop:7,borderWidth:1,borderColor:palette.border,backgroundColor:palette.card,borderRadius:17,padding:8,...shadow},row:{minHeight:52,flexDirection:'row',alignItems:'center',gap:9,borderRadius:12,padding:7},rowSelected:{backgroundColor:palette.primarySoft},itemIcon:{width:34,height:34,borderRadius:11,alignItems:'center',justifyContent:'center'},itemLabel:{color:palette.ink,fontSize:12,fontWeight:'800'},sublabel:{color:palette.muted,fontSize:9,marginTop:2},empty:{color:palette.muted,fontSize:11,textAlign:'center',padding:15},done:{alignSelf:'flex-end',paddingHorizontal:12,paddingVertical:8},doneText:{color:palette.primary,fontSize:11,fontWeight:'900'},
});
