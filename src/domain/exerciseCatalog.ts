import {
  ExerciseCategory,
  MuscleGroup,
  WorkoutExerciseTrackingField,
  WorkoutExerciseTrackingMode,
} from "@/src/types";

export type { ExerciseCategory } from "@/src/types";

export type ExerciseHealthAliases = {
  /** Values returned as ExerciseSession.exerciseType. */
  healthConnectSessionTypes?: number[];
  /** Values returned as ExerciseSession.segments[].segmentType. */
  healthConnectSegmentTypes?: number[];
  /** Raw HKWorkoutActivityType values returned by Apple HealthKit. */
  appleWorkoutTypes?: number[];
  /** Current Samsung Health SDK enum names, used for title normalization. */
  samsungTypes?: string[];
};

export type ExerciseCatalogItem = {
  key: string;
  name: string;
  muscles: MuscleGroup[];
  equipment: "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight" | "other";
  category: ExerciseCategory;
  trackingMode: WorkoutExerciseTrackingMode;
  /** Optional multi-field set editor; legacy catalog rows resolve from mode. */
  trackingFields?: WorkoutExerciseTrackingField[];
  aliases: string[];
  health?: ExerciseHealthAliases;
  supportsDistance?: boolean;
  /** Session estimates use the overall intensity MET; this helps custom mixes. */
  met: number;
};

type ExerciseSeed = Omit<
  ExerciseCatalogItem,
  "category" | "trackingMode" | "aliases"
> &
  Partial<Pick<ExerciseCatalogItem, "category" | "trackingMode" | "aliases">>;

export const EXERCISE_CATEGORY_LABELS: Record<ExerciseCategory, string> = {
  strength: "Strength",
  cardio: "Cardio",
  conditioning: "Conditioning",
  mobility: "Mobility & recovery",
  mind_body: "Mind & body",
  team_sport: "Team sports",
  racket_sport: "Racket sports",
  combat: "Combat sports",
  outdoor: "Outdoor",
  water: "Water sports",
  winter: "Snow & ice",
  multisport: "Multisport",
  other: "Other activities",
};

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  abs: "Core / abs",
  glutes: "Glutes",
  quadriceps: "Quadriceps",
  hamstrings: "Hamstrings",
  calves: "Calves",
  full_body: "Full body",
};

