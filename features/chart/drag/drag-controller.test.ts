/** @vitest-environment jsdom */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { indexFromRows, type ChartRow, type SeatMember } from "../chart-row";
import { attachDragController } from "./drag-controller";

beforeAll(() => {
  if (typeof PointerEvent === "undefined") {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    }
    Object.defineProperty(globalThis, "PointerEvent", { value: PointerEventPolyfill });
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.hasPointerCapture = () => false;
  }
});

function member(authId: string): SeatMember {
  return {
    authId,
    displayName: authId,
    displayTitle: "",
    email: "",
    avatarUrl: null,
    officeLocation: "",
    status: "active",
    joiningDate: null,
    isHost: true,
    sourceName: authId,
    sourceTitle: "",
    sourceAvatarUrl: null,
    overrideName: null,
    overrideTitle: null,
    overrideAvatarUrl: null,
  };
}

function row(
  id: string,
  parentId: string | "",
  kind: "header" | "seat",
  members: string[] = [],
): ChartRow {
  return {
    id,
    parentId,
    kind,
    sortOrder: 0,
    rowVersion: 1,
    members: members.map(member),
  };
}

describe("attachDragController", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("removes the ghost on pointercancel instead of leaving it stuck", () => {
    vi.useFakeTimers();
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("b", "root", "seat", ["m1"]),
    ];
    const index = indexFromRows(rows);
    const container = document.createElement("div");
    container.innerHTML = `<div data-node-id="b"><div>Mun</div></div>`;
    document.body.appendChild(container);
    const detach = attachDragController({
      container,
      getRows: () => rows,
      getIndex: () => index,
      onExpandNode: () => {},
      onDrop: () => {},
    });

    const card = container.querySelector("[data-node-id]")!;
    card.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        clientX: 10,
        clientY: 10,
        pointerId: 1,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 20,
        clientY: 20,
        pointerId: 1,
        bubbles: true,
      }),
    );
    expect(document.querySelector(".dz-ghost")).not.toBeNull();
    expect(document.querySelector(".dz-chip")).not.toBeNull();

    document.dispatchEvent(
      new PointerEvent("pointercancel", { pointerId: 1, bubbles: true }),
    );
    vi.advanceTimersByTime(350);
    expect(document.querySelector(".dz-ghost")).toBeNull();
    expect(document.querySelector(".dz-chip")).toBeNull();
    detach();
  });

  it("prevents native HTML dragstart on the chart container", () => {
    const rows = [row("root", "", "seat", ["publisher"])];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const detach = attachDragController({
      container,
      getRows: () => rows,
      getIndex: () => indexFromRows(rows),
      onExpandNode: () => {},
      onDrop: () => {},
    });
    const event = new Event("dragstart", { bubbles: true, cancelable: true });
    container.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    detach();
  });

  it("stops the leftover click after a drag so the drawer does not open", () => {
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("b", "root", "seat", ["m1"]),
    ];
    const container = document.createElement("div");
    container.innerHTML = `<div data-node-id="b"><div>Mun</div></div>`;
    document.body.appendChild(container);
    const detach = attachDragController({
      container,
      getRows: () => rows,
      getIndex: () => indexFromRows(rows),
      onExpandNode: () => {},
      onDrop: () => {},
    });
    const card = container.querySelector("[data-node-id]")!;
    const bubble = vi.fn();
    card.addEventListener("click", bubble);

    card.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        clientX: 10,
        clientY: 10,
        pointerId: 1,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 20,
        clientY: 20,
        pointerId: 1,
        bubbles: true,
      }),
    );
    const afterDrag = new MouseEvent("click", { bubbles: true, cancelable: true });
    card.dispatchEvent(afterDrag);
    expect(afterDrag.defaultPrevented).toBe(true);
    expect(bubble).not.toHaveBeenCalled();

    const stillClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    card.dispatchEvent(stillClick);
    expect(stillClick.defaultPrevented).toBe(false);
    expect(bubble).toHaveBeenCalledTimes(1);
    detach();
  });

  it("does not stop a still click that never crossed the drag threshold", () => {
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("b", "root", "seat", ["m1"]),
    ];
    const container = document.createElement("div");
    container.innerHTML = `<div data-node-id="b"><div>Mun</div></div>`;
    document.body.appendChild(container);
    const detach = attachDragController({
      container,
      getRows: () => rows,
      getIndex: () => indexFromRows(rows),
      onExpandNode: () => {},
      onDrop: () => {},
    });
    const card = container.querySelector("[data-node-id]")!;
    const bubble = vi.fn();
    card.addEventListener("click", bubble);

    card.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        clientX: 10,
        clientY: 10,
        pointerId: 1,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 11,
        clientY: 10,
        pointerId: 1,
        bubbles: true,
      }),
    );
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    card.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(bubble).toHaveBeenCalledTimes(1);
    detach();
  });
});

