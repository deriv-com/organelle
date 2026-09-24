import type { TransactionSql } from "postgres";
import { describe, expect, it, vi } from "vitest";

import {
  isResignedEmptySeat,
  pruneResignedEmptySeatsTx,
} from "./prune-resigned-seats.server";

describe("isResignedEmptySeat", () => {
  it("prunes non-root seats whose assignees are all resigned", () => {
    expect(
      isResignedEmptySeat({ parentId: "boss", assignmentStatuses: ["resigned"] }),
    ).toBe(true);
  });

  it("keeps the root, vacant titles, inactive-only, and mixed seats", () => {
    expect(
      isResignedEmptySeat({ parentId: "", assignmentStatuses: ["resigned"] }),
    ).toBe(false);
    expect(isResignedEmptySeat({ parentId: "boss", assignmentStatuses: [] })).toBe(
      false,
    );
    expect(
      isResignedEmptySeat({ parentId: "boss", assignmentStatuses: ["inactive"] }),
    ).toBe(false);
    expect(
      isResignedEmptySeat({
        parentId: "boss",
        assignmentStatuses: ["inactive", "resigned"],
      }),
    ).toBe(false);
    expect(
      isResignedEmptySeat({ parentId: "boss", assignmentStatuses: ["active"] }),
    ).toBe(false);
  });
});

it("prunes a large candidate set after one full-tree scan", async () => {
  const candidates = Array.from({ length: 500 }, (_, index) => ({
    node_id: `node-${index}`,
    parent_node_id: "parent",
    sort_order: index,
    job_title: null,
    host_auth_id: null,
  }));
  let candidateLoads = 0;
  const query = Object.assign(
    vi.fn(async (strings: TemplateStringsArray) => {
      const statement = strings.join("?");
      if (statement.includes("select n.node_id")) {
        candidateLoads += 1;
        return candidateLoads === 1 ? candidates : [];
      }
      return [];
    }),
    { json: (value: unknown) => value },
  ) as unknown as TransactionSql;

  await expect(pruneResignedEmptySeatsTx(query, "tree", "actor")).resolves.toBe(500);
  expect(candidateLoads).toBe(1);
});
