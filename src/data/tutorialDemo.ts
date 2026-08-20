import { DEFAULT_METRICS, createInitialState } from "@/src/data/seed";
import { DEMO_PROGRESS_URIS } from "@/src/data/demoAssets";
import type {
  AppState,
  CalendarReminder,
  GroupChallenge,
  GymPlan,
  GymSession,
  JournalNote,
  MetricDefinition,
  MetricEntry,
  TodoItem,
} from "@/src/types";

export const TUTORIAL_DEMO_SCHEMA_VERSION = 1 as const;
export const TUTORIAL_DEMO_ANCHOR_DATE = "2026-08-12";
export const TUTORIAL_DEMO_USER_ID = "tutorial-you";
export const TUTORIAL_DEMO_GROUP_ID = "tutorial-group";

export type TutorialScreenTimeApp = {
  packageName: string;
  appName: string;
  foregroundMs: number;
  lastTimeUsed: number;
  category: string;
  isSystemApp: boolean;
};

export type TutorialScreenTimeReport = {
  supported: true;
  accessGranted: true;
  from: number;
  to: number;
  screenTimeMs: number;
  approximate: true;
  calculationMethod: "foreground_events";
  apps: TutorialScreenTimeApp[];
};

export type TutorialDemoBundle = {
  schemaVersion: typeof TUTORIAL_DEMO_SCHEMA_VERSION;
  anchorDate: string;
  appState: AppState;
  groupChallenges: GroupChallenge[];
  screenTimeReport: TutorialScreenTimeReport;
};

