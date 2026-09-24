"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toast } from "sonner";

import { PageLoading } from "@/components/page-state";
import { useActor } from "@/features/auth/auth-provider";
import { useOrgData } from "@/store/org-data";
import { buildDirectoryRows } from "@/features/directory/directory-row";
import { filterDirectoryRowsForRole } from "@/features/directory/directory-visibility";
import {
  createNode,
  deleteNode,
  joinPeer,
  moveMember,
  moveNode,
  redoLast,
  renameHeader,
  setAssistant,
  setLeafGridColumns,
  undoLast,
} from "@/features/sandbox/actions";
import type { PersistAck } from "@/features/sandbox/persist-ack";
import { applyCommand, invertCommand } from "@/features/sandbox/invert-command";
import {
  commandFocusNodeId,
  type CommandLogRow,
} from "@/features/sandbox/command-stack";
import { SandboxHistory } from "@/features/sandbox/history";
import {
  filterVisibleChartMembers,
  orderRows,
  indexFromRows,
  type ChartRow,
  type SeatMember,
} from "./chart-row";
import { toEmployeeOption } from "./employee-picker";
import {
  seatMemberFromDraft,
  resolveEmployeeLifecycleStatus,
  type EmployeeDraft,
} from "@/features/directory/employee-fields";
import { createPersistQueue, type PersistOp } from "./persist-queue";
import { createPendingBuffers } from "./pending-commands";
import { UnplacedBadge } from "./unplaced-badge";
import { listUnplacedEmployees } from "./unplaced";
import {
  applyCreate,
  applyDelete,
  applyMemberMove,
  applyMemberNewSeat,
  applyMove,
  applyMoveNodeOnly,
  applyPeer,
  applySetAssistant,
  applySetLeafGridColumns,
  shouldAskMoveMode,
  type Drop,
  type MoveDrop,
} from "./drag/apply";
import {
  canBeAssistant,
  canHostAssistant,
  validateNodeOnlyDetach,
} from "./drag/validate";
import { AddNodeDialog, type AddNodeRequest } from "./drag/add-node-dialog";
import { RenameTeamDialog, type RenameRequest } from "./drag/rename-dialog";
import { DeleteNodeDialog, type DeleteRequest } from "./drag/delete-node-dialog";
import {
  MoveNodeDialog,
  type MoveMode,
  type MoveRequest,
} from "./drag/move-node-dialog";
import {
  PeerOrChildDialog,
  type PeerOrChildRequest,
  type SeatDropIntent,
} from "./drag/peer-or-child-dialog";
import { ChartSearch } from "./chart-search";
import { ChartControls } from "./chart-controls";
import type { ChartCamera } from "./org-chart";
import { StaleBanner } from "@/features/merge/stale-banner";

// d3-org-chart owns the DOM inside its container; never server-render it.
const OrgChartView = dynamic(() => import("./org-chart"), {
  ssr: false,
  loading: () => <PageLoading label="Loading chart…" />,
});

export interface ChartClientProps {
  treeId: string;
  treeKind: "published" | "sandbox" | "historical";
  versionSeq: number | null;
  sandboxName: string | null;
  ownerAuthId?: string | null;
  /** Sandbox archived via `archived_at` (read-only until restore). */
  archived?: boolean;
  rows: ChartRow[];
  /** Sandbox-only employee catalog for Add position (includes unplaced people). */
  pickerEmployees?: SeatMember[];
  editable: boolean;
  canPublish?: boolean;
  canShare?: boolean;
  canReadHistory?: boolean;
  liveSeq?: number;
  forkedFromSeq?: number;
  publishedAt?: string | null;
  initialFocus?: string | null;
  undoLog?: CommandLogRow[];
  redoLog?: CommandLogRow[];
  canUndo?: boolean;
  canRedo?: boolean;
}

function nodeIdsFromLog(log: CommandLogRow[]): string[] {
  return [
    ...new Set(log.map((row) => row.node_id).filter((id): id is string => Boolean(id))),
  ];
}

function versionsFromRows(list: ChartRow[]): Map<string, number> {
  return new Map(list.map((row) => [row.id, Number(row.rowVersion)]));
}

