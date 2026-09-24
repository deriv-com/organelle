import { describe, expect, it } from "vitest";

import { formatAuditEvent, operationActionLabel, operationLabel } from "./format";
import type { AuditEvent } from "./format";

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: "1",
    createdAt: "2026-08-20T06:32:00.000Z",
    op: "move_node",
    actorAuthId: "550e8400-e29b-41d4-a716-446655440001",
    actorName: "Admin User",
    actorEmail: "admin@example.com",
    actorAvatarUrl: "https://example.com/admin.png",
    targetEmployeeAuthId: "550e8400-e29b-41d4-a716-446655440002",
    targetEmployeeName: "Amy Pond",
    targetEmployeeEmail: "amy@example.com",
    treeId: "550e8400-e29b-41d4-a716-446655440003",
    nodeId: "550e8400-e29b-41d4-a716-446655440004",
    nodeName: null,
    nodeJobTitle: "Engineer",
    treeKind: "published",
    treeName: null,
    versionSeq: 12,
    mergeId: null,
    commandId: null,
    commandKind: null,
    undoesCommandId: null,
    before: null,
    after: null,
    ...overrides,
  };
}

describe("formatAuditEvent", () => {
  it("formats structural events with target context", () => {
    const display = formatAuditEvent(event());
    expect(display.summary).toBe("Moved employee: Amy Pond");
    expect(display.scopeDetail).toBe("v12");
    expect(display.preview.slice(0, 2)).toEqual([
      { label: "Target", value: "Amy Pond" },
      { label: "Chart context", value: "Published v12" },
    ]);
  });

  it("formats employee updates with changed field labels", () => {
    const display = formatAuditEvent(
      event({
        op: "update_employee",
        targetEmployeeName: "Casey Fixture",
        before: { office_location: "Malaysia", status: "serving_notice" },
        after: { office_location: "Dubai", status: "active" },
      }),
    );
    expect(display.opLabel).toBe("Update");
    expect(display.summary).toBe(
      "Updated employee: Casey Fixture (Office location, Status)",
    );
  });

  it("formats role changes with human role labels", () => {
    const display = formatAuditEvent(
      event({
        op: "grant_role",
        targetEmployeeName: "HR Person",
        before: null,
        after: { role: "publisher" },
      }),
    );
    expect(display.opLabel).toBe("Role");
    expect(display.summary).toBe("Granted role: HR Person as Publisher");
  });

  it("builds full metadata with ids and before/after payloads", () => {
    const display = formatAuditEvent(
      event({
        mergeId: "550e8400-e29b-41d4-a716-446655440005",
        before: { parent_node_id: "old" },
        after: { parent_node_id: "new" },
      }),
    );
    expect(display.metadata).toMatchObject({
      audit_id: "1",
      operation: "move_node",
      operation_label: "Moved employee",
      performed_by: "Admin User <admin@example.com>",
      target: "Amy Pond <amy@example.com>",
      chart_context: "Published v12",
      node_label: "Engineer",
      merge_id: "550e8400-e29b-41d4-a716-446655440005",
      before: { parent_node_id: "old" },
      after: { parent_node_id: "new" },
    });
    expect(display.metadata).not.toHaveProperty("tree_id");
    expect(display.metadata).not.toHaveProperty("scope");
    expect(display.metadata).not.toHaveProperty("user_auth_id");
    expect(display.metadata).not.toHaveProperty("employee_auth_id");
  });

  it("formats merge and restore events", () => {
    expect(
      formatAuditEvent(
        event({
          op: "merge_sandbox",
          targetEmployeeName: null,
          targetEmployeeEmail: null,
          nodeName: null,
          nodeJobTitle: null,
          after: { resulting_tree_id: "t" },
        }),
      ).summary,
    ).toBe("Merged sandbox: Unknown target");
    expect(
      formatAuditEvent(
        event({
          op: "restore_version",
          targetEmployeeName: null,
          targetEmployeeEmail: null,
          nodeName: null,
          nodeJobTitle: null,
          before: { from_seq: 3 },
        }),
      ).summary,
    ).toBe("Restored version: Unknown target");
  });

  it("handles unknown actors and operations", () => {
    const display = formatAuditEvent(
      event({
        op: "custom_future_op",
        actorName: null,
        actorEmail: null,
        targetEmployeeName: null,
        nodeName: null,
        nodeJobTitle: null,
      }),
    );
    expect(display.actorLabel).toBe("Unknown actor");
    expect(display.opLabel).toBe("Custom Future Op");
    expect(display.summary).toBe("Custom Future Op: Unknown target");
  });

  it("formats retained events whose tree was deleted", () => {
    const display = formatAuditEvent(
      event({ treeId: null, treeKind: null, treeName: null, versionSeq: null }),
    );
    expect(display.scopeLabel).toBe("Deleted tree");
    expect(display.scopeDetail).toBeNull();
  });
});

describe("operation labels", () => {
  it("provides concise labels for filter options", () => {
    expect(operationLabel("delete_header")).toBe("Remove");
    expect(operationActionLabel("rename_seat")).toBe("Renamed position");
  });
});
