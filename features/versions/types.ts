import type { PublishedKind } from "./policy";

export type VersionSummary = {
  treeId: string;
  kind: PublishedKind;
  versionSeq: number;
  publishedAt: string | null;
  title: string;
  mergerName: string | null;
  countsLabel: string | null;
  live: boolean;
};