export function ChartClient({
  treeId,
  treeKind,
  versionSeq,
  sandboxName,
  ownerAuthId = null,
  archived = false,
  rows: initialRows,
  pickerEmployees = [],
  editable,
  canPublish = false,
  canShare = false,
  canReadHistory = false,
  liveSeq,
  forkedFromSeq,
  publishedAt = null,
  initialFocus = null,
  undoLog = [],
  redoLog = [],
  canUndo: initialCanUndo = false,
  canRedo: initialCanRedo = false,
}: ChartClientProps) {
  const setData = useOrgData((state) => state.setData);
  const actor = useActor();
  const storeTreeId = useOrgData((state) => state.treeId);
  const storeChartRows = useOrgData((state) => state.chartRows);
  const pendingNodeIds = useOrgData((state) => state.pendingNodeIds);
  const focusRequest = useOrgData((state) => state.focusRequest);
  const cameraRef = useRef<ChartCamera | null>(null);

  // The optimistic tree store: the RSC payload seeds it, drops
  // mutate it instantly, and a failed persist restores lastGoodRows.
  const [rows, setRows] = useState(initialRows);
  const lastGoodRef = useRef(initialRows);
  const rowsRef = useRef(initialRows);
  const rowVersionRef = useRef(versionsFromRows(initialRows));
  const treeIdRef = useRef(treeId);
  const setRowsRef = useRef(setRows);
  setRowsRef.current = setRows;

  const lastBeforeRef = useRef<ChartRow[]>(initialRows);
  const pendingRef = useRef(createPendingBuffers());
  const undoLogRef = useRef<CommandLogRow[]>(undoLog);
  const redoLogRef = useRef<CommandLogRow[]>(redoLog);
  const ackedChromeRef = useRef({ canUndo: initialCanUndo, canRedo: initialCanRedo });

  const paint = useCallback((apply: (current: ChartRow[]) => ChartRow[]) => {
    lastBeforeRef.current = rowsRef.current;
    const next = orderRows(apply(rowsRef.current));
    rowsRef.current = next;
    setRows(next);
    // The profile dialog lives above this component and reads the global store.
    // Update it in the same turn as the optimistic paint so a new card is
    // immediately clickable as a person, not just visible as one.
    useOrgData.getState().setChartRows(next);
  }, []);

  const queueRef = useRef<ReturnType<typeof createPersistQueue<ChartRow[]>> | null>(
    null,
  );
  if (queueRef.current === null) {
    queueRef.current = createPersistQueue<ChartRow[]>({
      getLastGood: () => lastGoodRef.current,
      setLastGood: (next) => {
        lastGoodRef.current = orderRows(next);
      },
      setRows: (next) => {
        const ordered = orderRows(next);
        rowsRef.current = ordered;
        setRowsRef.current(ordered);
        useOrgData.getState().setChartRows(ordered);
      },
      mergeVersions: (versions) => {
        const map = new Map(versions.map((item) => [item.nodeId, item.rowVersion]));
        for (const [id, version] of map) rowVersionRef.current.set(id, version);
        lastGoodRef.current = lastGoodRef.current.map((row) =>
          map.has(row.id) ? { ...row, rowVersion: map.get(row.id)! } : row,
        );
      },
      restoreFromLastGood: (good) => {
        rowVersionRef.current = versionsFromRows(good);
      },
      onFail: (reason) => {
        pendingRef.current.clear();
        useOrgData.getState().failPersist();
        useOrgData.getState().setUndoChrome(ackedChromeRef.current);
        toast.error(reason);
      },
    });
  }

  const applyAck = useCallback((result: PersistAck) => {
    undoLogRef.current = result.undoLog;
    redoLogRef.current = result.redoLog;
    ackedChromeRef.current = { canUndo: result.canUndo, canRedo: result.canRedo };
    useOrgData.getState().setUndoChrome(ackedChromeRef.current);
  }, []);

  const enqueuePersist = useCallback(
    (op: PersistOp<ChartRow[]>, kind: "user" | "stack" = "user") => {
      let onAck = op.onAck;
      if (kind === "user") {
        const pending = pendingRef.current.pushUser({
          before: lastBeforeRef.current,
          apply: op.apply,
          nodeIds: op.nodeIds,
          focusNodeId: op.nodeIds[0] ?? null,
        });
        useOrgData.getState().setUndoChrome({ canUndo: true, canRedo: false });
        onAck = () => {
          pendingRef.current.acknowledge(pending.token);
          op.onAck?.();
        };
      }
      useOrgData.getState().beginPersist(op.nodeIds);
      queueRef.current!.enqueue({
        ...op,
        onAck,
        persist: async () => {
          const result = await op.persist();
          if (result.ok) {
            useOrgData.getState().endPersist(op.nodeIds);
            if ("canUndo" in result) applyAck(result as PersistAck);
          }
          return result;
        },
      });
    },
    [applyAck],
  );

  // Adopt the RSC payload only on a tree switch. Sandbox writes must not call
  // refresh/revalidatePath; if an echo still arrives, ignore it unless treeId
  // changed — resetting local rows mid-mutation made drops spring back.
  useEffect(() => {
    if (treeIdRef.current === treeId) return;
    treeIdRef.current = treeId;
    lastGoodRef.current = initialRows;
    rowsRef.current = initialRows;
    rowVersionRef.current = versionsFromRows(initialRows);
    setRows(initialRows);
  }, [treeId, initialRows]);

  useEffect(() => {
    pendingRef.current.clear();
    undoLogRef.current = undoLog;
    redoLogRef.current = redoLog;
    ackedChromeRef.current = { canUndo: initialCanUndo, canRedo: initialCanRedo };
    useOrgData.getState().setUndoChrome(ackedChromeRef.current);
    // Only rehydrate on tree switch — RSC echoes must not reset the stack.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeId]);

  useEffect(() => {
    if (storeTreeId !== treeId) return;
    if (storeChartRows.length === 0 || storeChartRows === rowsRef.current) return;
    rowsRef.current = storeChartRows;
    setRows(storeChartRows);
  }, [storeTreeId, storeChartRows, treeId]);

  const directoryRows = useMemo(
    () => filterDirectoryRowsForRole(buildDirectoryRows(rows), actor?.role ?? "viewer"),
    [rows, actor?.role],
  );
  const visibleRows = useMemo(() => filterVisibleChartMembers(rows), [rows]);
  // Hydrate the global store so the header switcher and drawer (root layout)
  // can reach this page's data.
  useEffect(() => {
    if (rows !== rowsRef.current) return;
    setData({
      treeId,
      treeKind,
      versionSeq,
      sandboxName,
      sandboxOwnerAuthId: ownerAuthId,
      sandboxArchived: archived,
      sandboxEditable: editable,
      sandboxCanPublish: canPublish,
      sandboxCanShare: canShare,
      sandboxCanReadHistory: canReadHistory,
      publishedAt,
      chartRows: rows,
      directoryRows,
    });
  }, [
    treeId,
    treeKind,
    versionSeq,
    sandboxName,
    ownerAuthId,
    archived,
    editable,
    canPublish,
    canShare,
    canReadHistory,
    publishedAt,
    rows,
    directoryRows,
    setData,
  ]);

  // Search focus is local (and stays on this tree). Seed once from ?focus= for
  // deep links, then drop the param so a leftover query string cannot re-run
  // centering and fight pan.
  const [focus, setFocus] = useState<{
    id: string;
    gen: number;
    preserveExpanded?: boolean;
  } | null>(() => (initialFocus ? { id: initialFocus, gen: 0 } : null));
  const [motion, setMotion] = useState<{ id: string; gen: number } | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("focus");
    if (fromUrl && !initialFocus) setFocus({ id: fromUrl, gen: 0 });
    if (!fromUrl) return;
    url.searchParams.delete("focus");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [initialFocus]);

  useEffect(() => {
    if (!focusRequest) return;
    setFocus({ id: focusRequest.nodeId, gen: focusRequest.gen });
    useOrgData.getState().clearFocusRequest();
  }, [focusRequest]);

  const setDrawerAuthId = useOrgData((state) => state.setDrawerAuthId);
  const openEmployee = (authId: string, nodeId: string) =>
    setDrawerAuthId(authId, nodeId);

  const expectedVersion = useCallback(
    (nodeId: string) => rowVersionRef.current.get(nodeId) ?? 1,
    [],
  );

  const motionFocus = useCallback((nodeId: string | null) => {
    if (!nodeId) return;
    if (!rowsRef.current.some((row) => row.id === nodeId)) return;
    setMotion((prev) => ({ id: nodeId, gen: (prev?.gen ?? 0) + 1 }));
  }, []);

  const undoGen = useOrgData((state) => state.undoGen);
  const redoGen = useOrgData((state) => state.redoGen);
  const lastUndoGen = useRef(0);
  const lastRedoGen = useRef(0);

  useEffect(() => {
    if (!editable || undoGen === lastUndoGen.current) return;
    lastUndoGen.current = undoGen;
    const cmd = pendingRef.current.popUser();
    if (cmd) {
      paint(() => cmd.before);
      motionFocus(cmd.focusNodeId);
      useOrgData.getState().setUndoChrome({
        canUndo: pendingRef.current.user().length > 0 || undoLogRef.current.length > 0,
        canRedo: true,
      });
      enqueuePersist(
        {
          nodeIds: cmd.nodeIds,
          apply: () => cmd.before,
          persist: () => undoLast(treeId),
        },
        "stack",
      );
      return;
    }
    const log = undoLogRef.current;
    if (log.length === 0) return;
    paint((current) => invertCommand(current, log));
    motionFocus(commandFocusNodeId(log));
    useOrgData.getState().setUndoChrome({ canUndo: false, canRedo: true });
    enqueuePersist(
      {
        nodeIds: nodeIdsFromLog(log),
        apply: (current) => invertCommand(current, log),
        persist: () => undoLast(treeId),
      },
      "stack",
    );
  }, [undoGen, editable, enqueuePersist, paint, motionFocus, treeId]);

  useEffect(() => {
    if (!editable || redoGen === lastRedoGen.current) return;
    lastRedoGen.current = redoGen;
    const cmd = pendingRef.current.popRedo();
    if (cmd) {
      paint(cmd.apply);
      motionFocus(cmd.focusNodeId);
      useOrgData.getState().setUndoChrome({
        canUndo: true,
        canRedo: pendingRef.current.redo().length > 0,
      });
      enqueuePersist(
        {
          nodeIds: cmd.nodeIds,
          apply: cmd.apply,
          persist: () => redoLast(treeId),
        },
        "stack",
      );
      return;
    }
    const log = redoLogRef.current;
    if (log.length === 0) return;
    paint((current) => applyCommand(current, log));
    motionFocus(commandFocusNodeId(log));
    useOrgData.getState().setUndoChrome({ canUndo: true, canRedo: false });
    enqueuePersist(
      {
        nodeIds: nodeIdsFromLog(log),
        apply: (current) => applyCommand(current, log),
        persist: () => redoLast(treeId),
      },
      "stack",
    );
  }, [redoGen, editable, enqueuePersist, paint, motionFocus, treeId]);

  useEffect(() => {
    if (!editable) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
        if (target.closest("[role='dialog']")) return;
      }
      event.preventDefault();
      if (event.shiftKey) useOrgData.getState().requestRedo();
      else useOrgData.getState().requestUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable]);

  const rowLabel = useCallback((row: ChartRow) => {
    return row.kind === "header"
      ? (row.name ?? "team")
      : (row.members[0]?.displayName ?? row.jobTitle ?? "seat");
  }, []);

  // Move execution shared by the no-children path and the move dialog's
  // confirm.
  const executeMove = useCallback(
    (drop: MoveDrop, mode: MoveMode) => {
      if (mode === "node-only") {
        const current = rowsRef.current;
        const blocked = validateNodeOnlyDetach(
          current,
          indexFromRows(current),
          drop.nodeId,
        );
        if (blocked && !blocked.ok) {
          toast.error(blocked.reason);
          return;
        }
      }
      const apply = (current: ChartRow[]) =>
        mode === "node-only"
          ? applyMoveNodeOnly(current, drop)
          : applyMove(current, drop);
      paint(apply);
      enqueuePersist({
        nodeIds: [drop.nodeId],
        apply,
        persist: () =>
          moveNode({
            treeId,
            nodeId: drop.nodeId,
            newParentId: drop.newParentId,
            beforeSiblingId: drop.beforeSiblingId,
            expectedRowVersion: expectedVersion(drop.nodeId),
            mode,
            asAssistant: drop.asAssistant,
          }),
      });
    },
    [treeId, enqueuePersist, expectedVersion, paint],
  );

  const [moveRequest, setMoveRequest] = useState<
    (MoveRequest & { drop: MoveDrop }) | null
  >(null);
  const [peerOrChildRequest, setPeerOrChildRequest] =
    useState<PeerOrChildRequest | null>(null);

  // Persist a validated drop. Peer-zone hits go through PeerOrChildDialog first;
  // child/sibling/header drops (and dialog-rewritten child drops) land here.
  const persistDrop = useCallback(
    (drop: Drop) => {
      // A node with children asks first: whole subtree along, or the node
      // alone (children stay with the old parent). Cancel applies nothing.
      if (drop.kind === "move") {
        const current = rowsRef.current;
        if (shouldAskMoveMode(drop, current)) {
          const dragged = current.find((row) => row.id === drop.nodeId);
          if (!dragged) {
            executeMove(drop, "subtree");
            return;
          }
          const oldParent = current.find((row) => row.id === dragged.parentId);
          setMoveRequest({
            drop,
            nodeId: drop.nodeId,
            kind: dragged.kind,
            label: rowLabel(dragged),
            childCount: current.filter((row) => row.parentId === drop.nodeId).length,
            oldParentLabel: oldParent ? rowLabel(oldParent) : "its parent",
          });
          return;
        }
        executeMove(drop, "subtree");
        return;
      }

      const draggedId = drop.sourceSeatId;

      if (drop.kind === "member-new-seat") {
        const newSeatId = drop.newSeatId ?? crypto.randomUUID();
        const spec = { ...drop, newSeatId };
        const apply = (current: ChartRow[]) => {
          const next = applyMemberNewSeat(current, spec);
          const parent = next.find((row) => row.id === drop.parentId);
          if (parent) parent._expanded = true;
          return next;
        };
        paint(apply);
        enqueuePersist({
          nodeIds: [draggedId, newSeatId],
          apply,
          persist: () =>
            moveMember({
              treeId,
              sourceSeatId: drop.sourceSeatId,
              employeeAuthId: drop.authId,
              expectedRowVersion: expectedVersion(draggedId),
              target: {
                kind: "new-seat",
                parentId: drop.parentId,
                beforeSiblingId: drop.beforeSiblingId,
                nodeId: newSeatId,
                asAssistant: drop.asAssistant,
              },
            }),
        });
        return;
      }

      const apply =
        drop.kind === "peer"
          ? (current: ChartRow[]) => applyPeer(current, drop)
          : (current: ChartRow[]) => applyMemberMove(current, drop);
      paint(apply);
      enqueuePersist({
        nodeIds:
          drop.kind === "peer"
            ? [drop.sourceSeatId, drop.targetSeatId]
            : [drop.sourceSeatId, drop.targetSeatId],
        apply,
        persist: () =>
          drop.kind === "peer"
            ? joinPeer({
                treeId,
                sourceSeatId: drop.sourceSeatId,
                targetSeatId: drop.targetSeatId,
                expectedRowVersion: expectedVersion(draggedId),
              })
            : moveMember({
                treeId,
                sourceSeatId: drop.sourceSeatId,
                employeeAuthId: drop.authId,
                expectedRowVersion: expectedVersion(draggedId),
                target: { kind: "peer", seatId: drop.targetSeatId },
              }),
      });
    },
    [treeId, rowLabel, executeMove, enqueuePersist, expectedVersion, paint],
  );

  const handleDrop = useCallback(
    (drop: Drop) => {
      if (drop.kind === "peer" || drop.kind === "member-peer") {
        const current = rowsRef.current;
        const source = current.find((row) => row.id === drop.sourceSeatId);
        const target = current.find((row) => row.id === drop.targetSeatId);
        const memberLabel =
          drop.kind === "member-peer"
            ? (source?.members.find((m) => m.authId === drop.authId)?.displayName ??
              null)
            : null;
        setPeerOrChildRequest({
          drop,
          sourceLabel: source ? rowLabel(source) : "seat",
          targetLabel: target ? rowLabel(target) : "seat",
          memberLabel,
        });
        return;
      }
      persistDrop(drop);
    },
    [rowLabel, persistDrop],
  );

  const confirmPeerOrChild = useCallback(
    (intent: SeatDropIntent) => {
      const request = peerOrChildRequest;
      setPeerOrChildRequest(null);
      if (!request) return;
      if (intent === "peer") {
        void persistDrop(request.drop);
        return;
      }
      const current = rowsRef.current;
      const sourceId =
        request.drop.kind === "peer"
          ? request.drop.sourceSeatId
          : request.drop.sourceSeatId;
      const targetId =
        request.drop.kind === "peer"
          ? request.drop.targetSeatId
          : request.drop.targetSeatId;
      if (intent === "assistant") {
        const check =
          request.drop.kind === "peer"
            ? canBeAssistant(current, indexFromRows(current), sourceId, targetId)
            : canHostAssistant(current, indexFromRows(current), targetId);
        if (!check.ok) {
          toast.error(check.reason);
          return;
        }
      }
      const rewritten: Drop =
        request.drop.kind === "peer"
          ? {
              kind: "move",
              nodeId: request.drop.sourceSeatId,
              newParentId: request.drop.targetSeatId,
              beforeSiblingId: null,
              asAssistant: intent === "assistant",
            }
          : {
              kind: "member-new-seat",
              sourceSeatId: request.drop.sourceSeatId,
              authId: request.drop.authId,
              parentId: request.drop.targetSeatId,
              beforeSiblingId: null,
              asAssistant: intent === "assistant",
            };
      void persistDrop(rewritten);
    },
    [peerOrChildRequest, persistDrop],
  );

  // Context-menu add: the menu opens a dialog — a team needs a
  // name, a position needs an employee. Nothing is created on cancel.
  const [addRequest, setAddRequest] = useState<AddNodeRequest | null>(null);
  const [catalogExtra, setCatalogExtra] = useState<SeatMember[]>([]);

  useEffect(() => {
    setCatalogExtra([]);
  }, [treeId]);

  useEffect(() => {
    setCatalogExtra((current) => {
      if (current.length === 0) return current;
      const seated = new Set(
        rows.flatMap((row) => row.members.map((member) => member.authId)),
      );
      const next = current.filter((member) => seated.has(member.authId));
      return next.length === current.length ? current : next;
    });
  }, [rows]);

  const catalog = useMemo(
    () => [...pickerEmployees, ...catalogExtra],
    [pickerEmployees, catalogExtra],
  );
  const unplaced = useMemo(
    () =>
      treeKind === "sandbox" && editable ? listUnplacedEmployees(catalog, rows) : [],
    [treeKind, editable, catalog, rows],
  );
  const employees = useMemo(() => catalog.map(toEmployeeOption), [catalog]);
  const pickerByAuthId = useMemo(
    () => new Map(catalog.map((member) => [member.authId, member])),
    [catalog],
  );

  const handleAddChild = useCallback(
    (parentId: string, kind: "header" | "seat", asAssistant = false) => {
      const parent = rowsRef.current.find((row) => row.id === parentId);
      const parentLabel =
        parent?.kind === "header"
          ? (parent.name ?? "team")
          : (parent?.members[0]?.displayName ?? parent?.jobTitle ?? "seat");
      setAddRequest({ parentId, parentLabel, kind, asAssistant });
    },
    [],
  );

  const handleAddAssistant = useCallback(
    (parentId: string) => {
      handleAddChild(parentId, "seat", true);
    },
    [handleAddChild],
  );

  const persistAssistantFlag = useCallback(
    (nodeId: string, isAssistant: boolean) => {
      const apply = (current: ChartRow[]) =>
        applySetAssistant(current, nodeId, isAssistant);
      paint(apply);
      enqueuePersist({
        nodeIds: [nodeId],
        apply,
        persist: () =>
          setAssistant({
            treeId,
            nodeId,
            isAssistant,
            expectedRowVersion: expectedVersion(nodeId),
          }),
      });
    },
    [treeId, enqueuePersist, expectedVersion, paint],
  );

  const persistLeafGridColumns = useCallback(
    (nodeId: string, leafGridColumns: number) => {
      const apply = (current: ChartRow[]) =>
        applySetLeafGridColumns(current, nodeId, leafGridColumns);
      paint(apply);
      enqueuePersist({
        nodeIds: [nodeId],
        apply,
        persist: () =>
          setLeafGridColumns({
            treeId,
            nodeId,
            leafGridColumns,
            expectedRowVersion: expectedVersion(nodeId),
          }),
      });
    },
    [treeId, enqueuePersist, expectedVersion, paint],
  );

  const handlePlaceAssistant = useCallback(
    (nodeId: string) => {
      const current = rowsRef.current;
      const row = current.find((candidate) => candidate.id === nodeId);
      if (!row || !row.parentId) return;
      const check = canBeAssistant(
        current,
        indexFromRows(current),
        nodeId,
        row.parentId,
      );
      if (!check.ok) {
        toast.error(check.reason);
        return;
      }
      persistAssistantFlag(nodeId, true);
    },
    [persistAssistantFlag],
  );

  const handlePlaceInTeam = useCallback(
    (nodeId: string) => persistAssistantFlag(nodeId, false),
    [persistAssistantFlag],
  );

  const confirmAddChild = useCallback(
    (
      payload:
        | { name: string }
        | {
            employeeAuthId: string;
            jobTitle: string;
            reactivateWithJoiningDate?: string;
          }
        | { newPerson: EmployeeDraft; jobTitle: string },
    ) => {
      if (!addRequest) return;
      const nodeId = crypto.randomUUID();
      const newPerson = "newPerson" in payload ? payload.newPerson : null;
      const createdAuthId = newPerson ? crypto.randomUUID() : null;
      const spec =
        addRequest.kind === "header"
          ? {
              kind: "header" as const,
              nodeId,
              parentId: addRequest.parentId,
              name: (payload as { name: string }).name,
            }
          : (() => {
              const picked = pickerByAuthId.get(
                (payload as { employeeAuthId: string }).employeeAuthId,
              );
              const reactivationDate =
                !newPerson && "reactivateWithJoiningDate" in payload
                  ? (payload.reactivateWithJoiningDate ?? null)
                  : null;
              const member = newPerson
                ? seatMemberFromDraft(createdAuthId!, newPerson)
                : picked && reactivationDate
                  ? {
                      ...picked,
                      status: resolveEmployeeLifecycleStatus("joining", {
                        joiningDate: reactivationDate,
                        lastWorkingDate: null,
                      }),
                      joiningDate: reactivationDate,
                    }
                  : picked;
              if (!member) return null;
              if (newPerson) {
                setCatalogExtra((current) =>
                  current.some((item) => item.authId === member.authId)
                    ? current
                    : [...current, member],
                );
              }
              return {
                kind: "seat" as const,
                nodeId,
                parentId: addRequest.parentId,
                member,
                jobTitle: (payload as { jobTitle: string }).jobTitle,
                isAssistant: addRequest.asAssistant === true,
                reactivateWithJoiningDate: reactivationDate,
              };
            })();
      if (!spec) {
        toast.error("Unknown employee");
        return;
      }
      const apply = (current: ChartRow[]) => applyCreate(current, spec);
      paint(apply);
      setAddRequest(null);
      enqueuePersist({
        nodeIds: [nodeId],
        apply,
        persist: () =>
          spec.kind === "header"
            ? createNode({
                treeId,
                parentId: spec.parentId,
                kind: "header",
                name: spec.name,
                nodeId,
              })
            : createNode({
                treeId,
                parentId: spec.parentId,
                kind: "seat",
                ...(newPerson
                  ? { newPerson, newPersonAuthId: createdAuthId! }
                  : {
                      employeeAuthId: spec.member.authId,
                      ...(spec.reactivateWithJoiningDate
                        ? { reactivateWithJoiningDate: spec.reactivateWithJoiningDate }
                        : {}),
                    }),
                jobTitle: spec.jobTitle,
                nodeId,
                isAssistant: spec.isAssistant,
              }),
      });
    },
    [addRequest, treeId, enqueuePersist, paint, pickerByAuthId],
  );

  const [renameRequest, setRenameRequest] = useState<RenameRequest | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);

  const handleRename = useCallback((nodeId: string) => {
    const row = rowsRef.current.find((candidate) => candidate.id === nodeId);
    if (!row || row.kind !== "header") return;
    setRenameRequest({ nodeId, name: row.name ?? "" });
  }, []);

  const confirmRename = useCallback(
    (name: string) => {
      if (!renameRequest) return;
      const { nodeId } = renameRequest;
      const apply = (current: ChartRow[]) =>
        current.map((row) => (row.id === nodeId ? { ...row, name } : row));
      paint(apply);
      setRenameRequest(null);
      enqueuePersist({
        nodeIds: [nodeId],
        apply,
        persist: () =>
          renameHeader({
            treeId,
            nodeId,
            name,
            expectedRowVersion: expectedVersion(nodeId),
          }),
      });
    },
    [renameRequest, treeId, enqueuePersist, expectedVersion, paint],
  );

  const handleDelete = useCallback(
    (nodeId: string) => {
      const current = rowsRef.current;
      const row = current.find((candidate) => candidate.id === nodeId);
      if (!row || row.parentId === "") return;
      const grandparent = current.find((candidate) => candidate.id === row.parentId);
      setDeleteRequest({
        nodeId,
        kind: row.kind,
        label: rowLabel(row),
        childCount: current.filter((candidate) => candidate.parentId === nodeId).length,
        memberCount: row.members.length,
        grandparentLabel: grandparent ? rowLabel(grandparent) : "the parent",
      });
    },
    [rowLabel],
  );

  const confirmDelete = useCallback(() => {
    if (!deleteRequest) return;
    const { nodeId } = deleteRequest;
    const apply = (current: ChartRow[]) => applyDelete(current, nodeId);
    paint(apply);
    setDeleteRequest(null);
    enqueuePersist({
      nodeIds: [nodeId],
      apply,
      persist: () =>
        deleteNode({
          treeId,
          nodeId,
          expectedRowVersion: expectedVersion(nodeId),
        }),
    });
  }, [deleteRequest, treeId, enqueuePersist, expectedVersion, paint]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="relative min-h-0 flex-1">
        {treeKind === "sandbox" &&
          editable &&
          liveSeq != null &&
          forkedFromSeq != null && (
            <div className="pointer-events-none absolute left-4 top-4 z-20">
              <StaleBanner
                sandboxTreeId={treeId}
                forkedFromSeq={forkedFromSeq}
                liveSeq={liveSeq}
              />
            </div>
          )}
        <OrgChartView
          treeId={treeId}
          rows={visibleRows}
          focusId={focus?.id}
          focusGen={focus?.gen}
          preserveExpanded={focus?.preserveExpanded === true}
          motionId={motion?.id}
          motionGen={motion?.gen}
          onCardClick={openEmployee}
          editable={editable}
          savingIds={pendingNodeIds}
          onDrop={handleDrop}
          onAddChild={handleAddChild}
          onAddAssistant={handleAddAssistant}
          onPlaceAssistant={handlePlaceAssistant}
          onPlaceInTeam={handlePlaceInTeam}
          onRename={handleRename}
          onDelete={handleDelete}
          onSetLeafGridColumns={persistLeafGridColumns}
          cameraRef={cameraRef}
        />
        <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2">
          <div className="pointer-events-auto">
            <ChartSearch
              rows={visibleRows}
              includeJobTitle={treeKind === "sandbox"}
              onSelect={(nodeId) =>
                setFocus((prev) => ({
                  id: nodeId,
                  gen: (prev?.gen ?? 0) + 1,
                  preserveExpanded: true,
                }))
              }
            />
          </div>
        </div>
        {treeKind === "sandbox" && editable && (
          <div className="pointer-events-none absolute right-4 top-4 z-20 flex flex-col items-end gap-2">
            <div className="pointer-events-auto">
              <UnplacedBadge items={unplaced} />
            </div>
          </div>
        )}
        <div className="pointer-events-none absolute right-4 bottom-4 z-20">
          <div className="pointer-events-auto">
            <ChartControls
              onZoomIn={() => cameraRef.current?.zoomBy(1.25)}
              onZoomOut={() => cameraRef.current?.zoomBy(0.8)}
              onFit={() => cameraRef.current?.fitVisible()}
            />
          </div>
        </div>
        {canReadHistory && <SandboxHistory treeId={treeId} />}
        {addRequest && (
          <AddNodeDialog
            request={addRequest}
            employees={employees}
            busy={false}
            onConfirm={(payload) => void confirmAddChild(payload)}
            onClose={() => setAddRequest(null)}
          />
        )}
        {renameRequest && (
          <RenameTeamDialog
            request={renameRequest}
            busy={false}
            onConfirm={(name) => void confirmRename(name)}
            onClose={() => setRenameRequest(null)}
          />
        )}
        {deleteRequest && (
          <DeleteNodeDialog
            request={deleteRequest}
            busy={false}
            onConfirm={() => void confirmDelete()}
            onClose={() => setDeleteRequest(null)}
          />
        )}
        {peerOrChildRequest && (
          <PeerOrChildDialog
            request={peerOrChildRequest}
            busy={false}
            onConfirm={(intent) => confirmPeerOrChild(intent)}
            onClose={() => setPeerOrChildRequest(null)}
          />
        )}
        {moveRequest && (
          <MoveNodeDialog
            request={moveRequest}
            busy={false}
            onConfirm={(mode) => {
              const request = moveRequest;
              setMoveRequest(null);
              void executeMove(request.drop, mode);
            }}
            onClose={() => setMoveRequest(null)}
          />
        )}
      </div>
    </div>
  );
}
