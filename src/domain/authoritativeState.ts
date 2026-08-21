/**
 * Parent/provider renders may repeat the last committed React value while a
 * deferred cloud transition is queued. Only a genuinely advanced React value
 * may replace the newer authoritative ref used by local reducers.
 */
export function advanceAuthoritativeStateFromRender<T>(
  authoritative: T,
  lastRendered: T,
  rendered: T,
) {
  return Object.is(lastRendered, rendered) ? authoritative : rendered;
}
