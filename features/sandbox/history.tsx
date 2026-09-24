"use client";

/**
 * Sandbox change history Sheet: day-grouped blocks with compact change details.
 */

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { PersonChip, TeamChip } from "@/components/entity-chips";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { closeSandboxHistorySheet } from "@/features/chart/view-on-chart";
import { indexFromRows } from "@/features/chart/chart-row";
import { cn } from "@/lib/utils";
import { useOrgData } from "@/store/org-data";
import { getSandboxHistory, type HistoryRow } from "./actions";
import {
  groupByDay,
  historyBlocks,
  type Chip,
  type HistoryBlock,
  type HistoryDetail,
} from "./history-block";

const DeptColors = createContext<Map<string, string>>(new Map());

function actionHeader(block: HistoryBlock): { label: string; className: string } {
  if (block.kind === "Undid") {
    return { label: "Undo", className: "text-violet-600" };
  }
  if (block.kind === "Redid") {
    return { label: "Redo", className: "text-violet-600" };
  }

  switch (block.op) {
    case "move_node":
    case "reorder_node":
      return { label: "Move", className: "text-blue-600" };
    case "create_header":
    case "create_seat":
    case "fork_sandbox":
      return { label: "Create", className: "text-emerald-600" };
    case "rename_header":
    case "rename_seat":
      return { label: "Rename", className: "text-indigo-600" };
    case "delete_header":
    case "delete_seat":
      return { label: "Remove", className: "text-rose-600" };
    case "assign_employee":
    case "unassign_employee":
    case "set_peer_host":
      return { label: "Peer", className: "text-cyan-600" };
    case "set_assistant":
      return { label: "Placement", className: "text-purple-600" };
    case "set_leaf_grid_columns":
      return { label: "Layout", className: "text-slate-600" };
    case "set_primary_seat":
      return { label: "Primary", className: "text-teal-600" };
    default:
      return { label: "Update", className: "text-amber-600" };
  }
}

function HistoryActionHeader({ block }: { block: HistoryBlock }) {
  const header = actionHeader(block);
  return (
    <span
      className={cn(
        "text-[10px] font-semibold uppercase leading-none tracking-wide",
        header.className,
      )}
    >
      {header.label}
    </span>
  );
}

function HistoryEntity({ chip }: { chip: Chip }) {
  const colors = useContext(DeptColors);
  if (chip.type === "person") {
    return <PersonChip name={chip.name} avatarUrl={chip.avatarUrl} />;
  }
  return <TeamChip name={chip.name} dept={chip.dept} colors={colors} />;
}

function targetLabel(block: HistoryBlock): string {
  switch (block.op) {
    case "move_node":
      return block.subject[0]?.type === "person" ? "employee" : "item";
    case "reorder_node":
      return "item";
    case "fork_sandbox":
      return "sandbox";
    case "create_header":
    case "rename_header":
    case "delete_header":
      return "team";
    case "create_seat":
    case "delete_seat":
    case "rename_seat":
      return "position";
    case "assign_employee":
    case "unassign_employee":
      return "peer";
    case "set_peer_host":
      return "primary host";
    case "set_assistant":
      return "placement";
    case "set_leaf_grid_columns":
      return "layout";
    case "set_override":
      return "details";
    case "clear_override":
      return "override";
    case "update_employee":
      return "employee";
    case "set_primary_seat":
      return "primary seat";
    default:
      return "item";
  }
}

function reversibleActionPhrase(block: HistoryBlock): string {
  switch (block.op) {
    case "fork_sandbox":
      return "sandbox creation from";
    case "move_node":
      return block.subject[0]?.type === "person"
        ? "move for employee"
        : "move for item";
    case "reorder_node":
      return "item reorder for";
    case "create_header":
      return "team creation for";
    case "create_seat":
      return "position creation for";
    case "assign_employee":
      return "peer addition for";
    case "unassign_employee":
      return "peer removal for";
    case "set_peer_host":
      return "primary host change for";
    case "rename_header":
      return "team rename for";
    case "delete_header":
      return "team removal for";
    case "delete_seat":
      return "position removal for";
    case "set_leaf_grid_columns":
      return "layout change for";
    case "update_employee":
      return "update for employee";
    default:
      return `${block.action.toLowerCase()} for`;
  }
}

