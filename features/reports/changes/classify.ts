/**
 * Mechanical change classification.
 */

import type { ChangeType, ManualChangeReason } from "./labels";
import { pathKey, type SeatSnapshot } from "./seat-snapshot";

export function classifyMechanical(
  before: SeatSnapshot | null,
  after: SeatSnapshot | null,
): ChangeType | null {
  if (!before && after) return "new_hire";
  if (before && !after) return "seat_removed";
  if (!before || !after) return null;

  const parentChanged = before.parentSeatId !== after.parentSeatId;
  const pathChanged = pathKey(before) !== pathKey(after);
  const peersChanged = before.memberAuthIds.join(",") !== after.memberAuthIds.join(",");
  const sortOnly =
    !parentChanged &&
    !pathChanged &&
    !peersChanged &&
    before.jobTitle === after.jobTitle &&
    before.sortOrder !== after.sortOrder;

  if (sortOnly) return null;

  if (parentChanged && !pathChanged) return "manager_change";
  if (!parentChanged && pathChanged) return "team_level_restructure_change";
  if (parentChanged && pathChanged) return "internal_movement";
  if (peersChanged && !parentChanged && !pathChanged) return "peer_change";

  return "org_chart_change";
}

export function resolveChangeType(args: {
  mechanical: ChangeType | null;
  isRestore: boolean;
  manualOverride: ManualChangeReason | null;
  publishOverride: ChangeType | null;
}): ChangeType | null {
  if (args.mechanical === null) return null;
  if (args.isRestore) return "snapshot_restore";
  if (args.manualOverride) return args.manualOverride;
  if (args.publishOverride) return args.publishOverride;
  return args.mechanical;
}

export interface MergeChangeTypeMeta {
  publishChangeType: ChangeType | null;
  changeReasonOverrides: Record<string, ManualChangeReason | null> | null;
}

export function resolveSeatChangeType(args: {
  nodeId: string;
  mechanical: ChangeType | null;
  hasRestore: boolean;
  merges: MergeChangeTypeMeta[];
}): ChangeType | null {
  const reasonMerge = [...args.merges]
    .reverse()
    .find(
      (merge) =>
        merge.changeReasonOverrides !== null &&
        Object.prototype.hasOwnProperty.call(merge.changeReasonOverrides, args.nodeId),
    );
  const merge = reasonMerge ?? args.merges.at(-1) ?? null;
  return resolveChangeType({
    mechanical: args.mechanical,
    isRestore: args.hasRestore && !merge,
    manualOverride: reasonMerge?.changeReasonOverrides?.[args.nodeId] ?? null,
    publishOverride: merge?.publishChangeType ?? null,
  });
}
