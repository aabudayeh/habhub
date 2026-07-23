import { MuscleGroup } from "@/src/types";

export type ExerciseCatalogItem = {
  key: string;
  name: string;
  muscles: MuscleGroup[];
  equipment: "barbell" | "dumbbell" | "machine" | "cable" | "bodyweight" | "other";
  /** Session estimates use the overall intensity MET; this helps custom mixes. */
  met: number;
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

export const EXERCISE_CATALOG: ExerciseCatalogItem[] = [
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
  { key: "cable_crunch", name: "Cable crunch", muscles: ["abs"], equipment: "cable", met: 3.5 },
  { key: "hanging_leg_raise", name: "Hanging leg raise", muscles: ["abs", "forearms"], equipment: "bodyweight", met: 3.8 },
  { key: "farmer_carry", name: "Farmer carry", muscles: ["forearms", "shoulders", "abs", "full_body"], equipment: "dumbbell", met: 6 },
  { key: "kettlebell_swing", name: "Kettlebell swing", muscles: ["glutes", "hamstrings", "back", "full_body"], equipment: "other", met: 9.8 },
  { key: "custom", name: "Custom exercise", muscles: ["full_body"], equipment: "other", met: 3.5 },
];

export function catalogExercise(key?: string) {
  return EXERCISE_CATALOG.find((item) => item.key === key);
}

export function exerciseKey(name: string, supplied?: string) {
  if (supplied) return supplied;
  const normalized = name.trim().toLowerCase();
  return (
    EXERCISE_CATALOG.find((item) => item.name.toLowerCase() === normalized)?.key ??
    `custom:${normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`
  );
}