function shiftDate(anchorDate: string, offset: number) {
  const date = new Date(`${anchorDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function instant(anchorDate: string, offset: number, time: string) {
  return `${shiftDate(anchorDate, offset)}T${time}:00.000Z`;
}

function cloneMetric(metric: MetricDefinition, activeFrom: string): MetricDefinition {
  return {
    ...metric,
    goal: { ...metric.goal },
    goalRange: metric.goalRange ? { ...metric.goalRange } : undefined,
    adaptiveGoalTarget: metric.adaptiveGoalTarget
      ? { ...metric.adaptiveGoalTarget }
      : undefined,
    sections: { ...metric.sections },
    activeFrom,
    healthMapping: metric.healthMapping ? { ...metric.healthMapping } : undefined,
    gymMapping: metric.gymMapping ? { ...metric.gymMapping } : undefined,
    gymMuscleGroups: metric.gymMuscleGroups ? [...metric.gymMuscleGroups] : undefined,
    fastingSettings: metric.fastingSettings ? { ...metric.fastingSettings } : undefined,
    submetrics: metric.submetrics?.map((submetric) => ({
      ...submetric,
      goal: { ...submetric.goal },
      goalRange: submetric.goalRange ? { ...submetric.goalRange } : undefined,
      healthMapping: submetric.healthMapping ? { ...submetric.healthMapping } : undefined,
    })),
    submetricDisplay: metric.submetricDisplay
      ? { ...metric.submetricDisplay }
      : undefined,
    visualization: metric.visualization ? { ...metric.visualization } : undefined,
    goalSchedule: metric.goalSchedule ? { ...metric.goalSchedule } : undefined,
    reminder: metric.reminder ? { ...metric.reminder } : undefined,
    reminders: metric.reminders?.map((reminder) => ({
      ...reminder,
      schedule: reminder.schedule ? { ...reminder.schedule } : undefined,
    })),
    progressReminderPercentages: metric.progressReminderPercentages
      ? [...metric.progressReminderPercentages]
      : undefined,
  };
}

function tutorialMetrics(anchorDate: string) {
  const activeFrom = shiftDate(anchorDate, -89);
  const metrics = DEFAULT_METRICS.map((metric) => cloneMetric(metric, activeFrom));
  const patch = (id: string, values: Partial<MetricDefinition>) => {
    const index = metrics.findIndex((metric) => metric.id === id);
    if (index >= 0) metrics[index] = { ...metrics[index], ...values };
  };

  patch("steps", {
    pinnedTodayAt: instant(anchorDate, -30, "08:00"),
    reminders: [
      {
        enabled: true,
        time: "18:00",
        label: "Evening steps check-in",
        schedule: { mode: "daily" },
      },
    ],
    progressRemindersEnabled: true,
    progressReminderPercentages: [50, 75, 100],
  });
  patch("water", {
    goalSchedule: { mode: "daily" },
    reminders: [
      { enabled: true, time: "09:00", label: "Morning water" },
      { enabled: true, time: "15:00", label: "Afternoon water" },
    ],
  });
  patch("workout", {
    goalSchedule: { mode: "weekly_min", minimumCompletions: 3 },
  });
  patch("intermittent_fasting", {
    sections: { today: true, group: false, insights: true },
    fastingSettings: {
      startTime: "20:00",
      fastingMinutes: 16 * 60,
      automaticFoodBreak: true,
    },
    reminders: [
      { enabled: true, time: "20:00", label: "Start fast" },
      { enabled: true, time: "12:00", label: "Eating window opens" },
    ],
  });
  patch("screen_time", {
    sections: { today: true, group: false, insights: true },
    progressRemindersEnabled: true,
    progressReminderPercentages: [50, 75, 90, 100],
  });

  const customMetrics: MetricDefinition[] = [
    {
      id: "tutorial_meditation",
      name: "Meditation",
      icon: "leaf-outline",
      color: "#2F8F74",
      unit: "min",
      dataType: "number",
      aggregation: "sum",
      rankingDirection: "higher",
      goal: { kind: "at_least", target: 15 },
      adaptiveGoalTarget: {
        enabled: true,
        statistic: "median",
        period: "month",
      },
      goalProgressMode: "daily",
      goalEnabled: true,
      category: "mind",
      grouping: "Recovery routine",
      manualEntry: true,
      timerEnabled: true,
      visualization: {
        detailDay: "progress",
        detailRange: "both",
        progressOverview: "line",
        progressGrid: "completion",
      },
      scoreWeight: 5,
      defaultVisibility: "private",
      sections: { today: true, group: false, insights: true },
      order: 45,
      activeFrom,
      pinnedTodayAt: instant(anchorDate, -10, "07:00"),
      goalSchedule: { mode: "selected_days", daysOfWeek: [1, 2, 3, 4, 5] },
      reminders: [
        {
          enabled: true,
          time: "07:30",
          label: "Morning meditation",
          durationMinutes: 15,
          schedule: { mode: "selected_days", daysOfWeek: [1, 2, 3, 4, 5] },
        },
      ],
      progressRemindersEnabled: true,
      progressReminderPercentages: [50, 100],
    },
    {
      id: "tutorial_wellbeing",
      name: "Daily wellbeing",
      icon: "sparkles-outline",
      color: "#AF5C8E",
      unit: "/10",
      dataType: "number",
      aggregation: "average",
      rankingDirection: "higher",
      goal: { kind: "at_least", target: 7 },
      goalRange: { min: 7, max: 10 },
      goalProgressMode: "daily",
      goalEnabled: true,
      category: "mind",
      grouping: "Recovery routine",
      manualEntry: true,
      submetrics: [
        {
          id: "energy",
          name: "Energy",
          unit: "/10",
          goalEnabled: true,
          goal: { kind: "at_least", target: 7 },
          showProgressBar: true,
          chartStyle: "line",
        },
        {
          id: "mood",
          name: "Mood",
          unit: "/10",
          goalEnabled: true,
          goal: { kind: "at_least", target: 7 },
          showProgressBar: true,
          chartStyle: "bar",
        },
        {
          id: "stress",
          name: "Stress",
          unit: "/10",
          goalEnabled: true,
          goal: { kind: "at_most", target: 4 },
          showProgressBar: true,
          chartStyle: "line",
        },
      ],
      submetricDisplay: {
        mode: "merged",
        template: "Energy {energy} · Mood {mood} · Stress {stress}",
        collapsible: true,
        collapsibleLabel: "More wellbeing signals",
        visibleInputCount: 2,
        mainValueEnabled: true,
      },
      visualization: {
        detailDay: "progress",
        detailRange: "both",
        progressOverview: "both",
        progressGrid: "intensity",
      },
      scoreWeight: 5,
      defaultVisibility: "status",
      sections: { today: true, group: true, insights: true },
      order: 46,
      activeFrom,
      goalSchedule: { mode: "daily" },
    },
    {
      id: "tutorial_focus_score",
      name: "Focus score",
      icon: "analytics-outline",
      color: "#4E64B5",
      unit: "points",
      dataType: "calculated",
      aggregation: "latest",
      rankingDirection: "higher",
      goal: { kind: "at_least", target: 180 },
      goalEnabled: true,
      category: "mind",
      grouping: "Focus",
      manualEntry: false,
      formula: "CLAMP(reading + study + work, 0, 300)",
      visualization: {
        detailDay: "progress",
        detailRange: "line",
        progressOverview: "line",
        progressGrid: "completion",
      },
      scoreWeight: 5,
      defaultVisibility: "private",
      sections: { today: true, group: false, insights: true },
      order: 47,
      activeFrom,
      goalSchedule: { mode: "weekly_min", minimumCompletions: 5 },
    },
  ];
  return [...metrics, ...customMetrics];
}

function makeEntry(
  anchorDate: string,
  offset: number,
  userId: string,
  metricId: string,
  value: MetricEntry["value"],
  visibility: MetricEntry["visibility"] = "group",
  details: Partial<MetricEntry> = {},
): MetricEntry {
  const localDate = shiftDate(anchorDate, offset);
  return {
    id: `tutorial-entry-${localDate}-${userId}-${metricId}-${details.label ?? "daily"}`,
    metricId,
    userId,
    value,
    localDate,
    recordedAt: instant(anchorDate, offset, "18:00"),
    visibility,
    source: "manual",
    ...details,
  };
}

function tutorialEntries(anchorDate: string): MetricEntry[] {
  const members = [
    { id: TUTORIAL_DEMO_USER_ID, bias: 0 },
    { id: "tutorial-mina", bias: 1 },
    { id: "tutorial-jonah", bias: 2 },
    { id: "tutorial-lina", bias: 3 },
  ];
  const entries: MetricEntry[] = [];
  for (let offset = -89; offset <= 0; offset += 1) {
    for (const member of members) {
      const wave = ((offset + 90) * (member.bias + 3) * 137) % 3100;
      const steps = 6900 + wave;
      const food = 1650 + (((offset + 90) * (member.bias + 5) * 43) % 520);
      const exercise = 170 + (((offset + 90) * (member.bias + 2) * 29) % 290);
      const water = 1.4 + (((offset + 90 + member.bias) % 8) * 0.2);
      entries.push(
        makeEntry(anchorDate, offset, member.id, "steps", steps),
        makeEntry(anchorDate, offset, member.id, "food", food),
        makeEntry(anchorDate, offset, member.id, "exercise", exercise),
        makeEntry(anchorDate, offset, member.id, "water", Number(water.toFixed(1))),
        makeEntry(anchorDate, offset, member.id, "workout", (offset + member.bias) % 3 === 0),
      );
      if (offset % 7 === 0 || offset === 0) {
        entries.push(
          makeEntry(
            anchorDate,
            offset,
            member.id,
            "weight",
            Number((82.4 + member.bias * 4.1 + offset * 0.018).toFixed(1)),
          ),
        );
      }
    }

    const focusSeed = (offset + 90) % 7;
    entries.push(
      makeEntry(anchorDate, offset, TUTORIAL_DEMO_USER_ID, "reading", 18 + focusSeed * 4),
      makeEntry(anchorDate, offset, TUTORIAL_DEMO_USER_ID, "study", 35 + focusSeed * 7),
      makeEntry(anchorDate, offset, TUTORIAL_DEMO_USER_ID, "work", 90 + focusSeed * 12),
      makeEntry(anchorDate, offset, TUTORIAL_DEMO_USER_ID, "screen_time", 105 + focusSeed * 13, "private", { source: "imported" }),
      makeEntry(anchorDate, offset, TUTORIAL_DEMO_USER_ID, "intermittent_fasting", 14 + (focusSeed % 4), "private"),
      makeEntry(anchorDate, offset, TUTORIAL_DEMO_USER_ID, "tutorial_meditation", 8 + focusSeed * 2, "private"),
      makeEntry(anchorDate, offset, TUTORIAL_DEMO_USER_ID, "tutorial_wellbeing", 6 + (focusSeed % 4), "status", {
        submetricValues: {
          energy: 5 + (focusSeed % 5),
          mood: 6 + (focusSeed % 4),
          stress: 6 - (focusSeed % 4),
        },
      }),
    );
    if (offset % 4 === 0) {
      entries.push(
        makeEntry(anchorDate, offset, TUTORIAL_DEMO_USER_ID, "sleep", 420 + focusSeed * 12, "private", { source: "imported" }),
        makeEntry(anchorDate, offset, TUTORIAL_DEMO_USER_ID, "body_fat", Number((24.2 + offset * 0.012).toFixed(1)), "private", { source: "imported" }),
        makeEntry(anchorDate, offset, TUTORIAL_DEMO_USER_ID, "lean_body_mass", Number((61.2 - offset * 0.006).toFixed(1)), "private", { source: "imported" }),
      );
    }
  }

  const today = shiftDate(anchorDate, 0);
  entries.push(
    {
      ...makeEntry(anchorDate, 0, TUTORIAL_DEMO_USER_ID, "food", 620, "private", {
        label: "Breakfast bowl",
        note: "Oats, yoghurt, berries and almonds",
        imageUri: DEMO_PROGRESS_URIS[0],
        nutrition: {
          mealType: "breakfast",
          proteinG: 31,
          fatG: 18,
          carbsG: 74,
          fiberG: 12,
          sodiumMg: 280,
          sugarG: 19,
          potassiumMg: 720,
        },
      }),
      id: `tutorial-entry-${today}-food-breakfast`,
      recordedAt: instant(anchorDate, 0, "08:10"),
    },
    {
      ...makeEntry(anchorDate, 0, TUTORIAL_DEMO_USER_ID, "blood_pressure_systolic", 118, "private", {
        label: "Morning reading",
        submetricValues: { systolic: 118, diastolic: 76, pulse: 64 },
        source: "imported",
      }),
      id: `tutorial-entry-${today}-blood-pressure`,
      recordedAt: instant(anchorDate, 0, "07:40"),
    },
    makeEntry(anchorDate, 0, TUTORIAL_DEMO_USER_ID, "blood_pressure_diastolic", 76, "private", { source: "imported" }),
    makeEntry(anchorDate, 0, TUTORIAL_DEMO_USER_ID, "pulse", 64, "private", { source: "imported" }),
  );
  return entries;
}

function tutorialTodos(anchorDate: string): TodoItem[] {
  return [
    {
      id: "tutorial-todo-plan-week",
      title: "Plan the week",
      description: "Choose three priorities before Monday starts.",
      createdAt: instant(anchorDate, -7, "17:00"),
      dueAt: instant(anchorDate, 0, "20:00"),
      scheduledStartAt: instant(anchorDate, 0, "18:30"),
      scheduledEndAt: instant(anchorDate, 0, "19:00"),
      priority: "high",
      reminders: [
        { id: "tutorial-todo-plan-reminder", daysBeforeDue: 0, time: "17:30" },
      ],
      completedDates: [],
      order: 0,
      pinnedAt: instant(anchorDate, -2, "09:00"),
    },
    {
      id: "tutorial-todo-morning-walk",
      title: "Ten-minute morning walk",
      createdAt: instant(anchorDate, -30, "08:00"),
      scheduledStartAt: instant(anchorDate, 0, "08:30"),
      scheduledEndAt: instant(anchorDate, 0, "08:40"),
      priority: "normal",
      recurrence: { mode: "selected_days", daysOfWeek: [1, 2, 3, 4, 5] },
      reminders: [
        {
          id: "tutorial-todo-walk-reminder",
          time: "08:20",
          schedule: { mode: "selected_days", daysOfWeek: [1, 2, 3, 4, 5] },
        },
      ],
      completedDates: [shiftDate(anchorDate, -2), shiftDate(anchorDate, -1)],
      order: 1,
    },
    {
      id: "tutorial-todo-groceries",
      title: "Buy vegetables and yoghurt",
      createdAt: instant(anchorDate, -2, "12:00"),
      dueAt: instant(anchorDate, 0, "17:00"),
      priority: "urgent",
      reminders: [
        { id: "tutorial-todo-grocery-reminder", at: instant(anchorDate, 0, "16:00") },
      ],
      completedDates: [],
      order: 2,
    },
    {
      id: "tutorial-todo-review-budget",
      title: "Review monthly budget",
      createdAt: instant(anchorDate, -14, "10:00"),
      dueAt: instant(anchorDate, 3, "18:00"),
      priority: "low",
      recurrence: { mode: "days_of_month", daysOfMonth: [1, 15] },
      reminders: [
        {
          id: "tutorial-todo-budget-reminder",
          time: "10:00",
          daysBeforeDue: 1,
          repeatDailyUntilDue: true,
        },
      ],
      completedDates: [],
      skippedDates: [shiftDate(anchorDate, -1)],
      order: 3,
    },
  ];
}

function tutorialReminders(anchorDate: string): CalendarReminder[] {
  return [
    {
      id: "tutorial-reminder-mobility",
      title: "Mobility break",
      kind: "general",
      time: "10:30",
      durationMinutes: 10,
      schedule: { mode: "daily" },
      enabled: true,
    },
    {
      id: "tutorial-reminder-reading",
      title: "Read before bed",
      kind: "tracker",
      metricId: "reading",
      time: "21:00",
      durationMinutes: 30,
      schedule: { mode: "selected_days", daysOfWeek: [0, 2, 4, 6] },
      enabled: true,
    },
    {
      id: "tutorial-reminder-todo-plan",
      title: "Plan the week",
      kind: "todo",
      todoId: "tutorial-todo-plan-week",
      time: "18:30",
      durationMinutes: 30,
      schedule: { mode: "once", anchorDate },
      enabled: true,
    },
    {
      id: "tutorial-reminder-workout",
      title: "Full-body workout",
      kind: "tracker",
      metricId: "workout",
      time: "17:30",
      durationMinutes: 60,
      schedule: { mode: "selected_days", daysOfWeek: [1, 3, 5] },
      enabled: true,
    },
  ];
}

function tutorialJournal(anchorDate: string): JournalNote[] {
  return [
    {
      id: "tutorial-note-weekly-review",
      userId: TUTORIAL_DEMO_USER_ID,
      title: "Weekly review",
      body: "# Weekly review\n**Win:** kept the morning routine consistent.\n- [x] Three workouts\n- [ ] Protect Friday evening\n> Small repeatable actions beat perfect plans.\n[color=#2877D4]Next focus: sleep before 23:00.[/color]",
      createdAt: instant(anchorDate, -1, "19:00"),
      updatedAt: instant(anchorDate, -1, "19:20"),
      localDate: shiftDate(anchorDate, -1),
      metricIds: ["sleep", "workout", "tutorial_wellbeing"],
      labels: ["weekly_review", "recovery"],
    },
    {
      id: "tutorial-note-recipe",
      userId: TUTORIAL_DEMO_USER_ID,
      title: "Breakfast idea",
      body: "## Berry oat bowl\n- Oats and yoghurt\n- Frozen berries\n- Almonds\n[Open the food tracker](https://sethstar-habhub.expo.app/log)",
      createdAt: instant(anchorDate, 0, "08:20"),
      updatedAt: instant(anchorDate, 0, "08:25"),
      localDate: shiftDate(anchorDate, 0),
      metricIds: ["food"],
      labels: ["recipe", "breakfast"],
      imageUri: DEMO_PROGRESS_URIS[1],
      drawing: {
        version: 1,
        strokes: [
          {
            id: "tutorial-stroke-arrow",
            color: "#D64545",
            width: 4,
            points: [
              [0.18, 0.3],
              [0.34, 0.22],
              [0.48, 0.28],
              [0.55, 0.4],
            ],
          },
        ],
      },
    },
  ];
}

function tutorialGymPlans(anchorDate: string): GymPlan[] {
  return [
    {
      id: "tutorial-plan-full-body",
      userId: TUTORIAL_DEMO_USER_ID,
      name: "Full-body strength",
      createdAt: instant(anchorDate, -60, "09:00"),
      updatedAt: instant(anchorDate, -5, "18:00"),
      exercises: [
        {
          id: "tutorial-plan-squat",
          exerciseKey: "back_squat",
          name: "Back squat",
          muscleGroups: ["quadriceps", "glutes", "hamstrings"],
          targetSets: 3,
          targetReps: 8,
          startingWeightKg: 70,
          trackingMode: "load_reps",
          notes: "Controlled descent",
          supersets: [
            {
              setIndex: 1,
              superset: {
                exerciseKey: "plank",
                name: "Plank",
                muscleGroups: ["abs"],
                reps: 1,
                weightKg: 0,
                trackingMode: "duration",
              },
            },
          ],
        },
        {
          id: "tutorial-plan-row",
          exerciseKey: "barbell_row",
          name: "Barbell row",
          muscleGroups: ["back", "biceps"],
          targetSets: 3,
          targetReps: 10,
          startingWeightKg: 42.5,
          trackingMode: "load_reps",
        },
        {
          id: "tutorial-plan-cycle",
          exerciseKey: "cycling",
          name: "Cycling",
          muscleGroups: ["quadriceps", "calves"],
          targetSets: 1,
          targetReps: 1,
          targetDurationMinutes: 12,
          trackingMode: "duration",
        },
      ],
    },
    {
      id: "tutorial-group-plan-upper",
      userId: `group:${TUTORIAL_DEMO_GROUP_ID}`,
      name: "Group upper-body circuit",
      createdAt: instant(anchorDate, -40, "10:00"),
      updatedAt: instant(anchorDate, -3, "10:00"),
      exercises: [
        {
          id: "tutorial-plan-pushup",
          exerciseKey: "push_up",
          name: "Push-up",
          muscleGroups: ["chest", "triceps", "shoulders"],
          targetSets: 4,
          targetReps: 12,
          trackingMode: "reps",
        },
      ],
    },
  ];
}

function tutorialGymSessions(anchorDate: string): GymSession[] {
  return [-28, -21, -14, -7, 0].map((offset, index) => ({
    id: `tutorial-session-${shiftDate(anchorDate, offset)}`,
    userId: TUTORIAL_DEMO_USER_ID,
    planId: "tutorial-plan-full-body",
    name: "Full-body strength",
    localDate: shiftDate(anchorDate, offset),
    recordedAt: instant(anchorDate, offset, "19:00"),
    startedAt: instant(anchorDate, offset, "17:45"),
    completedAt: instant(anchorDate, offset, "18:42"),
    pausedSeconds: 95,
    setStartDelaySeconds: 3,
    durationMinutes: 57,
    calories: 410 + index * 8,
    calorieCalculationMode: index % 2 ? "session_met" : "set_aware",
    caloriesManual: false,
    intensity: "vigorous",
    notes: index === 4 ? "Smooth reps; add 2.5 kg next week." : undefined,
    visibility: "group",
    exercises: [
      {
        id: `tutorial-session-${index}-squat`,
        exerciseKey: "back_squat",
        name: "Back squat",
        muscleGroups: ["quadriceps", "glutes", "hamstrings"],
        trackingMode: "load_reps",
        completed: true,
        restAfterSeconds: 120,
        restTargetSeconds: 90,
        sets: [0, 1, 2].map((setIndex) => ({
          id: `tutorial-session-${index}-squat-${setIndex}`,
          reps: 8,
          weightKg: 67.5 + index * 1.25,
          completed: true,
          workSeconds: 38 + setIndex * 2,
          restSeconds: 80 + setIndex * 8,
          restTargetSeconds: 90,
          superset:
            setIndex === 1
              ? {
                  exerciseKey: "plank",
                  name: "Plank",
                  muscleGroups: ["abs"],
                  reps: 1,
                  weightKg: 0,
                  trackingMode: "duration",
                  workSeconds: 45,
                }
              : undefined,
        })),
      },
      {
        id: `tutorial-session-${index}-row`,
        exerciseKey: "barbell_row",
        name: "Barbell row",
        muscleGroups: ["back", "biceps"],
        trackingMode: "load_reps",
        completed: true,
        sets: [0, 1, 2].map((setIndex) => ({
          id: `tutorial-session-${index}-row-${setIndex}`,
          reps: 10,
          weightKg: 40 + index * 1.25,
          completed: true,
          workSeconds: 34,
          restSeconds: 65,
          restTargetSeconds: 75,
        })),
      },
    ],
  }));
}

function tutorialChallenges(anchorDate: string): GroupChallenge[] {
  return [
    {
      id: "tutorial-challenge-steps-live",
      groupId: TUTORIAL_DEMO_GROUP_ID,
      creatorId: TUTORIAL_DEMO_USER_ID,
      metricId: "steps",
      title: "Wednesday 12k",
      target: 12_000,
      localDate: shiftDate(anchorDate, 0),
      participantIds: [TUTORIAL_DEMO_USER_ID, "tutorial-mina", "tutorial-jonah"],
      createdAt: instant(anchorDate, -4, "12:00"),
      updatedAt: instant(anchorDate, -1, "09:00"),
    },
    ...[-43, -27, -11].map((offset, index) => ({
      id: `tutorial-challenge-water-win-${index + 1}`,
      groupId: TUTORIAL_DEMO_GROUP_ID,
      creatorId: index % 2 ? "tutorial-mina" : TUTORIAL_DEMO_USER_ID,
      metricId: "water",
      title: "Hydration sprint",
      target: 2.5,
      localDate: shiftDate(anchorDate, offset),
      participantIds: [TUTORIAL_DEMO_USER_ID, "tutorial-mina", "tutorial-lina"],
      createdAt: instant(anchorDate, offset - 2, "10:00"),
      updatedAt: instant(anchorDate, offset, "23:00"),
    })),
  ];
}

function tutorialScreenTime(anchorDate: string): TutorialScreenTimeReport {
  const from = new Date(`${anchorDate}T00:00:00.000Z`).getTime();
  const to = new Date(`${anchorDate}T18:00:00.000Z`).getTime();
  const apps: TutorialScreenTimeApp[] = [
    ["app.demo.video", "Video", 2_940_000, "Entertainment"],
    ["app.demo.browser", "Browser", 2_160_000, "Productivity"],
    ["app.demo.messages", "Messages", 1_320_000, "Communication"],
    ["app.demo.reader", "Reader", 960_000, "Books"],
    ["app.demo.maps", "Maps", 420_000, "Navigation"],
  ].map(([packageName, appName, foregroundMs, category], index) => ({
    packageName: String(packageName),
    appName: String(appName),
    foregroundMs: Number(foregroundMs),
    lastTimeUsed: to - index * 1_800_000,
    category: String(category),
    isSystemApp: false,
  }));
  return {
    supported: true,
    accessGranted: true,
    from,
    to,
    screenTimeMs: apps.reduce((sum, app) => sum + app.foregroundMs, 0),
    approximate: true,
    calculationMethod: "foreground_events",
    apps,
  };
}

/**
 * Builds an isolated, credential-free state for guided practice. The same
 * anchor date always produces the same ids, values and timestamps; production
 * code can pass today's local date while validators use the fixed fixture.
 */
export function createTutorialDemoState(anchorDate: string): TutorialDemoBundle {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate))
    throw new Error("Tutorial demo anchor must use YYYY-MM-DD.");
  const base = createInitialState();
  const metrics = tutorialMetrics(anchorDate);
  const gymPlans = tutorialGymPlans(anchorDate);
  const members = [
    {
      id: TUTORIAL_DEMO_USER_ID,
      name: "You",
      initials: "YO",
      color: "#0FBFB8",
      role: "owner" as const,
      lastSeenAt: instant(anchorDate, 0, "17:58"),
      lastDataSyncedAt: instant(anchorDate, 0, "17:57"),
    },
    {
      id: "tutorial-mina",
      name: "Mina",
      initials: "MI",
      color: "#7756D9",
      role: "admin" as const,
      lastSeenAt: instant(anchorDate, 0, "17:50"),
      lastDataSyncedAt: instant(anchorDate, 0, "17:49"),
    },
    {
      id: "tutorial-jonah",
      name: "Jonah",
      initials: "JO",
      color: "#D95852",
      role: "member" as const,
      lastSeenAt: instant(anchorDate, 0, "16:20"),
      lastDataSyncedAt: instant(anchorDate, 0, "16:18"),
    },
    {
      id: "tutorial-lina",
      name: "Lina",
      initials: "LI",
      color: "#3478D4",
      role: "member" as const,
      lastSeenAt: instant(anchorDate, -1, "21:00"),
      lastDataSyncedAt: instant(anchorDate, -1, "20:58"),
    },
  ];
  const group = {
    id: TUTORIAL_DEMO_GROUP_ID,
    configurationRevision: 7,
    name: "Demo crew",
    inviteCode: "DEMO-ONLY",
    templateName: "Guided practice",
    members,
    streakRestDaysPerWeek: 1,
    themeColor: "#285C66",
    requireMemberApproval: true,
    pendingMembers: [
      {
        id: "tutorial-pending",
        name: "Pending member",
        initials: "PM",
        color: "#E08A32",
        role: "member" as const,
      },
    ],
    metricConfiguration: metrics,
    gymPlans: [gymPlans[1]],
  };
  const entries = tutorialEntries(anchorDate);
  for (const offset of [-2, -1]) {
    const workout = entries.find(
      (entry) =>
        entry.localDate === shiftDate(anchorDate, offset) &&
        entry.userId === TUTORIAL_DEMO_USER_ID &&
        entry.metricId === "workout",
    );
    if (workout) workout.value = true;
  }
  const wellbeing = entries.find(
    (entry) =>
      entry.localDate === anchorDate &&
      entry.userId === TUTORIAL_DEMO_USER_ID &&
      entry.metricId === "tutorial_wellbeing",
  );
  if (wellbeing)
    wellbeing.submetricValues = { energy: 8, mood: 8, stress: 3 };
  const trackedIds = [
    "steps",
    "food",
    "exercise",
    "water",
    "workout",
    "reading",
    "tutorial_meditation",
    "tutorial_wellbeing",
  ];

  const appState: AppState = {
    ...base,
    currentUserId: TUTORIAL_DEMO_USER_ID,
    group,
    groups: [group],
    energyProfiles: {
      [TUTORIAL_DEMO_USER_ID]: {
        age: 32,
        sex: "unspecified",
        heightCm: 172,
        startingWeightKg: 84,
        weightKg: 82.4,
        bodyFatPercent: 24.2,
        leanBodyMassKg: 61.2,
        targetWeightKg: 76,
        activityLevel: "moderate",
        desiredWeeklyLossKg: 0.4,
      },
      "tutorial-mina": {
        age: 30,
        sex: "female",
        heightCm: 166,
        weightKg: 68,
        targetWeightKg: 64,
        activityLevel: "moderate",
        desiredWeeklyLossKg: 0.25,
      },
      "tutorial-jonah": {
        age: 35,
        sex: "male",
        heightCm: 181,
        weightKg: 90,
        targetWeightKg: 84,
        activityLevel: "light",
        desiredWeeklyLossKg: 0.5,
      },
      "tutorial-lina": {
        age: 28,
        sex: "female",
        heightCm: 170,
        weightKg: 65,
        targetWeightKg: 65,
        activityLevel: "very_active",
        desiredWeeklyLossKg: 0,
      },
    },
    metrics,
    entries,
    photos: [-56, -28, 0].map((offset, index) => ({
      id: `tutorial-photo-${shiftDate(anchorDate, offset)}`,
      userId: TUTORIAL_DEMO_USER_ID,
      uri: DEMO_PROGRESS_URIS[index % DEMO_PROGRESS_URIS.length],
      caption: index === 2 ? "Current check-in" : "Progress check-in",
      localDate: shiftDate(anchorDate, offset),
      createdAt: instant(anchorDate, offset, "08:00"),
      capturedAt: instant(anchorDate, offset, "08:00"),
      visibility: index === 2 ? "private" : "group",
    })),
    messages: [
      {
        id: "tutorial-message-welcome",
        groupId: TUTORIAL_DEMO_GROUP_ID,
        senderId: "system",
        text: "Demo crew started a new week.",
        createdAt: instant(anchorDate, -1, "08:00"),
        kind: "achievement",
        conversationId: "group",
      },
      {
        id: "tutorial-message-mina",
        groupId: TUTORIAL_DEMO_GROUP_ID,
        senderId: "tutorial-mina",
        text: "Anyone joining the mobility break?",
        createdAt: instant(anchorDate, 0, "09:45"),
        kind: "message",
        conversationId: "group",
      },
      {
        id: "tutorial-message-you",
        groupId: TUTORIAL_DEMO_GROUP_ID,
        senderId: TUTORIAL_DEMO_USER_ID,
        text: "I am in — ten minutes at 10:30.",
        createdAt: instant(anchorDate, 0, "09:48"),
        kind: "cheer",
        conversationId: "group",
      },
      {
        id: "tutorial-message-direct",
        groupId: TUTORIAL_DEMO_GROUP_ID,
        senderId: "tutorial-jonah",
        recipientId: TUTORIAL_DEMO_USER_ID,
        text: "Nice consistency on the workouts.",
        createdAt: instant(anchorDate, 0, "12:10"),
        kind: "message",
        conversationId: "direct:tutorial-jonah:tutorial-you",
        imageUri: DEMO_PROGRESS_URIS[2],
      },
    ],
    dailyMetricStatuses: [
      {
        groupId: TUTORIAL_DEMO_GROUP_ID,
        metricId: "steps",
        userId: "tutorial-jonah",
        localDate: anchorDate,
        goalReached: false,
        scoreContribution: 18,
        goalProgress: 0.82,
        goalKind: "at_least",
        goalTarget: 10_000,
        visibility: "status",
        goalEligible: true,
        hasData: true,
        syncedAt: instant(anchorDate, 0, "17:40"),
      },
    ],
    gymPlans,
    gymSessions: tutorialGymSessions(anchorDate),
    gymExerciseGoals: {
      back_squat: { targetOneRepMaxKg: 100, targetWeightKg: 82.5, targetReps: 8 },
      barbell_row: { targetOneRepMaxKg: 68, targetWeightKg: 50, targetReps: 10 },
    },
    todos: tutorialTodos(anchorDate),
    journalNotes: tutorialJournal(anchorDate),
    calendarReminders: tutorialReminders(anchorDate),
    // Timers are created only when the timer tutorial reaches its practice
    // step. Starting the tour must never show a leftover live timer overlay.
    activityTimers: [],
    activeTimer: undefined,
    settings: {
      ...base.settings,
      energyProfile: {
        age: 32,
        sex: "unspecified",
        heightCm: 172,
        startingWeightKg: 84,
        weightKg: 82.4,
        bodyFatPercent: 24.2,
        leanBodyMassKg: 61.2,
        targetWeightKg: 76,
        activityLevel: "moderate",
        desiredWeeklyLossKg: 0.4,
      },
      healthSync: {
        ...base.settings.healthSync,
        enabled: true,
        backgroundAccess: true,
      },
      healthHistoryDays: 90,
      // End-of-day goal types must be final in the complete-day tutorial
      // fixture so their genuine celebration state can be demonstrated.
      dayEndTime: "00:01",
      onboardingComplete: true,
      onboardingVersion: 3,
      tutorialComplete: false,
      advancedTutorialComplete: false,
      selectedGoals: trackedIds,
      showCalendar: true,
      showJournal: true,
      showPerformance: true,
      showStatus: true,
      showGym: true,
      showChat: true,
      showLeaderboard: true,
      showLog: true,
      showAllTodayTiles: false,
      todayTileLimit: 6,
      showUntrackedToday: true,
      showUntrackedProgress: true,
      todosBelowGoals: false,
      todayHistoryByMetric: { steps: "week", water: "week", weight: "month" },
      todayHistoryRange: "week",
      todayHistoryCollapsed: false,
      trackerViewFilters: [
        {
          id: "tutorial-view-basics",
          name: "Basics",
          metricIds: [
            "steps",
            "food",
            "exercise",
            "water",
            "tutorial_meditation",
          ],
          includeTodos: true,
          todoIds: ["tutorial-todo-plan-week", "tutorial-todo-groceries"],
          visible: true,
        },
        {
          id: "tutorial-view-focus",
          name: "Focus",
          metricIds: ["reading", "study", "work", "screen_time", "tutorial_focus_score"],
          includeTodos: false,
          visible: true,
        },
        {
          id: "tutorial-view-hidden",
          name: "Health review",
          metricIds: ["sleep", "blood_pressure_systolic", "weight"],
          includeTodos: false,
          visible: false,
        },
      ],
      activeTodayTrackerViewFilterId: "tutorial-view-basics",
      activeProgressTrackerViewFilterId: undefined,
      activePerformanceTrackerViewFilterId: undefined,
      scheduleViewFilters: [
        {
          id: "tutorial-schedule-focus",
          name: "Focus day",
          includeTodos: true,
          includeReminders: true,
          logMetricIds: ["reading", "study", "work"],
        },
        {
          id: "tutorial-schedule-health",
          name: "Health",
          includeTodos: false,
          includeReminders: true,
          logMetricIds: ["steps", "exercise", "water", "sleep"],
        },
      ],
      activeScheduleViewFilterId: "tutorial-schedule-focus",
      calendarEventOrder: [
        "todo:tutorial-todo-plan-week",
        "reminder:tutorial-reminder-mobility",
        "log:reading",
      ],
      progressViewMode: "overview",
      progressLayoutAvailability: "both",
      compactProgressGrid: false,
      progressHistoryRange: "month",
      progressHistoryAnchor: anchorDate,
      progressMetricIds: [
        "tracked_goals",
        "steps",
        "water",
        "screen_time",
        "tutorial_wellbeing",
        "tutorial_focus_score",
      ],
      progressMetricOrderIds: [
        "tracked_goals",
        "steps",
        "tutorial_wellbeing",
        "water",
        "screen_time",
        "tutorial_focus_score",
      ],
      progressPinnedMetricIds: ["tracked_goals", "steps"],
      performanceMetricIds: [
        "steps",
        "exercise",
        "water",
        "reading",
        "screen_time",
        "tutorial_wellbeing",
      ],
      performanceMetricOrderIds: [
        "steps",
        "screen_time",
        "water",
        "exercise",
        "reading",
        "tutorial_wellbeing",
      ],
      performancePinnedMetricIds: ["steps", "screen_time"],
      performanceRange: "month",
      leaderboardMetricIdsByGroup: {
        [TUTORIAL_DEMO_GROUP_ID]: ["__score", "steps", "water", "workout"],
      },
      leaderboardPinnedMetricIdsByGroup: {
        [TUTORIAL_DEMO_GROUP_ID]: ["steps"],
      },
      leaderboardCardOrderByGroup: {
        [TUTORIAL_DEMO_GROUP_ID]: ["__score", "steps", "water", "workout"],
      },
      showUntrackedLeaderboardByGroup: { [TUTORIAL_DEMO_GROUP_ID]: true },
      comparisonMetricIdsByGroup: {
        [TUTORIAL_DEMO_GROUP_ID]: ["steps", "water", "workout"],
      },
      comparisonPeriodByGroup: { [TUTORIAL_DEMO_GROUP_ID]: "month" },
      badgeShowcaseByGroup: {
        [TUTORIAL_DEMO_GROUP_ID]: [
          "personal-best:tutorial-you:steps",
          "challenge-wins:tutorial-you",
          "earned:check-ins:tutorial-you:50",
        ],
      },
      memberNicknamesByGroup: {
        [TUTORIAL_DEMO_GROUP_ID]: { "tutorial-jonah": "J" },
      },
      statusAvatarCalculationSource: "bmi",
      statusAvatarStyle: "body_model",
      fastingRuntimeByMetric: {
        intermittent_fasting: {
          startedAt: instant(anchorDate, -1, "20:00"),
          startedManually: false,
        },
      },
      notifications: {
        ...base.settings.notifications,
        pushEnabled: true,
        reminders: true,
        todoReminders: true,
        chatMessages: true,
        quietHoursEnabled: true,
        quietHoursStart: "22:30",
        quietHoursEnd: "07:30",
      },
    },
    trackedGoalPeriods: Object.fromEntries(
      metrics.map((metric) => [
        metric.id,
        trackedIds.includes(metric.id)
          ? [{ from: shiftDate(anchorDate, -89) }]
          : [],
      ]),
    ),
    selectedGroupMetricId: "steps",
    lastSavedAt: instant(anchorDate, 0, "18:00"),
  };

  return {
    schemaVersion: TUTORIAL_DEMO_SCHEMA_VERSION,
    anchorDate,
    appState,
    groupChallenges: tutorialChallenges(anchorDate),
    screenTimeReport: tutorialScreenTime(anchorDate),
  };
}
