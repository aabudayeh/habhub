declare module '@kingstinct/react-native-healthkit' {
  export type HealthKitSource = {
    readonly name: string;
    readonly bundleIdentifier: string;
    toJSON(key?: string): { name: string; bundleIdentifier: string };
    equals(other: unknown): boolean;
    dispose(): void;
  };
  export function isHealthDataAvailableAsync(): Promise<boolean>;
  export function requestAuthorization(request: { toRead: string[]; toShare?: string[] }): Promise<boolean>;
  export function queryStatisticsCollectionForQuantity(
    identifier: string,
    statistics: string[],
    anchorDate: Date,
    interval: { day?: number; hour?: number },
    options: { unit?: string; filter?: { date?: { startDate?: Date; endDate?: Date; strictStartDate?: boolean; strictEndDate?: boolean }; sources?: HealthKitSource[] } },
  ): Promise<Record<string, unknown>[]>;
  export function queryQuantitySamples(
    identifier: string,
    options: { unit?: string; limit: number; ascending?: boolean; filter?: { date?: { startDate?: Date; endDate?: Date }; sources?: HealthKitSource[] } },
  ): Promise<Record<string, unknown>[]>;
  export function querySources(identifier: string, filter?: { date?: { startDate?: Date; endDate?: Date } }): Promise<HealthKitSource[]>;
  export function queryWorkoutSamples(options: {
    limit: number;
    ascending?: boolean;
    filter?: { date?: { startDate?: Date; endDate?: Date }; sources?: HealthKitSource[] };
  }): Promise<Record<string, unknown>[]>;
}

declare module 'react-native-health-connect' {
  export type Permission = { accessType: 'read' | 'write'; recordType: string };
  export function initialize(providerPackageName?: string): Promise<boolean>;
  export function requestPermission(permissions: Permission[]): Promise<Permission[]>;
  export function getGrantedPermissions(): Promise<Permission[]>;
  export function readRecords(recordType: string, options: Record<string, unknown>): Promise<{ records: Record<string, unknown>[]; pageToken?: string }>;
  export function aggregateGroupByPeriod(request: {
    recordType: 'Steps';
    timeRangeFilter: Record<string, unknown>;
    timeRangeSlicer: { period: 'DAYS'; length: number };
    dataOriginFilter?: string[];
  }): Promise<{
    result: { COUNT_TOTAL?: number; dataOrigins?: string[] };
    startTime: string;
    endTime: string;
  }[]>;
  export function openHealthConnectSettings(): Promise<void>;
}

declare module 'expo-background-task' {
  export type BackgroundTaskOptions = { minimumInterval?: number };
  export enum BackgroundTaskResult { Success = 1, Failed = 2 }
  export function registerTaskAsync(name: string, options?: BackgroundTaskOptions): Promise<void>;
  export function unregisterTaskAsync(name: string): Promise<void>;
  export function getStatusAsync(): Promise<number>;
}

declare module 'expo-task-manager' {
  export function defineTask(
    name: string,
    executor: (body: { data?: unknown; error?: unknown; executionInfo?: unknown }) => Promise<unknown> | unknown,
  ): void;
  export function isTaskDefined(name: string): boolean;
  export function isTaskRegisteredAsync(name: string): Promise<boolean>;
  export function getTaskOptionsAsync<T>(name: string): Promise<T>;
}
