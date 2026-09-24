export { runMerge } from "./engine";
export { indexRows, overridesFromRows, toQueryRows, nodeLabel } from "./tree";
export { validateGraph } from "./validate";
export { RESOLUTION_LABELS, ALLOWED, MAX_DEPTH, formatConflictSide } from "./types";
export type {
  AutoChange,
  Conflict,
  MergeCounts,
  MergeInput,
  MergeNode,
  MergeResult,
  MergeSnapshot,
  MergeTarget,
  Resolution,
  ResolutionChoice,
} from "./types";
