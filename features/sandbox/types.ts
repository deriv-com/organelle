export interface SandboxSummary {
  treeId: string;
  name: string;
  createdAt: string;
  forkedFromSeq: number;
  changeCount: number;
  ownerAuthId: string;
  liveSeq?: number | null;
  isStale?: boolean;
  /** True when `trees.archived_at` is set. */
  archived: boolean;
}

export interface SharedSandboxSummary extends SandboxSummary {
  accessLevel: "viewer" | "editor";
  ownerName: string;
}

export interface SandboxListPayload {
  owned: SandboxSummary[];
  shared: SharedSandboxSummary[];
}
