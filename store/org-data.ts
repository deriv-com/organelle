"use client";

/**
 * Client-side mirror of the server-fetched tree payload. Pages hydrate it on
 * mount so the global chrome (employee dialog, sandbox switcher) in the root
 * layout can reach the data without prop drilling through layouts.
 */

import { create } from "zustand";

import type { ChartRow, SeatMember } from "@/features/chart/chart-row";
import type { DirectoryRow } from "@/features/directory/directory-row";

interface OrgDataState {
  treeId: string | null;
  treeKind: "published" | "sandbox" | "historical" | null;
  versionSeq: number | null;
  sandboxName: string | null;
  sandboxOwnerAuthId: string | null;
  sandboxArchived: boolean;
  sandboxEditable: boolean;
  sandboxCanPublish: boolean;
  sandboxCanShare: boolean;
  sandboxCanReadHistory: boolean;
  publishedAt: string | null;
  chartRows: ChartRow[];
  directoryRows: DirectoryRow[];
  historyOpen: boolean;
  focusRequest: { nodeId: string; gen: number } | null;
  mergeChrome: { conflictCount: number; changeCount: number } | null;
  mergeDialog: "conflicts" | "changes" | "details" | "submit" | null;
  /** Open employee dialog: client-side state; the ?employee= URL
   *  param is only a mirror for deep links — no server navigation. */
  drawerAuthId: string | null;
  drawerNodeId: string | null;
  persistCount: number;
  pendingNodeIds: string[];
  persistPhase: "idle" | "saving" | "saved";
  pendingCounts: Record<string, number>;
  canUndo: boolean;
  canRedo: boolean;
  undoGen: number;
  redoGen: number;
  setHistoryOpen: (open: boolean) => void;
  requestFocus: (nodeId: string) => void;
  clearFocusRequest: () => void;
  setMergeChrome: (
    chrome: { conflictCount: number; changeCount: number } | null,
  ) => void;
  setMergeDialog: (
    dialog: "conflicts" | "changes" | "details" | "submit" | null,
  ) => void;
  setDrawerAuthId: (authId: string | null, nodeId?: string | null) => void;
  /** Keep global dialog data aligned with optimistic chart mutations. */
  setChartRows: (chartRows: ChartRow[]) => void;
  patchEmployee: (authId: string, patch: Partial<SeatMember>) => void;
  setPrimarySeatLocal: (authId: string, nodeId: string) => void;
  patchSeat: (nodeId: string, patch: Partial<ChartRow>) => void;
  beginPersist: (nodeIds: string[]) => void;
  endPersist: (nodeIds: string[]) => void;
  failPersist: () => void;
  clearSaved: () => void;
  setUndoChrome: (chrome: { canUndo: boolean; canRedo: boolean }) => void;
  requestUndo: () => void;
  requestRedo: () => void;
  clearTreeData: (treeId: string) => void;
  setData: (data: {
    treeId: string;
    treeKind: "published" | "sandbox" | "historical";
    versionSeq: number | null;
    sandboxName: string | null;
    sandboxOwnerAuthId?: string | null;
    sandboxArchived?: boolean;
    sandboxEditable?: boolean;
    sandboxCanPublish?: boolean;
    sandboxCanShare?: boolean;
    sandboxCanReadHistory?: boolean;
    publishedAt?: string | null;
    chartRows: ChartRow[];
    directoryRows: DirectoryRow[];
  }) => void;
}

