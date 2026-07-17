import { AppState, MetricDefinition, MetricEntry, PhotoUpdate } from '@/src/types';
import { dateKey, dateKeyWithOffset } from '@/src/domain/date';
import { DEMO_PROGRESS_URIS } from './demoAssets';

export const DEFAULT_METRICS: MetricDefinition[] = [
  {
    id: 'steps',
    name: 'Steps',
    icon: 'walk-outline',
    color: '#176B4D',
    unit: 'steps',
    dataType: 'number',
    aggregation: 'sum',
    rankingDirection: 'higher',
    goal: { kind: 'at_least', target: 10000 },
    scoreWeight: 30,
    defaultVisibility: 'group',
    sections: { today: true, group: true, insights: true },
    order: 0,
    activeFrom: dateKeyWithOffset(-29),
  },
  {
    id: 'food',
    name: 'Food',
    icon: 'restaurant-outline',
    color: '#E08A32',
    unit: 'kcal',
    dataType: 'number',
    aggregation: 'sum',
    rankingDirection: 'closest',
    goal: { kind: 'at_most', target: 1956 },
    scoreWeight: 20,
    defaultVisibility: 'group',
    sections: { today: true, group: false, insights: true },
    order: 1,
    activeFrom: dateKeyWithOffset(-29),
  },
  {
    id: 'exercise',
    name: 'Active energy',
    icon: 'flash-outline',
    color: '#D95852',
    unit: 'kcal',
    dataType: 'number',
    aggregation: 'sum',
    rankingDirection: 'higher',
    goal: { kind: 'at_least', target: 300 },
    scoreWeight: 20,
    defaultVisibility: 'group',
    sections: { today: true, group: true, insights: true },
    order: 2,
    activeFrom: dateKeyWithOffset(-29),
  },
  {
    id: 'deficit',
    name: 'Daily deficit',
    icon: 'trending-down-outline',
    color: '#7756D9',
    unit: 'kcal',
    dataType: 'calculated',
    aggregation: 'latest',
    rankingDirection: 'closest',
    goal: { kind: 'at_least', target: 550 },
    scoreWeight: 20,
    formula: 'bmr + daily_activity + exercise - food',
    defaultVisibility: 'group',
    sections: { today: true, group: true, insights: true },
    order: 3,
    activeFrom: dateKeyWithOffset(-29),
  },
  {
    id: 'water',
    name: 'Water',
    icon: 'water-outline',
    color: '#3478D4',
    unit: 'L',
    dataType: 'number',
    aggregation: 'sum',
    rankingDirection: 'higher',
    goal: { kind: 'at_least', target: 2.5 },
    scoreWeight: 5,
    defaultVisibility: 'group',
    sections: { today: true, group: false, insights: true },
    order: 4,
    activeFrom: dateKeyWithOffset(-29),
  },
  {
    id: 'workout',
    name: 'Workout',
    icon: 'barbell-outline',
    color: '#337B7B',
    unit: '',
    dataType: 'boolean',
    aggregation: 'max',
    rankingDirection: 'higher',
    goal: { kind: 'complete', target: 1 },
    scoreWeight: 5,
    defaultVisibility: 'group',
    sections: { today: false, group: false, insights: true },
    order: 5,
    activeFrom: dateKeyWithOffset(-29),
  },
  {
    id: 'weight', name: 'Weight', icon: 'scale-outline', color: '#5A7184', unit: 'kg', dataType: 'number',
    aggregation: 'latest', rankingDirection: 'closest', goal: { kind: 'at_most', target: 80 }, scoreWeight: 0,
    defaultVisibility: 'group', sections: { today: false, group: false, insights: true }, order: 6, activeFrom: dateKeyWithOffset(-29),
  },
  {
    id: 'protein', name: 'Protein', icon: 'nutrition-outline', color: '#B05C8C', unit: 'g', dataType: 'number',
    aggregation: 'sum', rankingDirection: 'higher', goal: { kind: 'at_least', target: 120 }, scoreWeight: 0,
    defaultVisibility: 'group', sections: { today: false, group: false, insights: true }, order: 7, activeFrom: dateKeyWithOffset(-29),
  },
  {
    id: 'fat', name: 'Fat', icon: 'ellipse-outline', color: '#E08A32', unit: 'g', dataType: 'number',
    aggregation: 'sum', rankingDirection: 'closest', goal: { kind: 'exact', target: 65 }, scoreWeight: 0,
    defaultVisibility: 'group', sections: { today: false, group: false, insights: true }, order: 8, activeFrom: dateKeyWithOffset(-29),
  },
  {
    id: 'carbs', name: 'Carbs', icon: 'leaf-outline', color: '#8A6B32', unit: 'g', dataType: 'number',
    aggregation: 'sum', rankingDirection: 'closest', goal: { kind: 'at_most', target: 220 }, scoreWeight: 0,
    defaultVisibility: 'group', sections: { today: false, group: false, insights: true }, order: 9, activeFrom: dateKeyWithOffset(-29),
  },
  {
    id: 'fiber', name: 'Fiber', icon: 'flower-outline', color: '#337B7B', unit: 'g', dataType: 'number',
    aggregation: 'sum', rankingDirection: 'higher', goal: { kind: 'at_least', target: 30 }, scoreWeight: 0,
    defaultVisibility: 'group', sections: { today: false, group: false, insights: true }, order: 10, activeFrom: dateKeyWithOffset(-29),
  },
  {
    id: 'sodium', name: 'Sodium', icon: 'water-outline', color: '#6D7FA8', unit: 'mg', dataType: 'number',
    aggregation: 'sum', rankingDirection: 'closest', goal: { kind: 'at_most', target: 2300 }, scoreWeight: 0,
    defaultVisibility: 'group', sections: { today: false, group: false, insights: true }, order: 11, activeFrom: dateKeyWithOffset(-29),
  },
  {
    id: 'progress_photo', name: 'Progress photo', icon: 'camera-outline', color: '#7756D9', unit: '', dataType: 'photo',
    aggregation: 'max', rankingDirection: 'higher', goal: { kind: 'complete', target: 1 }, scoreWeight: 0,
    defaultVisibility: 'group', sections: { today: false, group: false, insights: true }, order: 12, activeFrom: dateKeyWithOffset(-29),
  },
];

