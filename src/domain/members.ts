import { AppState, Member } from '@/src/types';

export function memberDisplayName(state: AppState, member: Member): string {
  return state.settings.memberNicknamesByGroup?.[state.group.id]?.[member.id]?.trim()
    || state.settings.memberNicknames?.[member.id]?.trim()
    || member.name;
}

export function memberOriginalLabel(state: AppState, member: Member): string | undefined {
  const nickname = state.settings.memberNicknamesByGroup?.[state.group.id]?.[member.id]?.trim()
    || state.settings.memberNicknames?.[member.id]?.trim();
  return nickname ? `Profile name: ${member.name}` : undefined;
}

export function memberRoleLabel(member: Member): string {
  if (member.role === 'owner') return 'Owner · admin';
  if (member.role === 'admin') return 'Group admin';
  return 'Group member';
}
