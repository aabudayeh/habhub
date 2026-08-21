import { nativeHealthAdapter } from '@/src/health/adapter';

/** Non-Android fallback. Metro substitutes healthConnect.android.ts in Android builds. */
export const healthConnectAdapter = nativeHealthAdapter;

