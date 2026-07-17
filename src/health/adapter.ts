import { HealthAdapter } from '@/src/health/types';

export const nativeHealthAdapter: HealthAdapter = {
  provider: null,
  availability: async () => ({
    available: false,
    provider: null,
    title: 'Mobile health sync',
    detail: 'Health data is available in the installed iOS and Android apps, not in the web preview.',
  }),
  requestPermissions: async () => { throw new Error('Health sync requires an installed iOS or Android build.'); },
  read: async () => [],
  openSettings: async () => { throw new Error('Health settings are available in the installed mobile app.'); },
};