describe("edge auto-pan", () => {
  // jsdom has no layout: give the container a real viewport rect and step
  // requestAnimationFrame manually so pan deltas are deterministic.
  const CONTAINER_RECT = {
    left: 0,
    top: 0,
    right: 1000,
    bottom: 600,
    width: 1000,
    height: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;

  let now = 0;
  let rafQueue: FrameRequestCallback[] = [];
  let rafHandle = 0;

  const stepFrame = (advanceMs: number) => {
    now += advanceMs;
    const callbacks = rafQueue;
    rafQueue = [];
    for (const cb of callbacks) cb(now);
  };

  const setup = (panBy: (dx: number, dy: number) => void) => {
    const rows = [
      row("root", "", "seat", ["publisher"]),
      row("b", "root", "seat", ["m1"]),
    ];
    const container = document.createElement("div");
    container.innerHTML = `<div data-node-id="b"><div>Mun</div></div>`;
    container.getBoundingClientRect = () => CONTAINER_RECT;
    document.body.appendChild(container);
    const detach = attachDragController({
      container,
      getRows: () => rows,
      getIndex: () => indexFromRows(rows),
      onExpandNode: () => {},
      onDrop: () => {},
      panBy,
    });
    const card = container.querySelector("[data-node-id]")!;
    card.dispatchEvent(
      new PointerEvent("pointerdown", {
        button: 0,
        clientX: 400,
        clientY: 300,
        pointerId: 1,
        bubbles: true,
      }),
    );
    // Cross the 4px drag threshold, staying inside the dead zone.
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 408,
        clientY: 300,
        pointerId: 1,
        bubbles: true,
      }),
    );
    expect(document.querySelector(".dz-ghost")).not.toBeNull();
    return { detach };
  };

  beforeAll(() => {
    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return ++rafHandle;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      rafQueue = [];
    });
  });

  afterEach(() => {
    rafQueue = [];
    document.body.replaceChildren();
  });

  it("pans continuously while the pointer is held near the right edge", () => {
    const panBy = vi.fn();
    const { detach } = setup(panBy);

    // Hold the pointer 10px from the right edge — near-max speed.
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 990,
        clientY: 300,
        pointerId: 1,
        bubbles: true,
      }),
    );
    expect(panBy).not.toHaveBeenCalled(); // primed frame, no pan yet

    // No further pointer events: the rAF loop keeps the camera moving.
    stepFrame(16);
    stepFrame(16);
    expect(panBy).toHaveBeenCalledTimes(2);
    for (const [dx, dy] of panBy.mock.calls) {
      expect(dx).toBeLessThan(0); // content slides left, revealing the right side
      expect(dx).toBeGreaterThan(-15); // capped by MAX_PX_PER_MS per frame
      expect(dy).toBe(0); // vertically centred
    }
    detach();
  });

  it("stops panning when the pointer returns to the interior", () => {
    const panBy = vi.fn();
    const { detach } = setup(panBy);

    document.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 990,
        clientY: 300,
        pointerId: 1,
        bubbles: true,
      }),
    );
    stepFrame(16);
    expect(panBy).toHaveBeenCalledTimes(1);

    document.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 500,
        clientY: 300,
        pointerId: 1,
        bubbles: true,
      }),
    );
    stepFrame(16);
    stepFrame(16);
    expect(panBy).toHaveBeenCalledTimes(1);
    detach();
  });

  it("stops the pan loop after the drop", () => {
    const panBy = vi.fn();
    const { detach } = setup(panBy);

    document.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 990,
        clientY: 300,
        pointerId: 1,
        bubbles: true,
      }),
    );
    stepFrame(16);
    expect(panBy).toHaveBeenCalledTimes(1);

    document.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 1, bubbles: true }),
    );
    expect(rafQueue).toHaveLength(0);
    stepFrame(16);
    expect(panBy).toHaveBeenCalledTimes(1);
    detach();
  });
});