const STRENGTH_EXERCISES: ExerciseSeed[] = [
  { key: "barbell_bench_press", name: "Barbell bench press", muscles: ["chest", "triceps", "shoulders"], equipment: "barbell", met: 5 },
  { key: "dumbbell_bench_press", name: "Dumbbell bench press", muscles: ["chest", "triceps", "shoulders"], equipment: "dumbbell", met: 5 },
  { key: "incline_bench_press", name: "Incline bench press", muscles: ["chest", "shoulders", "triceps"], equipment: "barbell", met: 5 },
  { key: "chest_fly", name: "Chest fly", muscles: ["chest"], equipment: "machine", met: 3.5 },
  { key: "push_up", name: "Push-up", muscles: ["chest", "triceps", "shoulders"], equipment: "bodyweight", met: 3.8 },
  { key: "overhead_press", name: "Overhead press", muscles: ["shoulders", "triceps"], equipment: "barbell", met: 5 },
  { key: "dumbbell_shoulder_press", name: "Dumbbell shoulder press", muscles: ["shoulders", "triceps"], equipment: "dumbbell", met: 5 },
  { key: "lateral_raise", name: "Lateral raise", muscles: ["shoulders"], equipment: "dumbbell", met: 3.5 },
  { key: "rear_delt_fly", name: "Rear-delt fly", muscles: ["shoulders", "back"], equipment: "dumbbell", met: 3.5 },
  { key: "triceps_pushdown", name: "Triceps pushdown", muscles: ["triceps"], equipment: "cable", met: 3.5 },
  { key: "skull_crusher", name: "Skull crusher", muscles: ["triceps"], equipment: "barbell", met: 3.5 },
  { key: "deadlift", name: "Deadlift", muscles: ["back", "glutes", "hamstrings", "forearms"], equipment: "barbell", met: 5 },
  { key: "romanian_deadlift", name: "Romanian deadlift", muscles: ["hamstrings", "glutes", "back"], equipment: "barbell", met: 5 },
  { key: "barbell_row", name: "Barbell row", muscles: ["back", "biceps", "forearms"], equipment: "barbell", met: 5 },
  { key: "seated_cable_row", name: "Seated cable row", muscles: ["back", "biceps"], equipment: "cable", met: 3.5 },
  { key: "lat_pulldown", name: "Lat pulldown", muscles: ["back", "biceps"], equipment: "cable", met: 3.5 },
  { key: "pull_up", name: "Pull-up / chin-up", muscles: ["back", "biceps", "forearms"], equipment: "bodyweight", met: 3.8 },
  { key: "face_pull", name: "Face pull", muscles: ["back", "shoulders"], equipment: "cable", met: 3.5 },
  { key: "barbell_curl", name: "Barbell curl", muscles: ["biceps", "forearms"], equipment: "barbell", met: 3.5 },
  { key: "dumbbell_curl", name: "Dumbbell curl", muscles: ["biceps", "forearms"], equipment: "dumbbell", met: 3.5 },
  { key: "hammer_curl", name: "Hammer curl", muscles: ["biceps", "forearms"], equipment: "dumbbell", met: 3.5 },
  { key: "back_squat", name: "Back squat", muscles: ["quadriceps", "glutes", "hamstrings"], equipment: "barbell", met: 5 },
  { key: "front_squat", name: "Front squat", muscles: ["quadriceps", "glutes", "abs"], equipment: "barbell", met: 5 },
  { key: "leg_press", name: "Leg press", muscles: ["quadriceps", "glutes", "hamstrings"], equipment: "machine", met: 5 },
  { key: "leg_extension", name: "Leg extension", muscles: ["quadriceps"], equipment: "machine", met: 3.5 },
  { key: "leg_curl", name: "Leg curl", muscles: ["hamstrings"], equipment: "machine", met: 3.5 },
  { key: "walking_lunge", name: "Walking lunge", muscles: ["quadriceps", "glutes", "hamstrings"], equipment: "dumbbell", met: 5 },
  { key: "hip_thrust", name: "Hip thrust", muscles: ["glutes", "hamstrings"], equipment: "barbell", met: 5 },
  { key: "calf_raise", name: "Calf raise", muscles: ["calves"], equipment: "machine", met: 3.5 },
  { key: "plank", name: "Plank", muscles: ["abs"], equipment: "bodyweight", met: 2.8 },
  { key: "crunch", name: "Crunch", muscles: ["abs"], equipment: "bodyweight", met: 3.8, trackingMode: "reps", health: { healthConnectSegmentTypes: [10], samsungTypes: ["CRUNCH"] } },
  { key: "cable_crunch", name: "Cable crunch", muscles: ["abs"], equipment: "cable", met: 3.5 },
  { key: "hanging_leg_raise", name: "Hanging leg raise", muscles: ["abs", "forearms"], equipment: "bodyweight", met: 3.8 },
  { key: "farmer_carry", name: "Farmer carry", muscles: ["forearms", "shoulders", "abs", "full_body"], equipment: "dumbbell", met: 6 },
  { key: "kettlebell_swing", name: "Kettlebell swing", muscles: ["glutes", "hamstrings", "back", "full_body"], equipment: "other", met: 9.8 },
  { key: "decline_bench_press", name: "Decline bench press", muscles: ["chest", "triceps"], equipment: "barbell", met: 5 },
  { key: "incline_dumbbell_press", name: "Incline dumbbell press", muscles: ["chest", "shoulders", "triceps"], equipment: "dumbbell", met: 5 },
  { key: "cable_fly", name: "Cable fly", muscles: ["chest"], equipment: "cable", met: 3.5 },
  { key: "chest_dip", name: "Chest dip", muscles: ["chest", "triceps", "shoulders"], equipment: "bodyweight", met: 5 },
  { key: "arnold_press", name: "Arnold press", muscles: ["shoulders", "triceps"], equipment: "dumbbell", met: 5 },
  { key: "upright_row", name: "Upright row", muscles: ["shoulders", "forearms"], equipment: "barbell", met: 3.5 },
  { key: "cable_lateral_raise", name: "Cable lateral raise", muscles: ["shoulders"], equipment: "cable", met: 3.5 },
  { key: "close_grip_bench", name: "Close-grip bench press", muscles: ["triceps", "chest"], equipment: "barbell", met: 5 },
  { key: "overhead_triceps_extension", name: "Overhead triceps extension", muscles: ["triceps"], equipment: "cable", met: 3.5 },
  { key: "assisted_pull_up", name: "Assisted pull-up", muscles: ["back", "biceps"], equipment: "machine", met: 3.5 },
  { key: "single_arm_dumbbell_row", name: "Single-arm dumbbell row", muscles: ["back", "biceps"], equipment: "dumbbell", met: 5 },
  { key: "t_bar_row", name: "T-bar row", muscles: ["back", "biceps"], equipment: "machine", met: 5 },
  { key: "straight_arm_pulldown", name: "Straight-arm pulldown", muscles: ["back"], equipment: "cable", met: 3.5 },
  { key: "back_extension", name: "Back extension", muscles: ["back", "glutes", "hamstrings"], equipment: "bodyweight", met: 3.5 },
  { key: "preacher_curl", name: "Preacher curl", muscles: ["biceps"], equipment: "machine", met: 3.5 },
  { key: "incline_dumbbell_curl", name: "Incline dumbbell curl", muscles: ["biceps"], equipment: "dumbbell", met: 3.5 },
  { key: "reverse_curl", name: "Reverse curl", muscles: ["forearms", "biceps"], equipment: "barbell", met: 3.5 },
  { key: "hack_squat", name: "Hack squat", muscles: ["quadriceps", "glutes"], equipment: "machine", met: 5 },
  { key: "goblet_squat", name: "Goblet squat", muscles: ["quadriceps", "glutes", "abs"], equipment: "dumbbell", met: 5 },
  { key: "bulgarian_split_squat", name: "Bulgarian split squat", muscles: ["quadriceps", "glutes", "hamstrings"], equipment: "dumbbell", met: 5 },
  { key: "sumo_deadlift", name: "Sumo deadlift", muscles: ["glutes", "hamstrings", "back", "quadriceps"], equipment: "barbell", met: 5 },
  { key: "good_morning", name: "Good morning", muscles: ["hamstrings", "glutes", "back"], equipment: "barbell", met: 5 },
  { key: "glute_bridge", name: "Glute bridge", muscles: ["glutes", "hamstrings"], equipment: "bodyweight", met: 3.5 },
  { key: "cable_kickback", name: "Cable glute kickback", muscles: ["glutes"], equipment: "cable", met: 3.5 },
  { key: "hip_abduction", name: "Hip abduction", muscles: ["glutes"], equipment: "machine", met: 3.5 },
  { key: "seated_calf_raise", name: "Seated calf raise", muscles: ["calves"], equipment: "machine", met: 3.5 },
  { key: "ab_wheel_rollout", name: "Ab-wheel rollout", muscles: ["abs"], equipment: "other", met: 3.8 },
  { key: "russian_twist", name: "Russian twist", muscles: ["abs"], equipment: "bodyweight", met: 3.8 },
  { key: "pallof_press", name: "Pallof press", muscles: ["abs"], equipment: "cable", met: 3.5 },
  { key: "mountain_climber", name: "Mountain climber", muscles: ["abs", "shoulders", "full_body"], equipment: "bodyweight", met: 8 },
  { key: "burpee", name: "Burpee", muscles: ["full_body"], equipment: "bodyweight", met: 8 },
  { key: "sled_push", name: "Sled push", muscles: ["quadriceps", "glutes", "full_body"], equipment: "other", met: 8 },
  { key: "battle_ropes", name: "Battle ropes", muscles: ["shoulders", "biceps", "triceps", "full_body"], equipment: "other", met: 8 },
  { key: "machine_chest_press", name: "Machine chest press", muscles: ["chest", "triceps", "shoulders"], equipment: "machine", met: 5 },
  { key: "flat_dumbbell_fly", name: "Dumbbell chest fly", muscles: ["chest"], equipment: "dumbbell", met: 3.5 },
  { key: "pec_deck", name: "Pec deck", muscles: ["chest"], equipment: "machine", met: 3.5 },
  { key: "landmine_press", name: "Landmine press", muscles: ["chest", "shoulders", "triceps"], equipment: "barbell", met: 5 },
  { key: "front_raise", name: "Front raise", muscles: ["shoulders"], equipment: "dumbbell", met: 3.5 },
  { key: "reverse_pec_deck", name: "Reverse pec deck", muscles: ["shoulders", "back"], equipment: "machine", met: 3.5 },
  { key: "barbell_shrug", name: "Barbell shrug", muscles: ["back", "shoulders", "forearms"], equipment: "barbell", met: 3.5 },
  { key: "dumbbell_shrug", name: "Dumbbell shrug", muscles: ["back", "shoulders", "forearms"], equipment: "dumbbell", met: 3.5 },
  { key: "dumbbell_triceps_extension", name: "Dumbbell triceps extension", muscles: ["triceps"], equipment: "dumbbell", met: 3.5, aliases: ["Triceps extension", "Arm extension"], health: { healthConnectSegmentTypes: [12, 18, 19, 20, 49], samsungTypes: ["ARM_EXTENSIONS"] } },
  { key: "cable_overhead_triceps_extension", name: "Cable overhead triceps extension", muscles: ["triceps"], equipment: "cable", met: 3.5, aliases: ["Cable triceps extension"] },
  { key: "rope_triceps_pushdown", name: "Rope triceps pushdown", muscles: ["triceps"], equipment: "cable", met: 3.5, aliases: ["Rope pushdown"] },
  { key: "dumbbell_triceps_kickback", name: "Dumbbell triceps kickback", muscles: ["triceps"], equipment: "dumbbell", met: 3.5 },
  { key: "triceps_dip", name: "Triceps dip", muscles: ["triceps", "chest", "shoulders"], equipment: "bodyweight", met: 5, trackingMode: "reps" },
  { key: "ez_bar_curl", name: "EZ-bar curl", muscles: ["biceps", "forearms"], equipment: "barbell", met: 3.5 },
  { key: "cable_curl", name: "Cable curl", muscles: ["biceps"], equipment: "cable", met: 3.5 },
  { key: "concentration_curl", name: "Concentration curl", muscles: ["biceps"], equipment: "dumbbell", met: 3.5 },
  { key: "spider_curl", name: "Spider curl", muscles: ["biceps"], equipment: "dumbbell", met: 3.5 },
  { key: "chest_supported_row", name: "Chest-supported row", muscles: ["back", "biceps"], equipment: "machine", met: 5 },
  { key: "pendlay_row", name: "Pendlay row", muscles: ["back", "biceps", "forearms"], equipment: "barbell", met: 5 },
  { key: "machine_row", name: "Machine row", muscles: ["back", "biceps"], equipment: "machine", met: 3.5 },
  { key: "chin_up", name: "Chin-up", muscles: ["back", "biceps", "forearms"], equipment: "bodyweight", met: 3.8, trackingMode: "reps", aliases: ["Chin up"] },
  { key: "hip_adduction", name: "Hip adduction", muscles: ["quadriceps"], equipment: "machine", met: 3.5 },
  { key: "lying_leg_curl", name: "Lying leg curl", muscles: ["hamstrings"], equipment: "machine", met: 3.5 },
  { key: "seated_leg_curl", name: "Seated leg curl", muscles: ["hamstrings"], equipment: "machine", met: 3.5 },
  { key: "single_leg_press", name: "Single-leg press", muscles: ["quadriceps", "glutes", "hamstrings"], equipment: "machine", met: 5 },
  { key: "step_up", name: "Step-up", muscles: ["quadriceps", "glutes", "hamstrings"], equipment: "dumbbell", met: 5 },
  { key: "reverse_lunge", name: "Reverse lunge", muscles: ["quadriceps", "glutes", "hamstrings"], equipment: "dumbbell", met: 5 },
  { key: "standing_calf_raise", name: "Standing calf raise", muscles: ["calves"], equipment: "machine", met: 3.5 },
  { key: "donkey_calf_raise", name: "Donkey calf raise", muscles: ["calves"], equipment: "machine", met: 3.5 },
  { key: "sit_up", name: "Sit-up", muscles: ["abs"], equipment: "bodyweight", met: 3.8, trackingMode: "reps", health: { samsungTypes: ["SIT_UPS"] } },
  { key: "bicycle_crunch", name: "Bicycle crunch", muscles: ["abs"], equipment: "bodyweight", met: 3.8, trackingMode: "reps" },
  { key: "reverse_crunch", name: "Reverse crunch", muscles: ["abs"], equipment: "bodyweight", met: 3.8, trackingMode: "reps" },
  { key: "dead_bug", name: "Dead bug", muscles: ["abs"], equipment: "bodyweight", met: 3, trackingMode: "reps" },
  { key: "side_plank", name: "Side plank", muscles: ["abs"], equipment: "bodyweight", met: 2.8, trackingMode: "duration" },
  { key: "power_clean", name: "Power clean", muscles: ["full_body", "back", "glutes", "hamstrings"], equipment: "barbell", met: 6 },
  { key: "clean_and_jerk", name: "Clean and jerk", muscles: ["full_body"], equipment: "barbell", met: 6 },
  { key: "snatch", name: "Snatch", muscles: ["full_body"], equipment: "barbell", met: 6 },
  { key: "custom", name: "Custom exercise", muscles: ["full_body"], equipment: "other", met: 3.5 },
];

