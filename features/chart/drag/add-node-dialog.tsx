"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedItem, SegmentedTrack } from "@/components/ui/segmented-control";
import { EmployeeEditFields } from "@/features/directory/employee-edit-form";
import {
  addSeatCanConfirm,
  createPersonCanConfirm,
  emptyDraft,
  resolveSeatTitle,
  type EmployeeDraft,
  validateCreatePerson,
} from "@/features/directory/employee-fields";
import { cn } from "@/lib/utils";

export interface AddNodeRequest {
  parentId: string;
  parentLabel: string;
  kind: "header" | "seat";
  asAssistant?: boolean;
}

export interface EmployeeOption {
  authId: string;
  displayName: string;
  displayTitle: string;
  status: string | null;
}

export function AddNodeDialog({
  request,
  employees,
  busy,
  onConfirm,
  onClose,
}: {
  request: AddNodeRequest;
  employees: EmployeeOption[];
  busy: boolean;
  onConfirm: (
    payload:
      | { name: string }
      | { employeeAuthId: string; jobTitle: string; reactivateWithJoiningDate?: string }
      | { newPerson: EmployeeDraft; jobTitle: string },
  ) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [selectedAuthId, setSelectedAuthId] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState("");
  const [reactivateAuthId, setReactivateAuthId] = useState<string | null>(null);
  const [reactivateJoiningDate, setReactivateJoiningDate] = useState("");
  const [mode, setMode] = useState<"pick" | "create">("pick");
  const [draft, setDraft] = useState(emptyDraft);
  const [showCreateErrors, setShowCreateErrors] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (employee) =>
        employee.displayName.toLowerCase().includes(q) ||
        employee.displayTitle.toLowerCase().includes(q),
    );
  }, [employees, query]);

  const isHeader = request.kind === "header";
  const selectedEmployee = employees.find(
    (employee) => employee.authId === selectedAuthId,
  );
  const reactivationEmployee = employees.find(
    (employee) => employee.authId === reactivateAuthId,
  );
  const needsReactivation =
    selectedEmployee?.status === "inactive" || selectedEmployee?.status === "resigned";
  const trimmedTitle = resolveSeatTitle(jobTitle, draft.jobTitle);
  const createErrors = useMemo(
    () => validateCreatePerson(draft, jobTitle),
    [draft, jobTitle],
  );
  const canConfirm =
    !busy &&
    (isHeader
      ? name.trim().length > 0
      : mode === "create"
        ? createPersonCanConfirm(draft, jobTitle)
        : addSeatCanConfirm(selectedAuthId, trimmedTitle) &&
          (!needsReactivation || Boolean(reactivateJoiningDate)));
  const confirmDisabled =
    busy || (mode !== "create" && !canConfirm) || (isHeader && !canConfirm);

  const confirm = () => {
    if (!isHeader && mode === "create") {
      setShowCreateErrors(true);
      if (Object.keys(createErrors).length > 0) return;
    }
    if (!canConfirm) return;
    if (isHeader) {
      onConfirm({ name: name.trim() });
      return;
    }
    if (mode === "create") {
      onConfirm({ newPerson: draft, jobTitle: trimmedTitle });
      return;
    }
    onConfirm({
      employeeAuthId: selectedAuthId!,
      jobTitle: trimmedTitle,
      ...(needsReactivation
        ? { reactivateWithJoiningDate: reactivateJoiningDate }
        : {}),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isHeader
              ? "Add team"
              : request.asAssistant
                ? "Add assistant"
                : "Add position"}{" "}
            under {request.parentLabel}
          </DialogTitle>
        </DialogHeader>
        {isHeader ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              confirm();
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="team-name">Team name</FieldLabel>
                <Input
                  id="team-name"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Team name"
                  maxLength={120}
                />
              </Field>
            </FieldGroup>
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            <SegmentedTrack fullWidth role="tablist" aria-label="Person source">
              <SegmentedItem
                fullWidth
                active={mode === "pick"}
                aria-selected={mode === "pick"}
                onClick={() => setMode("pick")}
              >
                Existing person
              </SegmentedItem>
              <SegmentedItem
                fullWidth
                active={mode === "create"}
                aria-selected={mode === "create"}
                onClick={() => setMode("create")}
              >
                Create new person
              </SegmentedItem>
            </SegmentedTrack>
            {mode === "create" ? (
              <div className="max-h-80 overflow-y-auto pr-1">
                <EmployeeEditFields
                  draft={draft}
                  errors={showCreateErrors ? createErrors : {}}
                  disabled={busy}
                  onChange={setDraft}
                  idPrefix="add-person"
                />
              </div>
            ) : reactivationEmployee ? (
              <div className="flex flex-col gap-5 py-2">
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                  <p className="text-sm font-semibold text-foreground">
                    Reactivate {reactivationEmployee.displayName}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Set their joining date. It will reactivate them when you create this
                    position.
                  </p>
                </div>
                <Field>
                  <FieldLabel htmlFor="reactivate-joining-date">
                    Joining date
                  </FieldLabel>
                  <Input
                    id="reactivate-joining-date"
                    autoFocus
                    type="date"
                    value={reactivateJoiningDate}
                    onChange={(event) => setReactivateJoiningDate(event.target.value)}
                  />
                </Field>
              </div>
            ) : (
              <>
                <Input
                  autoFocus
                  name="add-position-search"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search people…"
                  aria-label="Search people"
                />
                <ul className="max-h-64 divide-y divide-black/[0.06] overflow-y-auto rounded-xl border border-border/80 bg-background shadow-2xs">
                  {filtered.length === 0 ? (
                    <li className="px-3.5 py-6 text-center text-xs text-muted-foreground">
                      No matches found
                    </li>
                  ) : (
                    filtered.map((employee) => {
                      const isSelected = selectedAuthId === employee.authId;
                      return (
                        <li key={employee.authId}>
                          <button
                            type="button"
                            className={cn(
                              "flex w-full cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors outline-none",
                              isSelected
                                ? "bg-primary/10 text-foreground"
                                : "hover:bg-muted/40 text-foreground/90",
                            )}
                            onClick={() => {
                              setSelectedAuthId(employee.authId);
                              setJobTitle(employee.displayTitle);
                              setReactivateJoiningDate("");
                              if (
                                employee.status === "inactive" ||
                                employee.status === "resigned"
                              ) {
                                setReactivateAuthId(employee.authId);
                              }
                            }}
                          >
                            <span className="min-w-0 flex-1">
                              <span
                                className={cn(
                                  "block truncate text-xs font-semibold",
                                  isSelected && "text-foreground",
                                )}
                              >
                                {employee.displayName}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {employee.displayTitle}
                              </span>
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              {employee.status === "joining" ||
                              employee.status === "inactive" ||
                              employee.status === "resigned" ? (
                                <Badge
                                  variant={
                                    employee.status === "resigned"
                                      ? "destructive"
                                      : "outline"
                                  }
                                  className="text-[10px] px-1.5 py-0"
                                >
                                  {employee.status === "joining"
                                    ? "Joining"
                                    : employee.status === "inactive"
                                      ? "Inactive"
                                      : "Resigned"}
                                </Badge>
                              ) : null}
                              {isSelected ? (
                                <Check className="size-4 text-primary" />
                              ) : null}
                            </div>
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              </>
            )}
            <FieldGroup>
              <Field
                data-invalid={
                  showCreateErrors && createErrors.seatTitle ? true : undefined
                }
              >
                <FieldLabel htmlFor="seat-job-title">Seat job title</FieldLabel>
                <Input
                  id="seat-job-title"
                  value={jobTitle}
                  onChange={(event) => setJobTitle(event.target.value)}
                  placeholder={
                    mode === "create"
                      ? "Defaults to the person job title"
                      : "Job title for this position"
                  }
                  maxLength={120}
                  disabled={mode === "pick" && selectedAuthId === null}
                  aria-invalid={Boolean(showCreateErrors && createErrors.seatTitle)}
                />
                {showCreateErrors && createErrors.seatTitle ? (
                  <p role="alert" className="text-xs text-destructive">
                    {createErrors.seatTitle}
                  </p>
                ) : null}
              </Field>
            </FieldGroup>
          </div>
        )}
        <DialogFooter>
          {reactivationEmployee ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setReactivateAuthId(null);
                  setReactivateJoiningDate("");
                  setSelectedAuthId(null);
                }}
              >
                Back
              </Button>
              <Button
                disabled={!reactivateJoiningDate}
                onClick={() => setReactivateAuthId(null)}
              >
                Continue
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={confirm} disabled={confirmDisabled}>
                {busy ? "Creating…" : isHeader ? "Create team" : "Create position"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