const members = [
  { id: 'ahmad', name: 'Ahmad', initials: 'AH', color: '#176B4D', role: 'owner' as const },
  { id: 'sarah', name: 'Sarah', initials: 'SA', color: '#7756D9', role: 'member' as const },
  { id: 'daniel', name: 'Daniel', initials: 'DA', color: '#D95852', role: 'member' as const },
  { id: 'maya', name: 'Maya', initials: 'MA', color: '#3478D4', role: 'member' as const },
];

function entry(
  id: string,
  metricId: string,
  userId: string,
  value: number | boolean | string,
  localDate: string,
  visibility: MetricEntry['visibility'] = 'group',
): MetricEntry {
  return {
    id,
    metricId,
    userId,
    value,
    localDate,
    recordedAt: `${localDate}T18:00:00.000Z`,
    visibility,
    source: 'manual',
  };
}

function demoEntries(): MetricEntry[] {
  const result: MetricEntry[] = [];
  const cycle = (value: number, size: number) => ((value % size) + size) % size;
  const profiles = {
    ahmad: { steps: 9800, food: 1840, exercise: 330, water: 2.5, weight: 88.6 },
    sarah: { steps: 10400, food: 1760, exercise: 280, water: 2.6, weight: 71.4 },
    daniel: { steps: 9000, food: 2130, exercise: 410, water: 2.2, weight: 94.2 },
    maya: { steps: 10600, food: 1920, exercise: 360, water: 2.3, weight: 64.8 },
  };

  for (let day = -29; day <= 0; day += 1) {
    const localDate = dateKeyWithOffset(day);
    Object.entries(profiles).forEach(([userId, profile], memberIndex) => {
      const showcaseDay = cycle(day + memberIndex + 30, 6) === 0;
      const wave = cycle((day + 30) * (memberIndex + 3) * 379, 3200) - 1400;
      const steps = Math.max(3100, showcaseDay ? Math.max(profile.steps + wave, 10500) : profile.steps + wave);
      const food = showcaseDay ? Math.min(profile.food + cycle((day + memberIndex + 12) * 137, 420) - 210, 1900) : profile.food + cycle((day + memberIndex + 12) * 137, 420) - 210;
      const exercise = Math.max(0, showcaseDay ? Math.max(profile.exercise + cycle((day + memberIndex + 11) * 83, 240) - 110, 350) : profile.exercise + cycle((day + memberIndex + 11) * 83, 240) - 110);
      const water = Math.max(0.5, showcaseDay ? Math.max(profile.water + (cycle((day + memberIndex + 9) * 7, 8) - 4) * 0.1, 2.7) : profile.water + (cycle((day + memberIndex + 9) * 7, 8) - 4) * 0.1);

      result.push(entry(`${localDate}-${userId}-steps`, 'steps', userId, Math.round(steps), localDate));
      result.push(entry(`${localDate}-${userId}-food`, 'food', userId, Math.round(food), localDate));
      result.push(entry(`${localDate}-${userId}-exercise`, 'exercise', userId, Math.round(exercise), localDate));
      result.push(entry(`${localDate}-${userId}-water`, 'water', userId, Number(water.toFixed(1)), localDate));
      result.push(entry(`${localDate}-${userId}-workout`, 'workout', userId, (day + memberIndex) % 3 !== 0, localDate));
      result.push(entry(`${localDate}-${userId}-protein`, 'protein', userId, 92 + ((day + memberIndex + 42) * 7) % 55, localDate));
      result.push(entry(`${localDate}-${userId}-fat`, 'fat', userId, 52 + ((day + memberIndex + 40) * 5) % 34, localDate));
      result.push(entry(`${localDate}-${userId}-carbs`, 'carbs', userId, 145 + ((day + memberIndex + 41) * 13) % 105, localDate));
      result.push(entry(`${localDate}-${userId}-fiber`, 'fiber', userId, 18 + ((day + memberIndex + 38) * 3) % 19, localDate));
      result.push(entry(`${localDate}-${userId}-sodium`, 'sodium', userId, 1650 + ((day + memberIndex + 40) * 113) % 1100, localDate));
      if (day % 7 === 0 || day === -29) {
        const elapsedWeeks = (day + 29) / 7;
        result.push(entry(`${localDate}-${userId}-weight`, 'weight', userId, Number((profile.weight - elapsedWeeks * (0.12 + memberIndex * 0.02)).toFixed(1)), localDate));
      }
    });
  }

  const today = dateKey();
  const replacements: Record<string, number | boolean> = {
    [`${today}-ahmad-steps`]: 8420,
    [`${today}-ahmad-food`]: 1720,
    [`${today}-ahmad-exercise`]: 310,
    [`${today}-ahmad-water`]: 1.6,
    [`${today}-ahmad-workout`]: true,
    [`${today}-sarah-steps`]: 10980,
    [`${today}-daniel-steps`]: 9201,
    [`${today}-maya-steps`]: 12342,
  };
  return result.map((item) => {
    const replaced = item.id in replacements ? { ...item, value: replacements[item.id] } : item;
    if (item.id === `${today}-ahmad-food`) return { ...replaced, label: 'Chicken rice bowl', note: 'Lunch plus a yoghurt snack', imageUri: DEMO_PROGRESS_URIS[1] };
    if (item.id === `${today}-sarah-steps`) return { ...replaced, note: 'Walked home after work' };
    return replaced;
  });
}

