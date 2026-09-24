"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUSES,
  type EmployeeDraft,
  type EmployeeFieldKey,
  type FieldErrors,
} from "./employee-fields";

export type EditSectionId = "profile" | "employment" | "workplace";

const FIELD_SECTION: Partial<Record<EmployeeFieldKey, EditSectionId>> = {
  fullName: "profile",
  email: "profile",
  avatarUrl: "profile",
  status: "employment",
  employeeId: "employment",
  employmentRecord: "employment",
  jobTitle: "employment",
  joiningDate: "employment",
  lastWorkingDate: "employment",
  hiredAt: "employment",
  resignationDate: "employment",
  officeLocation: "workplace",
  officeCountry: "workplace",
  hiringCompany: "workplace",
  legalFullName: "profile",
  positionLevel: "employment",
};

export function sectionForEmployeeField(field: EmployeeFieldKey): EditSectionId | null {
  return FIELD_SECTION[field] ?? null;
}

function firstErrorSection(errors: FieldErrors): EditSectionId | null {
  for (const key of Object.keys(errors) as EmployeeFieldKey[]) {
    const section = sectionForEmployeeField(key);
    if (section) return section;
  }
  return null;
}

const DEFAULT_OPEN_SECTIONS: Record<EditSectionId, boolean> = {
  profile: true,
  employment: false,
  workplace: false,
};