function activity(
  key: string,
  name: string,
  category: Exclude<ExerciseCategory, "strength">,
  met: number,
  health: ExerciseHealthAliases,
  options?: { aliases?: string[]; supportsDistance?: boolean },
): ExerciseCatalogItem {
  return {
    key,
    name,
    muscles: ["full_body"],
    equipment: "other",
    category,
    trackingMode: "duration",
    trackingFields: options?.supportsDistance
      ? ["duration", "distance"]
      : ["duration"],
    aliases: options?.aliases ?? [],
    health,
    supportsDistance: options?.supportsDistance,
    met,
  };
}

/**
 * Session-level activities are the union of the official Health Connect,
 * HealthKit and Samsung Health activity families. Samsung records reach this
 * app through Health Connect; enum names are retained only as safe title
 * aliases when Samsung has no distinct Health Connect session type.
 */
/**
 * Canonical session-level workouts. Keep this separate from individual
 * strength movements so activity pickers never turn into an exercise library.
 */
export const SESSION_ACTIVITY_EXERCISES: readonly ExerciseCatalogItem[] = [
  activity("walking", "Walking", "cardio", 3.5, { healthConnectSessionTypes: [79], healthConnectSegmentTypes: [64], appleWorkoutTypes: [52], samsungTypes: ["WALKING"] }, { aliases: ["Walk"], supportsDistance: true }),
  activity("running", "Running", "cardio", 7, { healthConnectSessionTypes: [56], healthConnectSegmentTypes: [46], appleWorkoutTypes: [37], samsungTypes: ["RUNNING"] }, { aliases: ["Run", "Jogging"], supportsDistance: true }),
  activity("track_running", "Track running", "cardio", 7, { appleWorkoutTypes: [49], samsungTypes: ["TRACK_RUNNING"] }, { supportsDistance: true }),
  activity("treadmill_running", "Treadmill running", "cardio", 7, { healthConnectSessionTypes: [57], healthConnectSegmentTypes: [47], samsungTypes: ["TREADMILL"] }, { aliases: ["Treadmill"], supportsDistance: true }),
  activity("cycling", "Cycling", "cardio", 6.8, { healthConnectSessionTypes: [8], healthConnectSegmentTypes: [7], appleWorkoutTypes: [13], samsungTypes: ["BIKING"] }, { aliases: ["Biking", "Bicycle"], supportsDistance: true }),
  activity("stationary_cycling", "Stationary cycling", "cardio", 6, { healthConnectSessionTypes: [9], healthConnectSegmentTypes: [8], samsungTypes: ["STATIONARY_BIKING"] }, { aliases: ["Exercise bike", "Indoor cycling"], supportsDistance: true }),
  activity("mountain_biking", "Mountain biking", "outdoor", 8.5, { healthConnectSessionTypes: [8], appleWorkoutTypes: [13], samsungTypes: ["MOUNTAIN_BIKING"] }, { supportsDistance: true }),
  activity("hand_cycling", "Hand cycling", "cardio", 6, { appleWorkoutTypes: [74] }, { supportsDistance: true }),
  activity("elliptical", "Elliptical", "cardio", 5, { healthConnectSessionTypes: [25], healthConnectSegmentTypes: [21], appleWorkoutTypes: [16], samsungTypes: ["ELLIPTICAL"] }, { aliases: ["Cross trainer"], supportsDistance: true }),
  activity("stair_climbing", "Stair climbing", "cardio", 6, { healthConnectSessionTypes: [68], healthConnectSegmentTypes: [52], appleWorkoutTypes: [44, 68], samsungTypes: ["STAIR_CLIMBING"] }),
  activity("stair_machine", "Stair climbing machine", "cardio", 6, { healthConnectSessionTypes: [69], healthConnectSegmentTypes: [53], appleWorkoutTypes: [69], samsungTypes: ["STAIR_CLIMBING_MACHINE", "STEP_MACHINE"] }, { aliases: ["Stair machine", "Step machine"] }),
  activity("rowing_machine", "Rowing machine", "cardio", 7, { healthConnectSessionTypes: [54], healthConnectSegmentTypes: [45], samsungTypes: ["ROWING_MACHINE"] }, { supportsDistance: true }),
  activity("wheelchair_walk", "Wheelchair walk pace", "cardio", 3.5, { healthConnectSessionTypes: [82], healthConnectSegmentTypes: [66], appleWorkoutTypes: [70] }, { supportsDistance: true }),
  activity("wheelchair_run", "Wheelchair run pace", "cardio", 6, { healthConnectSessionTypes: [82], healthConnectSegmentTypes: [66], appleWorkoutTypes: [71] }, { supportsDistance: true }),

  activity("strength_training", "Strength training", "conditioning", 5, { healthConnectSessionTypes: [70], appleWorkoutTypes: [50] }, { aliases: ["Traditional strength training", "Weights"] }),
  activity("functional_strength_training", "Functional strength training", "conditioning", 5, { appleWorkoutTypes: [20] }),
  activity("weightlifting", "Weightlifting", "conditioning", 6, { healthConnectSessionTypes: [81], healthConnectSegmentTypes: [65], samsungTypes: ["WEIGHT_MACHINE"] }),
  activity("weight_machine", "Weight machine", "conditioning", 5, { healthConnectSessionTypes: [70], samsungTypes: ["WEIGHT_MACHINE"] }),
  activity("aerobics", "Aerobics", "conditioning", 6.5, { appleWorkoutTypes: [73], samsungTypes: ["AEROBICS"] }),
  activity("boot_camp", "Boot camp", "conditioning", 7, { healthConnectSessionTypes: [10] }),
  activity("calisthenics", "Calisthenics", "conditioning", 5, { healthConnectSessionTypes: [13] }),
  activity("circuit_training", "Circuit training", "conditioning", 6, { appleWorkoutTypes: [11], samsungTypes: ["CIRCUIT_TRAINING"] }),
  activity("cross_training", "Cross training", "conditioning", 6, { appleWorkoutTypes: [11] }),
  activity("mixed_cardio", "Mixed cardio", "conditioning", 6, { appleWorkoutTypes: [30, 73] }),
  activity("hiit", "High-intensity interval training", "conditioning", 8, { healthConnectSessionTypes: [36], healthConnectSegmentTypes: [24], appleWorkoutTypes: [63] }, { aliases: ["HIIT"] }),
  activity("exercise_class", "Exercise class", "conditioning", 5, { healthConnectSessionTypes: [26] }),
  activity("fitness_gaming", "Fitness gaming", "conditioning", 4, { appleWorkoutTypes: [76] }),
  activity("gymnastics", "Gymnastics", "conditioning", 4, { healthConnectSessionTypes: [34], appleWorkoutTypes: [22] }),
  activity("jump_rope", "Jump rope", "conditioning", 8, { healthConnectSegmentTypes: [28], appleWorkoutTypes: [64], samsungTypes: ["JUMP_ROPE"] }, { aliases: ["Skipping rope"] }),
  activity("hula_hooping", "Hula hooping", "conditioning", 5, { healthConnectSegmentTypes: [26], samsungTypes: ["HULA_HOOPING"] }),
  activity("jumping_jacks", "Jumping jacks", "conditioning", 8, { healthConnectSegmentTypes: [27], samsungTypes: ["JUMPING_JACKS"] }),
  activity("skaters", "Skaters", "conditioning", 7, { samsungTypes: ["SKATERS"] }),
  activity("high_knees", "High knees", "conditioning", 8, { samsungTypes: ["HIGH_KNEES"] }),

  activity("stretching", "Stretching", "mobility", 2.5, { healthConnectSessionTypes: [71], healthConnectSegmentTypes: [54], appleWorkoutTypes: [62], samsungTypes: ["STRETCHING"] }, { aliases: ["Flexibility"] }),
  activity("warm_up", "Warm-up", "mobility", 3, { appleWorkoutTypes: [33], samsungTypes: ["WARM_UP"] }),
  activity("cool_down", "Cool-down", "mobility", 2.5, { appleWorkoutTypes: [80], samsungTypes: ["COOL_DOWN"] }),
  activity("recovery", "Preparation and recovery", "mobility", 2.5, { appleWorkoutTypes: [33] }),
  activity("yoga", "Yoga", "mind_body", 2.5, { healthConnectSessionTypes: [83], healthConnectSegmentTypes: [67], appleWorkoutTypes: [57], samsungTypes: ["YOGA"] }),
  activity("pilates", "Pilates", "mind_body", 3, { healthConnectSessionTypes: [48], healthConnectSegmentTypes: [40], appleWorkoutTypes: [66], samsungTypes: ["PILATES"] }),
  activity("tai_chi", "Tai chi", "mind_body", 3, { appleWorkoutTypes: [72], samsungTypes: ["MARTIAL_ARTS"] }),
  activity("barre", "Barre", "mind_body", 3.5, { appleWorkoutTypes: [58] }),
  activity("core_training", "Core training", "mind_body", 4, { appleWorkoutTypes: [59] }),
  activity("guided_breathing", "Guided breathing", "mind_body", 2, { healthConnectSessionTypes: [33], appleWorkoutTypes: [29] }, { aliases: ["Mind and body", "Breathing"] }),
  activity("dance", "Dance", "mind_body", 5, { healthConnectSessionTypes: [16], appleWorkoutTypes: [14, 15], samsungTypes: ["DANCING"] }),
  activity("ballet", "Ballet", "mind_body", 5, { samsungTypes: ["BALLET"] }),
  activity("ballroom_dance", "Ballroom dance", "mind_body", 5, { appleWorkoutTypes: [78], samsungTypes: ["BALLROOM_DANCING"] }),
  activity("cardio_dance", "Cardio dance", "mind_body", 6, { appleWorkoutTypes: [77] }),
  activity("social_dance", "Social dance", "mind_body", 4.5, { appleWorkoutTypes: [78] }),
  activity("zumba", "Zumba", "mind_body", 6.5, { appleWorkoutTypes: [77], samsungTypes: ["ZUMBA"] }),

  activity("baseball", "Baseball", "team_sport", 5, { healthConnectSessionTypes: [4], appleWorkoutTypes: [5], samsungTypes: ["BASEBALL"] }),
  activity("softball", "Softball", "team_sport", 5, { healthConnectSessionTypes: [65], appleWorkoutTypes: [42], samsungTypes: ["SOFTBALL"] }),
  activity("cricket", "Cricket", "team_sport", 5, { healthConnectSessionTypes: [14], appleWorkoutTypes: [10], samsungTypes: ["CRICKET"] }),
  activity("basketball", "Basketball", "team_sport", 6.5, { healthConnectSessionTypes: [5], appleWorkoutTypes: [6], samsungTypes: ["BASKETBALL"] }),
  activity("soccer", "Soccer", "team_sport", 7, { healthConnectSessionTypes: [64], appleWorkoutTypes: [41], samsungTypes: ["SOCCER"] }, { aliases: ["Football"] }),
  activity("american_football", "American football", "team_sport", 6, { healthConnectSessionTypes: [28], appleWorkoutTypes: [1], samsungTypes: ["AMERICAN_FOOTBALL"] }),
  activity("australian_football", "Australian football", "team_sport", 7, { healthConnectSessionTypes: [29], appleWorkoutTypes: [3] }),
  activity("rugby", "Rugby", "team_sport", 7, { healthConnectSessionTypes: [55], appleWorkoutTypes: [36], samsungTypes: ["RUGBY"] }),
  activity("handball", "Handball", "team_sport", 7, { healthConnectSessionTypes: [35], appleWorkoutTypes: [23], samsungTypes: ["HANDBALL"] }),
  activity("volleyball", "Volleyball", "team_sport", 4, { healthConnectSessionTypes: [78], appleWorkoutTypes: [51], samsungTypes: ["VOLLEYBALL"] }),
  activity("beach_volleyball", "Beach volleyball", "team_sport", 6, { healthConnectSessionTypes: [78], appleWorkoutTypes: [51], samsungTypes: ["BEACH_VOLLEYBALL"] }),
  activity("hockey", "Hockey", "team_sport", 7, { appleWorkoutTypes: [25], samsungTypes: ["HOCKEY"] }),
  activity("ice_hockey", "Ice hockey", "team_sport", 8, { healthConnectSessionTypes: [38], appleWorkoutTypes: [25], samsungTypes: ["ICE_HOCKEY"] }),
  activity("roller_hockey", "Roller hockey", "team_sport", 7, { healthConnectSessionTypes: [52] }),
  activity("lacrosse", "Lacrosse", "team_sport", 7, { appleWorkoutTypes: [27] }),
  activity("disc_sports", "Disc sports", "team_sport", 5, { healthConnectSessionTypes: [31], appleWorkoutTypes: [75], samsungTypes: ["FLYING_DISC"] }, { aliases: ["Frisbee"] }),

  activity("badminton", "Badminton", "racket_sport", 5.5, { healthConnectSessionTypes: [2], appleWorkoutTypes: [4], samsungTypes: ["BADMINTON"] }),
  activity("tennis", "Tennis", "racket_sport", 7, { healthConnectSessionTypes: [76], appleWorkoutTypes: [48], samsungTypes: ["TENNIS"] }),
  activity("table_tennis", "Table tennis", "racket_sport", 4, { healthConnectSessionTypes: [75], appleWorkoutTypes: [47], samsungTypes: ["TABLE_TENNIS"] }),
  activity("squash", "Squash", "racket_sport", 8, { healthConnectSessionTypes: [66], appleWorkoutTypes: [43], samsungTypes: ["SQUASH"] }),
  activity("racquetball", "Racquetball", "racket_sport", 7, { healthConnectSessionTypes: [50], appleWorkoutTypes: [34], samsungTypes: ["RACQUETBALL"] }),
  activity("pickleball", "Pickleball", "racket_sport", 5, { appleWorkoutTypes: [79] }),

  activity("boxing", "Boxing", "combat", 8, { healthConnectSessionTypes: [11], appleWorkoutTypes: [8], samsungTypes: ["BOXING"] }),
  activity("kickboxing", "Kickboxing", "combat", 8, { appleWorkoutTypes: [65] }),
  activity("martial_arts", "Martial arts", "combat", 7, { healthConnectSessionTypes: [44], appleWorkoutTypes: [28], samsungTypes: ["MARTIAL_ARTS"] }, { aliases: ["Karate", "Judo", "Jiu-jitsu", "Taekwondo"] }),
  activity("wrestling", "Wrestling", "combat", 7, { appleWorkoutTypes: [56] }),
  activity("fencing", "Fencing", "combat", 6, { healthConnectSessionTypes: [27], appleWorkoutTypes: [18] }),

  activity("hiking", "Hiking", "outdoor", 6, { healthConnectSessionTypes: [37], appleWorkoutTypes: [24], samsungTypes: ["HIKING"] }, { supportsDistance: true }),
  activity("backpacking", "Backpacking", "outdoor", 7, { appleWorkoutTypes: [24], samsungTypes: ["BACKPACKING"] }, { supportsDistance: true }),
  activity("orienteering", "Orienteering", "outdoor", 8, { samsungTypes: ["ORIENTEERING"] }, { supportsDistance: true }),
  activity("rock_climbing", "Rock climbing", "outdoor", 7, { healthConnectSessionTypes: [51], appleWorkoutTypes: [9], samsungTypes: ["ROCK_CLIMBING"] }),
  activity("paragliding", "Paragliding", "outdoor", 3, { healthConnectSessionTypes: [47] }),
  activity("hang_gliding", "Hang gliding", "outdoor", 3, { healthConnectSessionTypes: [47], samsungTypes: ["HANG_GLIDING"] }),
  activity("horseback_riding", "Horseback riding", "outdoor", 4, { appleWorkoutTypes: [17], samsungTypes: ["HORSEBACK_RIDING"] }, { aliases: ["Equestrian sports"] }),
  activity("fishing", "Fishing", "outdoor", 3, { appleWorkoutTypes: [19] }),
  activity("hunting", "Hunting", "outdoor", 5, { appleWorkoutTypes: [26] }),
  activity("golf", "Golf", "outdoor", 4.8, { healthConnectSessionTypes: [32], appleWorkoutTypes: [21], samsungTypes: ["GOLF"] }, { supportsDistance: true }),
  activity("archery", "Archery", "outdoor", 3.5, { appleWorkoutTypes: [2], samsungTypes: ["ARCHERY"] }),
  activity("bowling", "Bowling", "outdoor", 3, { appleWorkoutTypes: [7], samsungTypes: ["BOWLING"] }),
  activity("inline_skating", "Inline skating", "outdoor", 7, { healthConnectSessionTypes: [60], appleWorkoutTypes: [39], samsungTypes: ["INLINE_SKATING"] }, { supportsDistance: true }),
  activity("roller_skating", "Roller skating", "outdoor", 7, { healthConnectSessionTypes: [60], appleWorkoutTypes: [39], samsungTypes: ["ROLLER_SKATING"] }, { supportsDistance: true }),
  activity("play", "Play", "outdoor", 4, { appleWorkoutTypes: [32] }),

  activity("swimming", "Swimming", "water", 6, { appleWorkoutTypes: [46] }, { supportsDistance: true }),
  activity("pool_swimming", "Pool swimming", "water", 6, { healthConnectSessionTypes: [74], healthConnectSegmentTypes: [55, 56, 57, 58, 59, 61, 62], samsungTypes: ["POOL_SWIMMING"] }, { aliases: ["Lap swimming"], supportsDistance: true }),
  activity("open_water_swimming", "Open-water swimming", "water", 7, { healthConnectSessionTypes: [73], healthConnectSegmentTypes: [60], samsungTypes: ["OPEN_WATER_SWIMMING"] }, { supportsDistance: true }),
  activity("water_fitness", "Water fitness", "water", 5, { appleWorkoutTypes: [53], samsungTypes: ["AQUA_AEROBICS"] }, { aliases: ["Aqua aerobics"] }),
  activity("water_polo", "Water polo", "water", 8, { healthConnectSessionTypes: [80], appleWorkoutTypes: [54] }),
  activity("paddling", "Paddling", "water", 5, { healthConnectSessionTypes: [46], appleWorkoutTypes: [31] }, { supportsDistance: true }),
  activity("canoeing", "Canoeing", "water", 5, { healthConnectSessionTypes: [46], appleWorkoutTypes: [31], samsungTypes: ["CANOEING"] }, { supportsDistance: true }),
  activity("kayaking", "Kayaking", "water", 5, { healthConnectSessionTypes: [46], appleWorkoutTypes: [31], samsungTypes: ["KAYAKING"] }, { supportsDistance: true }),
  activity("rafting", "Rafting", "water", 5, { healthConnectSessionTypes: [46], appleWorkoutTypes: [31], samsungTypes: ["RAFTING"] }, { supportsDistance: true }),
  activity("rowing", "Rowing", "water", 7, { healthConnectSessionTypes: [53], appleWorkoutTypes: [35], samsungTypes: ["ROWING"] }, { supportsDistance: true }),
  activity("sailing", "Sailing", "water", 3, { healthConnectSessionTypes: [58], appleWorkoutTypes: [38], samsungTypes: ["SAILING"] }, { supportsDistance: true }),
  activity("yachting", "Yachting", "water", 3, { healthConnectSessionTypes: [58], appleWorkoutTypes: [38], samsungTypes: ["YACHTING"] }, { supportsDistance: true }),
  activity("surfing", "Surfing", "water", 5, { healthConnectSessionTypes: [72], appleWorkoutTypes: [45], samsungTypes: ["SURFING"] }, { supportsDistance: true }),
  activity("windsurfing", "Windsurfing", "water", 5, { healthConnectSessionTypes: [72], appleWorkoutTypes: [45], samsungTypes: ["WINDSURFING"] }, { supportsDistance: true }),
  activity("kitesurfing", "Kitesurfing", "water", 7, { healthConnectSessionTypes: [72], appleWorkoutTypes: [45], samsungTypes: ["KITESURFING"] }, { supportsDistance: true }),
  activity("water_skiing", "Water skiing", "water", 6, { appleWorkoutTypes: [55], samsungTypes: ["WATER_SKIING"] }, { supportsDistance: true }),
  activity("scuba_diving", "Scuba diving", "water", 7, { healthConnectSessionTypes: [59], appleWorkoutTypes: [84], samsungTypes: ["SCUBA_DIVING"] }),
  activity("snorkeling", "Snorkeling", "water", 5, { appleWorkoutTypes: [55], samsungTypes: ["SNORKELING"] }),

  activity("skiing", "Skiing", "winter", 7, { healthConnectSessionTypes: [61], appleWorkoutTypes: [40], samsungTypes: ["SKIING"] }, { supportsDistance: true }),
  activity("cross_country_skiing", "Cross-country skiing", "winter", 8, { healthConnectSessionTypes: [61], appleWorkoutTypes: [60], samsungTypes: ["CROSS_COUNTRY_SKIING"] }, { supportsDistance: true }),
  activity("downhill_skiing", "Downhill skiing", "winter", 6, { healthConnectSessionTypes: [61], appleWorkoutTypes: [61], samsungTypes: ["ALPINE_SKIING"] }, { supportsDistance: true }),
  activity("snowboarding", "Snowboarding", "winter", 6, { healthConnectSessionTypes: [62], appleWorkoutTypes: [67], samsungTypes: ["SNOWBOARDING"] }, { supportsDistance: true }),
  activity("snowshoeing", "Snowshoeing", "winter", 7, { healthConnectSessionTypes: [63], samsungTypes: ["SNOWSHOEING"] }, { supportsDistance: true }),
  activity("ice_skating", "Ice skating", "winter", 7, { healthConnectSessionTypes: [39], appleWorkoutTypes: [39], samsungTypes: ["ICE_SKATING"] }, { supportsDistance: true }),
  activity("ice_dancing", "Ice dancing", "winter", 6, { healthConnectSessionTypes: [39], appleWorkoutTypes: [39], samsungTypes: ["ICE_DANCING"] }),
  activity("curling", "Curling", "winter", 4, { appleWorkoutTypes: [12] }),

  activity("triathlon", "Triathlon", "multisport", 8, { appleWorkoutTypes: [82], samsungTypes: ["TRIATHLON"] }, { supportsDistance: true }),
  activity("duathlon", "Duathlon", "multisport", 8, { appleWorkoutTypes: [82], samsungTypes: ["DUATHLON"] }, { supportsDistance: true }),
  activity("aquathlon", "Aquathlon", "multisport", 8, { appleWorkoutTypes: [82], samsungTypes: ["AQUATHLON"] }, { supportsDistance: true }),
  activity("aquabike", "Aquabike", "multisport", 8, { appleWorkoutTypes: [82], samsungTypes: ["AQUABIKE"] }, { supportsDistance: true }),
  activity("cross_triathlon", "Cross triathlon", "multisport", 8, { samsungTypes: ["CROSS_TRIATHLON"] }, { supportsDistance: true }),
  activity("cross_duathlon", "Cross duathlon", "multisport", 8, { samsungTypes: ["CROSS_DUATHLON"] }, { supportsDistance: true }),
  activity("multisport_transition", "Multisport transition", "multisport", 2, { appleWorkoutTypes: [83], samsungTypes: ["TRANSITION"] }),
  activity("workout_break", "Workout break", "other", 1.5, { samsungTypes: ["BREAK"] }),
  activity("other_workout", "Other workout", "other", 3.5, { healthConnectSessionTypes: [0], appleWorkoutTypes: [3000], samsungTypes: ["OTHER"] }),
];

