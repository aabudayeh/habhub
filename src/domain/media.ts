import { PhotoUpdate } from '@/src/types';

export function imageSourceUri(source: PhotoUpdate['uri']): string {
  if (typeof source === 'string') return source;
  if (typeof source === 'object' && source && typeof source.uri === 'string') return source.uri;
  return '';
}
