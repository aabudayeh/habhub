export type CloudSnapshotMetadata = {
  revision: number;
  updated_at: string;
};

export type CloudSnapshotCursor = {
  revision: number;
  updatedAt: string;
  acknowledgedHash: string;
};

export function cloudSnapshotCursorForAcknowledgement(
  metadata: CloudSnapshotMetadata,
  acknowledgedHash: string,
): CloudSnapshotCursor {
  return {
    revision: metadata.revision,
    updatedAt: metadata.updated_at,
    acknowledgedHash,
  };
}

/**
 * A cursor is usable only when it was persisted for the same acknowledged
 * hash. This prevents a crash between downloading a new revision and merging
 * it from making the next cold start incorrectly skip that remote payload.
 */
export function cloudSnapshotCursorMatches(
  cursor: CloudSnapshotCursor | null,
  metadata: CloudSnapshotMetadata | null,
  acknowledgedHash: string | null,
  currentHash: string,
  accountIdentityMatches: boolean,
) {
  if (
    !cursor ||
    !metadata ||
    !acknowledgedHash ||
    !accountIdentityMatches ||
    cursor.acknowledgedHash !== acknowledgedHash ||
    currentHash !== acknowledgedHash
  )
    return false;
  return metadata.revision > 0 || cursor.revision > 0
    ? metadata.revision === cursor.revision
    : metadata.updated_at === cursor.updatedAt;
}

/** Safe one-time upgrade path for clients released before revision cursors. */
export function canBootstrapCloudSnapshotCursor(options: {
  hasCursor: boolean;
  metadata: CloudSnapshotMetadata | null;
  acknowledgedHash: string | null;
  currentHash: string;
  savedCheckpoint: string | null;
  accountIdentityMatches: boolean;
}) {
  return Boolean(
    !options.hasCursor &&
      options.metadata &&
      options.accountIdentityMatches &&
      options.acknowledgedHash &&
      options.currentHash === options.acknowledgedHash &&
      options.savedCheckpoint === options.metadata.updated_at,
  );
}