const STRENGTH_OVERRIDES: Record<
  string,
  Partial<Pick<ExerciseCatalogItem, "category" | "trackingMode" | "aliases" | "health">>
> = {
  back_extension: { health: { healthConnectSegmentTypes: [2], samsungTypes: ["BACK_EXTENSIONS"] } },
  barbell_bench_press: { aliases: ["Bench press"], health: { healthConnectSegmentTypes: [5], samsungTypes: ["BENCH_PRESS"] } },
  overhead_press: { health: { healthConnectSegmentTypes: [4, 48], samsungTypes: ["SHOULDER_PRESSES"] } },
  dumbbell_curl: { health: { healthConnectSegmentTypes: [13, 14], samsungTypes: ["ARM_CURLS"] } },
  front_raise: { health: { healthConnectSegmentTypes: [15, 23], samsungTypes: ["FRONT_RAISES"] } },
  lateral_raise: { health: { healthConnectSegmentTypes: [16, 30], samsungTypes: ["LATERAL_RAISES"] } },
  deadlift: { health: { healthConnectSegmentTypes: [11], samsungTypes: ["DEADLIFTS"] } },
  lat_pulldown: { health: { healthConnectSegmentTypes: [31], samsungTypes: ["LAT_PULLDOWNS"] } },
  leg_curl: { health: { healthConnectSegmentTypes: [32], samsungTypes: ["LEG_CURLS"] } },
  leg_extension: { health: { healthConnectSegmentTypes: [33], samsungTypes: ["LEG_EXTENSIONS"] } },
  leg_press: { health: { healthConnectSegmentTypes: [34], samsungTypes: ["LEG_PRESSES"] } },
  walking_lunge: { health: { healthConnectSegmentTypes: [36], samsungTypes: ["LUNGES"] } },
  hip_thrust: { health: { healthConnectSegmentTypes: [25] } },
  back_squat: { aliases: ["Squat"], health: { healthConnectSegmentTypes: [51], samsungTypes: ["SQUATS"] } },
  push_up: { trackingMode: "reps", health: { samsungTypes: ["PUSH_UPS"] } },
  pull_up: { trackingMode: "reps", health: { healthConnectSegmentTypes: [42], samsungTypes: ["PULL_UPS"] } },
  hanging_leg_raise: { trackingMode: "reps", health: { healthConnectSegmentTypes: [35], samsungTypes: ["LEG_RAISES"] } },
  mountain_climber: { category: "conditioning", trackingMode: "reps", health: { healthConnectSegmentTypes: [37], samsungTypes: ["MOUNTAIN_CLIMBERS"] } },
  burpee: { category: "conditioning", trackingMode: "reps", health: { healthConnectSegmentTypes: [9], samsungTypes: ["BURPEES"] } },
  plank: { category: "mind_body", trackingMode: "duration", health: { healthConnectSegmentTypes: [41], samsungTypes: ["PLANK"] } },
  farmer_carry: { category: "conditioning", trackingMode: "duration" },
  battle_ropes: { category: "conditioning", trackingMode: "duration" },
  sled_push: { category: "conditioning", trackingMode: "duration" },
  custom: { aliases: ["Other exercise"] },
};

