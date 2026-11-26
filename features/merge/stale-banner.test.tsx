/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./actions", () => ({ reForkSandbox: vi.fn() }));
import { StaleBanner } from "./stale-banner";
afterEach(cleanup);
it("offers synchronization without offering re-fork to shared editors", () => {
  const view = render(
    <StaleBanner
      sandboxTreeId="example"
      forkedFromSeq={1}
      liveSeq={2}
      canRefork={false}
    />,
  );
  expect(view.getByRole("link", { name: "Sync from live" }).getAttribute("href")).toBe(
    "/sandbox/example/sync",
  );
  expect(view.queryByRole("button", { name: "Re-fork" })).toBeNull();
});
it("offers re-fork to the owner", () => {
  const view = render(
    <StaleBanner sandboxTreeId="example" forkedFromSeq={1} liveSeq={2} canRefork />,
  );
  expect(view.getByRole("button", { name: "Re-fork" })).toBeTruthy();
});
