import AsyncStorage from '@react-native-async-storage/async-storage';

const PENDING_INVITE_KEY = 'metric-rally-pending-invite-v1';
export function groupInviteLink(code: string) {
  const normalized = code.trim().toUpperCase();
  const cloudBase = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const publicBase = process.env.EXPO_PUBLIC_APP_URL?.trim();
  if (publicBase)
    return `${publicBase.replace(/\/$/, '')}/join?code=${encodeURIComponent(normalized)}`;
  if (cloudBase)
    return `${cloudBase.replace(/\/$/, '')}/functions/v1/group-invite?code=${encodeURIComponent(normalized)}`;
  return `paceboard://join?code=${encodeURIComponent(normalized)}`;
}

export function groupInviteMessage(groupName: string, code: string) {
  return `Join ${groupName} on MetricRally\n${groupInviteLink(code)}\n\nInvite code: ${code}`;
}

export async function rememberPendingInvite(code?: string | null) {
  const normalized = code?.trim().toUpperCase();
  if (normalized) await AsyncStorage.setItem(PENDING_INVITE_KEY, normalized);
}

export function pendingInvite() {
  return AsyncStorage.getItem(PENDING_INVITE_KEY);
}

export function clearPendingInvite() {
  return AsyncStorage.removeItem(PENDING_INVITE_KEY);
}