function demoPhotos(): PhotoUpdate[] {
  return members.flatMap((member, memberIndex) => [-28,-14,0].map((offset, photoIndex) => {
    const localDate=dateKeyWithOffset(offset);
    return { id:`demo-photo-${member.id}-${localDate}`, userId:member.id, uri:DEMO_PROGRESS_URIS[(memberIndex+photoIndex)%DEMO_PROGRESS_URIS.length], caption:photoIndex===2?'Monthly check-in':'Progress check-in', localDate, createdAt:`${localDate}T08:00:00.000Z`, capturedAt:`${localDate}T08:00:00.000Z`, visibility:'group' as const };
  }));
}

export function createInitialState(): AppState {
  const now = new Date().toISOString();
  const group = {
    id: 'weekend-warriors',
    name: 'Weekend Warriors',
    inviteCode: 'PACE-7K2M',
    templateName: 'Healthy Competition',
    members,
    streakRestDaysPerWeek: 1,
    metricConfiguration: DEFAULT_METRICS,
  };
  return {
    version: 10,
    currentUserId: 'ahmad',
    group,
    groups: [group],
    energyProfiles: {
      ahmad: { age:31, sex:'male', heightCm:178, weightKg:88, targetWeightKg:80, activityLevel:'light', desiredWeeklyLossKg:0.5 },
      sarah: { age:29, sex:'female', heightCm:165, weightKg:68, targetWeightKg:63, activityLevel:'moderate', desiredWeeklyLossKg:0.25 },
      maya: { age:33, sex:'female', heightCm:170, weightKg:72, targetWeightKg:67, activityLevel:'light', desiredWeeklyLossKg:0.5 },
      daniel: { age:35, sex:'male', heightCm:183, weightKg:94, targetWeightKg:86, activityLevel:'moderate', desiredWeeklyLossKg:0.5 },
    },
    metrics: DEFAULT_METRICS,
    entries: demoEntries(),
    photos: demoPhotos(),
    messages: [
      {
        id: 'welcome',
        senderId: 'system',
        text: 'New week, fresh leaderboard. Small wins count. 🌱',
        createdAt: new Date(Date.now() - 1000 * 60 * 95).toISOString(),
        kind: 'cheer',
        conversationId: 'group',
      },
      {
        id: 'sarah-message',
        senderId: 'sarah',
        text: 'Lunch walk done. Who is joining the 10k club today?',
        createdAt: new Date(Date.now() - 1000 * 60 * 62).toISOString(),
        kind: 'message',
        conversationId: 'group',
      },
      {
        id: 'lead-change',
        senderId: 'system',
        text: '👑 Maya just moved into first place for steps.',
        createdAt: new Date(Date.now() - 1000 * 60 * 24).toISOString(),
        kind: 'achievement',
        conversationId: 'group',
      },
      {
        id: 'daniel-message',
        senderId: 'daniel',
        text: 'That lead is temporary 😄',
        createdAt: now,
        kind: 'message',
        conversationId: 'group',
      },
    ],
    dailyMetricStatuses: [],
    settings: {
      baselineCalories: 2250,
      energyProfile: {
        age: 31,
        sex: 'male',
        heightCm: 178,
        weightKg: 88,
        targetWeightKg: 80,
        activityLevel: 'light',
        desiredWeeklyLossKg: 0.5,
      },
      syncMode: 'balanced',
      healthSync: {
        enabled: false,
        backgroundAccess: false,
        dataTypes: {
          steps: true,
          active_energy: true,
          weight: true,
          nutrition: true,
          water: true,
          workouts: true,
        },
      },
      banterTone: 'friendly',
      autoMessages: true,
      cheerMessage: 'You’ve got this, team! One small win at a time. 🌱',
      tauntMessage: 'Friendly reminder: the leaderboard is moving without you 😄',
      reminderMessage: 'Quick check-in: remember to log today when you have a minute.',
      featuredTodayCard: 'score',
      foodGoalMode: 'activity_adjusted',
      memberNicknamesByGroup: { 'weekend-warriors': {} },
      badgeShowcaseByGroup: {},
      notifications: {
        pushEnabled: true,
        groupMetricActivity: true,
        metricIds: ['steps','exercise','deficit'],
        chatMessages: true,
        badgesAndWinners: true,
        reminders: true,
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
      },
    },
    trackedGoalPeriods: Object.fromEntries(DEFAULT_METRICS.filter((metric)=>metric.sections.today).map((metric)=>[metric.id,[{from:metric.activeFrom}]])),
    selectedGroupMetricId: 'steps',
    lastSavedAt: null,
  };
}