const normalizedStrengthExercises = STRENGTH_EXERCISES.map(
  (seed): ExerciseCatalogItem => {
    const override = STRENGTH_OVERRIDES[seed.key] ?? {};
    const bodyweightReps = seed.equipment === "bodyweight";
    return {
      ...seed,
      category: override.category ?? seed.category ?? "strength",
      trackingMode:
        override.trackingMode ??
        seed.trackingMode ??
        (bodyweightReps ? "reps" : "load_reps"),
      aliases: [...(seed.aliases ?? []), ...(override.aliases ?? [])],
      health: override.health ?? seed.health,
    };
  },
);

export const EXERCISE_CATALOG: ExerciseCatalogItem[] = [
  ...normalizedStrengthExercises.filter((item) => item.key !== "custom"),
  ...SESSION_ACTIVITY_EXERCISES,
  normalizedStrengthExercises.find((item) => item.key === "custom")!,
];

const catalogByKey = new Map(EXERCISE_CATALOG.map((item) => [item.key, item]));

function normalizedActivityName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const catalogByActivityName = new Map<string, ExerciseCatalogItem>();
for (const item of EXERCISE_CATALOG) {
  const names = [
    item.name,
    item.key,
    ...item.aliases,
    ...(item.health?.samsungTypes ?? []),
  ];
  for (const name of names) {
    const normalized = normalizedActivityName(name);
    if (normalized && !catalogByActivityName.has(normalized))
      catalogByActivityName.set(normalized, item);
  }
}