export function FormSection({
  title,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} asChild>
      <section className="flex flex-col gap-2.5">
        <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg bg-muted px-3.5 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground outline-none transition-colors hover:bg-muted/80 focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <span>{title}</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="rounded-xl border border-border/70 bg-background p-3.5 shadow-xs">
            {children}
          </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

function EditSection({
  title,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <FormSection title={title} open={open} onOpenChange={onOpenChange}>
      <FieldGroup className="gap-4">{children}</FieldGroup>
    </FormSection>
  );
}

export function EmployeeEditFields({
  draft,
  errors,
  disabled,
  emailLocked,
  onChange,
  idPrefix,
  workplaceExtra,
}: {
  draft: EmployeeDraft;
  errors: FieldErrors;
  disabled: boolean;
  emailLocked?: boolean;
  onChange: (next: EmployeeDraft) => void;
  idPrefix: string;
  workplaceExtra?: React.ReactNode;
}) {
  const [openSections, setOpenSections] =
    useState<Record<EditSectionId, boolean>>(DEFAULT_OPEN_SECTIONS);

  useEffect(() => {
    const section = firstErrorSection(errors);
    if (!section) return;
    setOpenSections((current) =>
      current[section] ? current : { ...current, [section]: true },
    );
  }, [errors]);

  const setSectionOpen = (section: EditSectionId, open: boolean) =>
    setOpenSections((current) => ({ ...current, [section]: open }));

  const set = <K extends keyof EmployeeDraft>(key: K, value: EmployeeDraft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <div className="flex flex-col gap-4">
      <EditSection
        title="Profile"
        open={openSections.profile}
        onOpenChange={(open) => setSectionOpen("profile", open)}
      >
        <Field className="gap-1.5" data-invalid={errors.fullName ? true : undefined}>
          <FieldLabel htmlFor={`${idPrefix}-name`}>Full name</FieldLabel>
          <Input
            id={`${idPrefix}-name`}
            value={draft.fullName}
            onChange={(event) => set("fullName", event.target.value)}
            disabled={disabled}
            required
            aria-invalid={Boolean(errors.fullName)}
          />
          {errors.fullName ? (
            <p role="alert" className="text-xs text-destructive">
              {errors.fullName}
            </p>
          ) : null}
        </Field>
        <Field className="gap-1.5" data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor={`${idPrefix}-email`}>Email</FieldLabel>
          <Input
            id={`${idPrefix}-email`}
            type="email"
            value={draft.email}
            onChange={(event) => set("email", event.target.value)}
            //change: Server validation is authoritative; this prevents accidental self-email edits in the dialog.
            disabled={disabled || emailLocked}
            required={draft.status !== "joining"}
            aria-invalid={Boolean(errors.email)}
          />
          {errors.email ? (
            <p role="alert" className="text-xs text-destructive">
              {errors.email}
            </p>
          ) : null}
        </Field>
        <Field className="gap-1.5" data-invalid={errors.avatarUrl ? true : undefined}>
          <FieldLabel htmlFor={`${idPrefix}-avatar`}>Avatar URL</FieldLabel>
          <Input
            id={`${idPrefix}-avatar`}
            value={draft.avatarUrl}
            onChange={(event) => set("avatarUrl", event.target.value)}
            disabled={disabled}
            aria-invalid={Boolean(errors.avatarUrl)}
          />
          {errors.avatarUrl ? (
            <p role="alert" className="text-xs text-destructive">
              {errors.avatarUrl}
            </p>
          ) : null}
        </Field>
      </EditSection>

      <EditSection
        title="Employment"
        open={openSections.employment}
        onOpenChange={(open) => setSectionOpen("employment", open)}
      >
        <Field className="gap-1.5">
          <FieldLabel>Status</FieldLabel>
          <Select
            value={draft.status}
            onValueChange={(value) => set("status", value as EmployeeDraft["status"])}
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMPLOYEE_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {EMPLOYEE_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field
            className="gap-1.5"
            data-invalid={errors.employeeId ? true : undefined}
          >
            <FieldLabel htmlFor={`${idPrefix}-employee-id`}>Employee ID</FieldLabel>
            <Input
              id={`${idPrefix}-employee-id`}
              value={draft.employeeId}
              onChange={(event) => set("employeeId", event.target.value)}
              disabled={disabled}
              aria-invalid={Boolean(errors.employeeId)}
            />
            {errors.employeeId ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.employeeId}
              </p>
            ) : null}
          </Field>
          <Field
            className="gap-1.5"
            data-invalid={errors.employmentRecord ? true : undefined}
          >
            <FieldLabel htmlFor={`${idPrefix}-record`}>Employment record</FieldLabel>
            <Input
              id={`${idPrefix}-record`}
              value={draft.employmentRecord}
              onChange={(event) => set("employmentRecord", event.target.value)}
              disabled={disabled}
              aria-invalid={Boolean(errors.employmentRecord)}
            />
            {errors.employmentRecord ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.employmentRecord}
              </p>
            ) : null}
          </Field>
        </div>
        <Field className="gap-1.5" data-invalid={errors.jobTitle ? true : undefined}>
          <FieldLabel htmlFor={`${idPrefix}-title`}>Person job title</FieldLabel>
          <Input
            id={`${idPrefix}-title`}
            value={draft.jobTitle}
            onChange={(event) => set("jobTitle", event.target.value)}
            disabled={disabled}
            aria-invalid={Boolean(errors.jobTitle)}
          />
          {errors.jobTitle ? (
            <p role="alert" className="text-xs text-destructive">
              {errors.jobTitle}
            </p>
          ) : null}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field
            className="gap-1.5"
            data-invalid={errors.joiningDate ? true : undefined}
          >
            <FieldLabel htmlFor={`${idPrefix}-joining`}>Joining date</FieldLabel>
            <Input
              id={`${idPrefix}-joining`}
              type="date"
              value={draft.joiningDate}
              onChange={(event) => set("joiningDate", event.target.value)}
              disabled={disabled}
              aria-invalid={Boolean(errors.joiningDate)}
            />
            {errors.joiningDate ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.joiningDate}
              </p>
            ) : null}
          </Field>
          <Field
            className="gap-1.5"
            data-invalid={errors.lastWorkingDate ? true : undefined}
          >
            <FieldLabel htmlFor={`${idPrefix}-last`}>Last working date</FieldLabel>
            <Input
              id={`${idPrefix}-last`}
              type="date"
              value={draft.lastWorkingDate}
              onChange={(event) => set("lastWorkingDate", event.target.value)}
              disabled={disabled}
              required={draft.status === "serving_notice"}
              aria-invalid={Boolean(errors.lastWorkingDate)}
            />
            {errors.lastWorkingDate ? (
              <p role="alert" className="text-xs text-destructive">
                {errors.lastWorkingDate}
              </p>
            ) : null}
          </Field>
        </div>
      </EditSection>

      <EditSection
        title="Workplace"
        open={openSections.workplace}
        onOpenChange={(open) => setSectionOpen("workplace", open)}
      >
        <Field
          className="gap-1.5"
          data-invalid={errors.officeLocation ? true : undefined}
        >
          <FieldLabel htmlFor={`${idPrefix}-location`}>Office location</FieldLabel>
          <Input
            id={`${idPrefix}-location`}
            value={draft.officeLocation}
            onChange={(event) => set("officeLocation", event.target.value)}
            disabled={disabled}
            aria-invalid={Boolean(errors.officeLocation)}
          />
          {errors.officeLocation ? (
            <p role="alert" className="text-xs text-destructive">
              {errors.officeLocation}
            </p>
          ) : null}
        </Field>
        {workplaceExtra ? (
          <div className="flex flex-col gap-2 border-t border-black/[0.06] pt-4">
            {workplaceExtra}
          </div>
        ) : null}
      </EditSection>
    </div>
  );
}