function sentenceTitlePrefix(block: HistoryBlock): string {
  if (block.kind === "Undid") {
    return `Undid ${reversibleActionPhrase(block)}`;
  }
  if (block.kind === "Redid") {
    return `Redid ${reversibleActionPhrase(block)}`;
  }

  switch (block.op) {
    case "fork_sandbox":
      return "Created sandbox from";
    case "move_node":
      return block.subject[0]?.type === "person" ? "Moved employee" : "Moved item";
    case "reorder_node":
      return "Reordered item";
    case "create_header":
      return "Created team";
    case "create_seat":
      return "Created position";
    case "assign_employee":
      return "Added peer";
    case "unassign_employee":
      return "Removed peer";
    case "set_peer_host":
      return "Changed primary host";
    case "rename_header":
      return "Renamed team";
    case "delete_header":
      return "Removed team";
    case "delete_seat":
      return "Removed position";
    case "set_leaf_grid_columns":
      return "Changed layout for";
    case "update_employee":
      return "Updated employee";
    default:
      return block.action;
  }
}

export function HistoryTitle({ block }: { block: HistoryBlock }) {
  const tags = titleTags(block);
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 text-sm leading-6 text-gray-700">
      <span className="shrink-0 font-normal text-gray-600">
        {sentenceTitlePrefix(block)}
      </span>
      {block.subject.length > 0 ? (
        block.subject.map((chip, i) => <HistoryEntity key={i} chip={chip} />)
      ) : (
        <span className="font-semibold text-gray-900">{targetLabel(block)}</span>
      )}
      {tags.length > 0 ? <FieldTags tags={tags} /> : null}
    </div>
  );
}

function titleTags(block: HistoryBlock): string[] {
  if (block.op !== "update_employee") return [];
  const tags = block.details.flatMap((item) =>
    item.tags && item.tags.length > 0 ? item.tags : item.label ? [item.label] : [],
  );
  return [...new Set(tags)];
}

function FieldTags({ tags }: { tags: string[] }) {
  const visible = tags.slice(0, 2);
  const overflow = tags.length - visible.length;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
      {visible.map((tag) => (
        <span
          key={tag}
          className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium leading-none text-gray-600"
        >
          {tag}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium leading-none text-gray-600">
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}

function DetailValue({ chips, text }: { chips: Chip[]; text?: string }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-2 text-[13px] text-gray-600">
      {chips.map((chip, i) => (
        <HistoryEntity key={i} chip={chip} />
      ))}
      {text ? <span className="min-w-0 break-words">{text}</span> : null}
    </span>
  );
}

function DetailRow({
  item,
  showLabel = true,
}: {
  item: HistoryDetail;
  showLabel?: boolean;
}) {
  if (item.tags && item.tags.length > 0) {
    return null;
  }
  return (
    <div className="inline-flex min-w-0 flex-wrap items-center gap-2 text-[13px] leading-6 text-gray-600">
      {showLabel && item.label ? (
        <span className="font-medium">{item.label}:</span>
      ) : null}
      <DetailValue chips={item.chips} text={item.text} />
      {item.afterChips ? (
        <>
          <span aria-hidden="true" className="shrink-0 text-gray-400">
            →
          </span>
          <DetailValue chips={item.afterChips} />
        </>
      ) : null}
    </div>
  );
}

function PairedDetailPath({ from, to }: { from: HistoryDetail; to: HistoryDetail }) {
  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-2.5 text-[13px] leading-6 text-gray-600">
      <DetailValue chips={from.chips} text={from.text} />
      <span aria-hidden="true" className="shrink-0 text-gray-400">
        →
      </span>
      <DetailValue chips={to.chips} text={to.text} />
    </div>
  );
}

export function HistoryDetails({ block }: { block: HistoryBlock }) {
  const from = block.details.find((item) => item.label === "From");
  const to = block.details.find((item) => item.label === "To");
  const pairedLabels = from && to ? new Set(["From", "To"]) : new Set<string>();
  const rest = block.details.filter((item) => !pairedLabels.has(item.label));

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {from && to ? <PairedDetailPath from={from} to={to} /> : null}
      {rest.map((item, index) => (
        <DetailRow
          key={`${item.label}-${item.text ?? ""}-${index}`}
          item={item}
          showLabel={block.op !== "update_employee"}
        />
      ))}
    </div>
  );
}

