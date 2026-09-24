/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmployeeEditFields, sectionForEmployeeField } from "./employee-edit-form";
import type { EmployeeDraft } from "./employee-fields";

const draft: EmployeeDraft = {
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  legalFullName: "",
  employeeId: "",
  employmentRecord: "",
  jobTitle: "Engineer",
  positionLevel: "",
  avatarUrl: "",
  officeCountry: "",
  officeLocation: "London",
  hiringCompany: "",
  status: "active",
  joiningDate: "",
  hiredAt: "",
  resignationDate: "",
  lastWorkingDate: "",
};

beforeEach(() => {
  vi.stubGlobal("React", React);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("sectionForEmployeeField", () => {
  it("maps employment dates to employment", () => {
    expect(sectionForEmployeeField("joiningDate")).toBe("employment");
    expect(sectionForEmployeeField("lastWorkingDate")).toBe("employment");
  });

  it("maps profile fields to profile", () => {
    expect(sectionForEmployeeField("fullName")).toBe("profile");
    expect(sectionForEmployeeField("email")).toBe("profile");
  });

  it("maps office location to workplace", () => {
    expect(sectionForEmployeeField("officeLocation")).toBe("workplace");
  });
});

describe("EmployeeEditFields", () => {
  it("disables the email input when emailLocked is true", () => {
    render(
      React.createElement(EmployeeEditFields, {
        draft,
        errors: {},
        disabled: false,
        emailLocked: true,
        onChange: () => {},
        idPrefix: "test",
      }),
    );

    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(email.disabled).toBe(true);
  });

  it("requires and displays last working date for serving notice", async () => {
    render(
      React.createElement(EmployeeEditFields, {
        draft: { ...draft, status: "serving_notice" },
        errors: {
          lastWorkingDate: "Last working date is required for serving notice",
        },
        disabled: false,
        emailLocked: false,
        onChange: () => {},
        idPrefix: "test",
      }),
    );

    const lastWorkingDate = await screen.findByLabelText("Last working date");
    expect((lastWorkingDate as HTMLInputElement).required).toBe(true);
    expect(
      screen.getByText("Last working date is required for serving notice"),
    ).toBeTruthy();
  });
});
