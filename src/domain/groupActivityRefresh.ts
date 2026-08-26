type RangeRefreshDecision = {
  requestedSince?: string;
  loadedSince?: string;
  force: boolean;
};

export function groupActivityRangeAlreadyLoaded({
  requestedSince,
  loadedSince,
  force,
}: RangeRefreshDecision) {
  return Boolean(
    requestedSince &&
      !force &&
      loadedSince &&
      loadedSince <= requestedSince,
  );
}

type VersionCommitDecision = {
  responseVersion?: number;
  lastVersion?: number;
  extendsCoverage: boolean;
  force: boolean;
};

export function shouldCommitGroupActivityResponse({
  responseVersion,
  lastVersion,
  extendsCoverage,
  force,
}: VersionCommitDecision) {
  return !(
    responseVersion !== undefined &&
    lastVersion !== undefined &&
    responseVersion <= lastVersion &&
    !extendsCoverage &&
    !force
  );
}

export function groupActivitySnapshotProvesMembershipLoss({
  snapshotRpcMissing,
  snapshotPresent,
}: {
  snapshotRpcMissing: boolean;
  snapshotPresent: boolean;
}) {
  return !snapshotRpcMissing && !snapshotPresent;
}

export function groupActivityFallbackMembershipIsActive(
  membershipStatus: string | null | undefined,
) {
  return membershipStatus === "active";
}

export function forcedGroupActivityRequestCrossedGroupBoundary({
  force,
  sameGroup,
}: {
  force: boolean;
  sameGroup: boolean;
}) {
  return force && !sameGroup;
}

export function shouldRequeueSupersededGroupActivity({
  force,
  sameGroup,
}: {
  force: boolean;
  sameGroup: boolean;
}) {
  return force && sameGroup;
}