function historyTime(createdAt: string): string {
  return new Date(createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function HistoryMeta({ block }: { block: HistoryBlock }) {
  const actor = block.actorName?.trim() || "Unknown";
  return (
    <span className="mt-2 self-start text-xs text-gray-400 tabular-nums">
      by {actor} • {historyTime(block.createdAt)}
    </span>
  );
}

export function SandboxHistory({ treeId }: { treeId: string }) {
  const open = useOrgData((state) => state.historyOpen);
  const setOpen = useOrgData((state) => state.setHistoryOpen);
  const chartRows = useOrgData((state) => state.chartRows);
  const requestFocus = useOrgData((state) => state.requestFocus);
  const [entries, setEntries] = useState<HistoryRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => () => closeSandboxHistorySheet(), []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setFailed(false);
    setEntries(null);
    getSandboxHistory(treeId)
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, treeId]);

  const groups = useMemo(() => {
    if (!entries) return [];
    return groupByDay(historyBlocks(entries, chartRows));
  }, [entries, chartRows]);
  const deptColors = useMemo(
    () =>
      chartRows.length === 0
        ? new Map<string, string>()
        : indexFromRows(chartRows).deptColorById,
    [chartRows],
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border/70 p-5">
          <SheetTitle className="text-base font-semibold">Sandbox changes</SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            Every change in this sandbox, newest first.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          <DeptColors.Provider value={deptColors}>
            {failed ? (
              <p className="text-sm text-muted-foreground">Couldn’t load history.</p>
            ) : entries === null ? (
              <p className="m-auto text-sm text-muted-foreground">Loading…</p>
            ) : entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No changes yet.</p>
            ) : (
              <div className="flex flex-col gap-6">
                {groups.map((group) => (
                  <section key={group.day} className="flex flex-col gap-2.5">
                    <div className="flex items-center justify-between rounded-lg bg-muted px-3.5 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <span>{group.day}</span>
                      <span className="text-[11px] font-medium lowercase">
                        {group.items.length}{" "}
                        {group.items.length === 1 ? "change" : "changes"}
                      </span>
                    </div>

                    <ul className="divide-y divide-black/[0.06] overflow-hidden rounded-xl border border-border/70 bg-background shadow-xs">
                      {group.items.map((block) => (
                        <li key={block.id}>
                          <button
                            type="button"
                            className="group flex w-full !cursor-default flex-col gap-2 px-3.5 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-hidden"
                            onClick={() => {
                              if (block.focusNodeId) requestFocus(block.focusNodeId);
                            }}
                          >
                            <div className="flex min-w-0 flex-1 flex-col gap-0">
                              <HistoryActionHeader block={block} />
                              <div className="mt-1.5 flex min-w-0 items-center">
                                <HistoryTitle block={block} />
                              </div>
                              {block.details.length > 0 ? (
                                <HistoryDetails block={block} />
                              ) : null}
                              <HistoryMeta block={block} />
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </DeptColors.Provider>
        </div>
      </SheetContent>
    </Sheet>
  );
}
