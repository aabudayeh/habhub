declare module '@kingstinct/react-native-healthkit' {
  export function isHealthDataAvailableAsync(): Promise<boolean>;
  export function requestAuthorization(request: { toRead: string[]; toShare?: string[] }): Promise<boolean>;
  export function queryStatisticsCollectionForQuantity(
    identifier: string,
    statistics: string[],
    anchorDate: Date,
    interval: { day?: number; hour?: number },
    options: { unit?: string; filter?: { date?: { startDate?: Date; endDate?: Date; strictStartDate?: boolean; strictEndDate?: boolean } } },
  ): Promise<Record<string, unknown>[]>;
  export function queryQuantitySamples(
    identifier: string,
    options: { unit?: string; limit: number; ascending?: boolean; filter?: { date?: { startDate?: Date; endDate?: Date } } },
  ): Promise<Record<string, unknown>[]>;
  export function queryWorkoutSamples(options: {
    limit: number;
    ascending?: boolean;
    filter?: { date?: { startDate?: Date; endDate?: Date } };
  }): Promise<Record<string, unknown>[]>;
}

declare module 'react-native-health-connect' {
  export type Permission = { accessType: 'read' | 'write'; recordType: string };
  export function initialize(providerPackageName?: string): Promise<boolean>;
  export function requestPermission(permissions: Permission[]): Promise<Permission[]>;
  export function readRecords(recordType: string, options: Record<string, unknown>): Promise<{ records: Record<string, unknown>[]; pageToken?: string }>;
  export function openHealthConnectSettings(): Promise<void>;
}

declare module 'expo-background-task' {
  export enum BackgroundTaskResult { Success = 1, Failed = 2 }
  export function registerTaskAsync(name: string, options?: { minimumInterval?: number }): Promise<void>;
  export function unregisterTaskAsync(name: string): Promise<void>;
  export function getStatusAsync(): Promise<number>;
}

declare module 'expo-task-manager' {
  export function defineTask(name: string, executor: () => Promise<unknown>): void;
  export function isTaskRegisteredAsync(name: string): Promise<boolean>;
}