const catalogByHealthConnectSession = new Map<number, ExerciseCatalogItem>();
const catalogByHealthConnectSegment = new Map<number, ExerciseCatalogItem>();
const catalogByAppleWorkout = new Map<number, ExerciseCatalogItem>();
for (const item of EXERCISE_CATALOG) {
  for (const type of item.health?.healthConnectSessionTypes ?? [])
    if (!catalogByHealthConnectSession.has(type))
      catalogByHealthConnectSession.set(type, item);
  for (const type of item.health?.healthConnectSegmentTypes ?? [])
    if (!catalogByHealthConnectSegment.has(type))
      catalogByHealthConnectSegment.set(type, item);
  for (const type of item.health?.appleWorkoutTypes ?? [])
    if (!catalogByAppleWorkout.has(type)) catalogByAppleWorkout.set(type, item);
}

export function healthConnectSessionExercise(type: number) {
  return catalogByHealthConnectSession.get(type);
}

export function healthConnectSegmentExercise(type: number) {
  return catalogByHealthConnectSegment.get(type);
}

export function appleWorkoutExercise(type: number) {
  return catalogByAppleWorkout.get(type);
}

export function exerciseFromActivityName(name?: string) {
  return name ? catalogByActivityName.get(normalizedActivityName(name)) : undefined;
}

export function catalogExercise(key?: string) {
  return key ? catalogByKey.get(key) : undefined;
}

export function catalogExerciseTrackingFields(
  exercise: Pick<
    ExerciseCatalogItem,
    "trackingMode" | "trackingFields" | "supportsDistance"
  >,
): WorkoutExerciseTrackingField[] {
  if (exercise.trackingFields?.length)
    return [...new Set(exercise.trackingFields)];
  if (exercise.trackingMode === "duration")
    return exercise.supportsDistance
      ? ["duration", "distance"]
      : ["duration"];
  if (exercise.trackingMode === "reps") return ["reps"];
  return ["weight", "reps"];
}

export function exerciseKey(name: string, supplied?: string) {
  if (supplied) return supplied;
  const normalized = name.trim().toLowerCase();
  return (
    exerciseFromActivityName(normalized)?.key ??
    `custom:${normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`
  );
}
