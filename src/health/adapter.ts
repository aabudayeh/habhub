import { HealthAdapter } from '@/src/health/types';

export const nativeHealthAdapter: HealthAdapter = {
  provider: null,
  availability: async () => ({
    available: false,
    provider: null,
    title: 'Connected health data',
    detail:
      'Connect Apple Health or Health Connect in the installed HabHub phone app. When both devices use the same signed-in account, those imported entries appear on web with their original source identity instead of being added twice.',
  }),
  requestPermissions: async () => { throw new Error('Health sync requires an installed iOS or Android build.'); },
  read: async () => [],
  openSettings: async () => { throw new Error('Health settings are available in the installed mobile app.'); },
};
