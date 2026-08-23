import type {
  GoogleHealthStepCheckpoint,
  GoogleHealthStepCheckpointSource,
} from "@/src/domain/googleHealthStepCheckpoint";

/** Native health data already has platform-backed storage and never uses this PWA cache. */
export async function readGoogleHealthStepCheckpoint(
  _accountId: string,
): Promise<GoogleHealthStepCheckpoint | undefined> {
  return undefined;
}

export async function writeGoogleHealthStepCheckpoint(
  _state: GoogleHealthStepCheckpointSource,
) {}

export async function deleteGoogleHealthStepCheckpoint(_accountId: string) {}
