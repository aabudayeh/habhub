import { nativeHealthAdapter } from '@/src/health/adapter';

/** Non-iOS fallback. Metro substitutes appleHealth.ios.ts in iOS builds. */
export const appleHealthAdapter = nativeHealthAdapter;

