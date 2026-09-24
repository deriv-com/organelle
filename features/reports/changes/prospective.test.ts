import { describe, expect, it } from "vitest";

import { toQueryRows } from "@/features/merge/tree";
import type { MergeNode } from "@/features/merge/types";

import {
  canOverrideChangeReason,
  changeTypeLabel,
  MANUAL_CHANGE_REASON_VALUES,
  parseManualChangeReason,
} from "./labels";
import { buildProspectiveChangeReasons } from "./prospective";

function node(
  id: string,
  parentId: string,
  kind: "header" | "seat",
  label: string,
): MergeNode {
  return {
    id,
    parentId,
    kind,
    sortOrder: 0,
    rowVersion: 1,
    name: kind === "header" ? label : null,
    jobTitle: kind === "seat" ? label : null,
    positionLevel: null,
    isAssistant: false,
    leafGridColumns: 3,
    assignments:
      kind === "seat"
        ? [
            {
              employeeAuthId: `${id}-employee`,
              isHost: true,
              isPrimary: true,
              displayName: label,
              displayTitle: label,
              email: `${id}@example.com`,
              avatarUrl: null,
              officeLocation: "",
              status: "active",
              joiningDate: null,
            },
          ]
        : [],
  };
}

describe("manual change reasons", () => {
  it("exposes only the five approved values with exact labels", () => {
    expect(MANUAL_CHANGE_REASON_VALUES.map(changeTypeLabel)).toEqual([
      "Promotion Change",
      "Demotion",
      "Job Title Change",
      "Level Change",
      "Position Level Change",
    ]);
    expect(parseManualChangeReason("manager_change")).toBeNull();
    expect(parseManualChangeReason("promotion_change")).toBe("promotion_change");
  });

  it("allows overrides only for automatic structural reasons", () => {
    expect(canOverrideChangeReason("manager_change")).toBe(true);
    expect(canOverrideChangeReason("team_level_restructure_change")).toBe(true);
    expect(canOverrideChangeReason("internal_movement")).toBe(true);
    expect(canOverrideChangeReason("new_hire")).toBe(false);
  });

  it("uses the source label for restructure changes", () => {
    expect(changeTypeLabel("team_level_restructure_change")).toBe(
      "Team Level / Restructure Change",
    );
  });
});

describe("buildProspectiveChangeReasons", () => {
  it("expands a moved header into affected descendant seat reasons", () => {
    const before = [
      node("root", "", "seat", "Publisher"),
      node("engineering", "root", "header", "Engineering"),
      node("sales", "root", "header", "Sales"),
      node("manager", "engineering", "seat", "Manager"),
      node("employee", "manager", "seat", "Employee"),
    ];
    const after = before.map((item) =>
      item.id === "engineering" ? { ...item, parentId: "sales" } : item,
    );

    const reasons = buildProspectiveChangeReasons(
      toQueryRows(before),
      toQueryRows(after),
    );

    expect(reasons.map((reason) => [reason.nodeId, reason.automaticType])).toEqual([
      ["employee", "team_level_restructure_change"],
      ["manager", "team_level_restructure_change"],
    ]);
  });
});
