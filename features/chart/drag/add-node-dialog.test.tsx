/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddNodeDialog } from "./add-node-dialog";

beforeEach(() => vi.stubGlobal("React", React));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AddNodeDialog", () => {
  it("explains why a new person cannot be created", () => {
    const onConfirm = vi.fn();
    render(
      <AddNodeDialog
        request={{ parentId: "manager-1", parentLabel: "Sam Rivera", kind: "seat" }}
        employees={[]}
        busy={false}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create new person" }));
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "Doe" },
    });
    fireEvent.change(screen.getByLabelText("Seat job title"), {
      target: { value: "Senior ML Engineer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create position" }));

    expect(screen.getByRole("alert").textContent).toBe("Enter a valid email");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("submits a new person when the required fields are valid", () => {
    const onConfirm = vi.fn();
    render(
      <AddNodeDialog
        request={{ parentId: "manager-1", parentLabel: "Sam Rivera", kind: "seat" }}
        employees={[]}
        busy={false}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create new person" }));
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "John Doe" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "john.doe@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Seat job title"), {
      target: { value: "Senior ML Engineer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create position" }));

    expect(onConfirm).toHaveBeenCalledWith({
      newPerson: expect.objectContaining({
        fullName: "John Doe",
        email: "john.doe@example.com",
      }),
      jobTitle: "Senior ML Engineer",
    });
  });
});
