import type {
  GoogleHealthGroupCheckpoint,
  GoogleHealthGroupCheckpointSource,
} from "@/src/domain/googleHealthGroupCheckpoint";

/** Native group activity remains in the platform-backed bounded cache. */
export async function readGoogleHealthGroupCheckpoint(
  _accountId: string,
  _groupId: string,
): Promise<GoogleHealthGroupCheckpoint | undefined> {
  return undefined;
}

export async function writeGoogleHealthGroupCheckpoint(
  _source: GoogleHealthGroupCheckpointSource,
) {}

export async function deleteGoogleHealthGroupCheckpoint(
  _accountId: string,
  _groupId: string,
) {}
