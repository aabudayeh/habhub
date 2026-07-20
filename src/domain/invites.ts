import * as Linking from 'expo-linking';

export function groupInviteLink(code: string) {
  return Linking.createURL('/join', { queryParams: { code: code.trim().toUpperCase() } });
}

export function groupInviteMessage(groupName: string, code: string) {
  return `Join ${groupName} on North\n${groupInviteLink(code)}\n\nInvite code: ${code}`;
}
