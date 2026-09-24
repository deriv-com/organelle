import type { PublicDirectoryRow } from "./directory-row";
import type { HeaderOption } from "./filter-bar";

export const DIRECTORY_STREAM_BATCH_SIZE = 50;

export interface DirectoryStreamMeta {
  type: "meta";
  treeId: string;
  versionSeq: number;
  publishedAt: string | null;
  total: number;
  headers: HeaderOption[];
}

export interface DirectoryStreamRows {
  type: "rows";
  rows: PublicDirectoryRow[];
}

export interface DirectoryStreamDone {
  type: "done";
}

export type DirectoryStreamMessage =
  DirectoryStreamMeta | DirectoryStreamRows | DirectoryStreamDone;

export function directoryRowBatches(
  rows: PublicDirectoryRow[],
  batchSize = DIRECTORY_STREAM_BATCH_SIZE,
): PublicDirectoryRow[][] {
  const batches: PublicDirectoryRow[][] = [];
  for (let index = 0; index < rows.length; index += batchSize) {
    batches.push(rows.slice(index, index + batchSize));
  }
  return batches;
}

export function encodeDirectoryStreamMessage(message: DirectoryStreamMessage): string {
  return `${JSON.stringify(message)}\n`;
}