export const useOrgData = create<OrgDataState>((set) => ({
  treeId: null,
  treeKind: null,
  versionSeq: null,
  sandboxName: null,
  sandboxOwnerAuthId: null,
  sandboxArchived: false,
  sandboxEditable: false,
  sandboxCanPublish: false,
  sandboxCanShare: false,
  sandboxCanReadHistory: false,
  publishedAt: null,
  chartRows: [],
  directoryRows: [],
  historyOpen: false,
  focusRequest: null,
  mergeChrome: null,
  mergeDialog: null,
  drawerAuthId: null,
  drawerNodeId: null,
  persistCount: 0,
  pendingNodeIds: [],
  persistPhase: "idle",
  pendingCounts: {} as Record<string, number>,
  canUndo: false,
  canRedo: false,
  undoGen: 0,
  redoGen: 0,
  setHistoryOpen: (open) => set({ historyOpen: open }),
  requestFocus: (nodeId) =>
    set((state) => ({
      focusRequest: { nodeId, gen: (state.focusRequest?.gen ?? 0) + 1 },
    })),
  clearFocusRequest: () => set({ focusRequest: null }),
  setMergeChrome: (chrome) => set({ mergeChrome: chrome }),
  setMergeDialog: (dialog) => set({ mergeDialog: dialog }),
  setDrawerAuthId: (authId, nodeId = null) =>
    set({ drawerAuthId: authId, drawerNodeId: authId ? nodeId : null }),
  setChartRows: (chartRows) => set({ chartRows }),
  patchEmployee: (authId, patch) =>
    set((state) => ({
      chartRows: state.chartRows.map((row) => ({
        ...row,
        members: row.members.map((member) =>
          member.authId === authId ? { ...member, ...patch } : member,
        ),
      })),
      directoryRows: state.directoryRows.map((row) => ({
        ...row,
        host: row.host.authId === authId ? { ...row.host, ...patch } : row.host,
      })),
    })),
  setPrimarySeatLocal: (authId, nodeId) =>
    set((state) => ({
      chartRows: state.chartRows.map((row) => ({
        ...row,
        members: row.members.map((member) =>
          member.authId === authId
            ? { ...member, isPrimary: row.id === nodeId }
            : member,
        ),
      })),
    })),
  patchSeat: (nodeId, patch) =>
    set((state) => ({
      chartRows: state.chartRows.map((row) =>
        row.id === nodeId ? { ...row, ...patch } : row,
      ),
      directoryRows: state.directoryRows.map((row) =>
        row.nodeId === nodeId && patch.jobTitle !== undefined
          ? { ...row, jobTitle: patch.jobTitle }
          : row,
      ),
    })),
  beginPersist: (nodeIds) =>
    set((state) => {
      const counts = { ...state.pendingCounts };
      for (const id of nodeIds) counts[id] = (counts[id] ?? 0) + 1;
      return {
        persistCount: state.persistCount + 1,
        pendingCounts: counts,
        pendingNodeIds: Object.keys(counts).filter((id) => counts[id] > 0),
        persistPhase: "saving" as const,
      };
    }),
  endPersist: (nodeIds) =>
    set((state) => {
      const counts = { ...state.pendingCounts };
      for (const id of nodeIds) {
        const next = (counts[id] ?? 1) - 1;
        if (next <= 0) delete counts[id];
        else counts[id] = next;
      }
      const persistCount = Math.max(0, state.persistCount - 1);
      return {
        persistCount,
        pendingCounts: counts,
        pendingNodeIds: Object.keys(counts).filter((id) => counts[id] > 0),
        persistPhase: persistCount === 0 ? ("saved" as const) : ("saving" as const),
      };
    }),
  failPersist: () =>
    set({
      persistCount: 0,
      pendingCounts: {},
      pendingNodeIds: [],
      persistPhase: "idle",
    }),
  clearSaved: () =>
    set((state) => (state.persistPhase === "saved" ? { persistPhase: "idle" } : state)),
  setUndoChrome: (chrome) => set({ canUndo: chrome.canUndo, canRedo: chrome.canRedo }),
  requestUndo: () => set((state) => ({ undoGen: state.undoGen + 1 })),
  requestRedo: () => set((state) => ({ redoGen: state.redoGen + 1 })),
  clearTreeData: (treeId) =>
    set((state) =>
      state.treeId !== treeId
        ? state
        : {
            treeId: null,
            treeKind: null,
            versionSeq: null,
            sandboxName: null,
            sandboxOwnerAuthId: null,
            sandboxArchived: false,
            sandboxEditable: false,
            sandboxCanPublish: false,
            sandboxCanShare: false,
            sandboxCanReadHistory: false,
            publishedAt: null,
            chartRows: [],
            directoryRows: [],
            historyOpen: false,
            focusRequest: null,
            mergeChrome: null,
            mergeDialog: null,
            drawerAuthId: null,
            drawerNodeId: null,
            persistCount: 0,
            pendingNodeIds: [],
            persistPhase: "idle" as const,
            pendingCounts: {},
            canUndo: false,
            canRedo: false,
          },
    ),
  setData: (data) =>
    set({
      ...data,
      publishedAt: data.publishedAt ?? null,
      sandboxOwnerAuthId: data.sandboxOwnerAuthId ?? null,
      sandboxArchived: data.sandboxArchived ?? false,
      sandboxEditable: data.sandboxEditable ?? false,
      sandboxCanPublish: data.sandboxCanPublish ?? false,
      sandboxCanShare: data.sandboxCanShare ?? false,
      sandboxCanReadHistory: data.sandboxCanReadHistory ?? false,
    }),
}));
