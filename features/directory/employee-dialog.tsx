"use client";

/**
 * Employee detail dialog. Centered Dialog. Published is
 * read-only. Sandbox editors edit person fields and primary seat.
 * View on chart uses the search-focus pipeline (04).
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mail, MapPin } from "lucide-react";

import { PageEmpty } from "@/components/page-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useActor } from "@/features/auth/auth-provider";
import type { ChartRow, SeatMember } from "@/features/chart/chart-row";
import { formatJoining } from "@/features/chart/card";
import { canEditPersonFields, seatChrome } from "@/features/chart/primary-seat";
import {
  directoryChartHref,
  isChartSurface,
  viewSeatOnChart,
} from "@/features/chart/view-on-chart";
import { isSafeHttpUrl } from "@/lib/safe-url";
import { cn } from "@/lib/utils";
import { useOrgData } from "@/store/org-data";
import type { DirectoryRow } from "./directory-row";
import { EmployeeEditFields, FormSection } from "./employee-edit-form";
import {
  EMPLOYEE_STATUS_LABELS,
  draftFromMember,
  employeeDraftsEqual,
  mailtoHref,
  memberPatchFromDraft,
  validateEmployeeDraft,
  type EmployeeDraft,
  type FieldErrors,
} from "./employee-fields";
import { setPrimarySeat, updateEmployee } from "@/features/sandbox/employee-writes";

export interface EmployeeDialogProps {
  chartRows: ChartRow[];
  directoryRows: DirectoryRow[];
  authId: string | null;
  originNodeId: string | null;
  onClose: () => void;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function statusBadge(member: SeatMember) {
  if (member.status === "joining") {
    return (
      <Badge variant="outline">
        {member.joiningDate ? formatJoining(member.joiningDate) : "Joining"}
      </Badge>
    );
  }
  if (member.status === "active") return <Badge variant="default">Active</Badge>;
  if (member.status === "resigned")
    return <Badge variant="destructive">Resigned</Badge>;
  return <Badge variant="secondary">{EMPLOYEE_STATUS_LABELS[member.status]}</Badge>;
}

function EmployeeSeatsList({
  seats,
  person,
  authId,
  dirByNodeId,
  showTitles,
  canEditPerson,
  treeId,
  pathname,
  onSetPrimary,
  onPatchEmployee,
}: {
  seats: ChartRow[];
  person: SeatMember;
  authId: string;
  dirByNodeId: Map<string, DirectoryRow>;
  showTitles: boolean;
  canEditPerson: boolean;
  treeId: string | null;
  pathname: string;
  onSetPrimary: (authId: string, nodeId: string) => void;
  onPatchEmployee: (authId: string, patch: Partial<SeatMember>) => void;
}) {
  return (
    <>
      <h4 className="text-xs font-semibold text-foreground/80">
        {seats.length === 1 ? "Seat" : `Seats (${seats.length})`}
      </h4>
      <ul className="flex flex-col gap-2">
        {seats.map((seat) => {
          const dir = dirByNodeId.get(seat.id);
          const member = seat.members.find((m) => m.authId === authId);
          const chrome = seatChrome({
            personSeatCount: seats.length,
            seatMemberCount: seat.members.length,
            isPrimary: Boolean(member?.isPrimary),
            isHost: seat.members[0]?.authId === authId,
          });
          return (
            <li key={seat.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {showTitles
                    ? (seat.jobTitle ?? person.displayTitle)
                    : dir?.teamPath || "Seat"}
                </span>
                <div className="flex flex-wrap justify-end gap-1">
                  {chrome.primary ? (
                    <Badge
                      variant={chrome.primary === "Primary" ? "default" : "secondary"}
                    >
                      {chrome.primary}
                    </Badge>
                  ) : null}
                  {chrome.host ? (
                    <Badge variant={chrome.host === "Host" ? "default" : "outline"}>
                      {chrome.host}
                    </Badge>
                  ) : null}
                </div>
              </div>
              {showTitles && dir?.teamPath && (
                <div className="mt-1 text-xs text-muted-foreground">{dir.teamPath}</div>
              )}
              {canEditPerson && treeId ? (
                <SeatEdit
                  treeId={treeId}
                  nodeId={seat.id}
                  authId={authId}
                  isPrimary={Boolean(member?.isPrimary)}
                  showSetPrimary={seats.length > 1 && !member?.isPrimary}
                  nodeIds={seats.map((item) => item.id)}
                  onSetPrimary={onSetPrimary}
                  onPatchEmployee={onPatchEmployee}
                />
              ) : null}
              {seat.id ? (
                isChartSurface(pathname) ? (
                  <button
                    type="button"
                    className="mt-2 inline-block cursor-pointer text-xs font-medium text-primary hover:underline"
                    onClick={() => viewSeatOnChart(seat.id, pathname)}
                  >
                    View on chart
                  </button>
                ) : (
                  <Link
                    href={directoryChartHref(seat.id)}
                    className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
                    onClick={() => viewSeatOnChart(seat.id, pathname)}
                  >
                    View on chart
                  </Link>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function EmployeeDialog({
  chartRows,
  directoryRows,
  authId,
  originNodeId,
  onClose,
}: EmployeeDialogProps) {
  const actor = useActor();
  const pathname = usePathname();
  const treeId = useOrgData((state) => state.treeId);
  const treeKind = useOrgData((state) => state.treeKind);
  const sandboxEditable = useOrgData((state) => state.sandboxEditable);
  const patchEmployee = useOrgData((state) => state.patchEmployee);
  const setPrimarySeatLocal = useOrgData((state) => state.setPrimarySeatLocal);
  const showTitles = treeKind === "sandbox";
  const canEditPerson = canEditPersonFields({ treeKind, canEdit: sandboxEditable });
  const [workplaceOpen, setWorkplaceOpen] = useState(true);
  const seats = authId
    ? chartRows.length > 0
      ? chartRows.filter((row) => row.members.some((m) => m.authId === authId))
      : directoryRows
          .filter((row) => row.host.authId === authId)
          .map((row): ChartRow => ({
            id: row.nodeId,
            parentId: "",
            kind: "seat",
            sortOrder: 0,
            rowVersion: 1,
            jobTitle: row.jobTitle,
            members: [row.host],
          }))
    : [];
  const person = seats.flatMap((row) => row.members).find((m) => m.authId === authId);
  const mailHref = person?.email ? mailtoHref(person.email) : null;
  const dirByNodeId = new Map(directoryRows.map((row) => [row.nodeId, row]));
  const primarySeat =
    seats.find((seat) =>
      seat.members.some((m) => m.authId === authId && m.isPrimary),
    ) ?? seats[0];
  const manager =
    (primarySeat ? dirByNodeId.get(primarySeat.id)?.manager : undefined) ??
    seats.map((seat) => dirByNodeId.get(seat.id)?.manager).find(Boolean) ??
    person?.primaryTeamPath ??
    "";

  const seatsList =
    person && authId ? (
      <EmployeeSeatsList
        seats={seats}
        person={person}
        authId={authId}
        dirByNodeId={dirByNodeId}
        showTitles={showTitles}
        canEditPerson={canEditPerson}
        treeId={treeId}
        pathname={pathname}
        onSetPrimary={setPrimarySeatLocal}
        onPatchEmployee={patchEmployee}
      />
    ) : null;

  return (
    <Dialog open={authId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {!person ? (
          <>
            <DialogTitle className="sr-only">Employee details</DialogTitle>
            <div className="p-6">
              <PageEmpty body="This person isn’t on this chart." />
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="shrink-0 px-6 pt-6">
              <div className="flex items-center gap-4">
                <Avatar className="size-16">
                  {person.avatarUrl && isSafeHttpUrl(person.avatarUrl) ? (
                    <AvatarImage src={person.avatarUrl} alt="" />
                  ) : null}
                  <AvatarFallback className="text-lg">
                    {initials(person.displayName)}
                  </AvatarFallback>
                </Avatar>
                <div
                  className={cn(
                    "min-w-0",
                    person.status === "serving_notice" && "opacity-70",
                  )}
                >
                  <DialogTitle className="truncate">{person.displayName}</DialogTitle>
                  {showTitles && person.displayTitle ? (
                    <DialogDescription className="truncate">
                      {person.displayTitle}
                    </DialogDescription>
                  ) : (
                    <DialogDescription className="sr-only">
                      Employee details
                    </DialogDescription>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {statusBadge(person)}
                  </div>
                </div>
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex flex-col gap-4 px-6 pb-6 pt-4">
                <div className="flex flex-col gap-3 text-sm">
                  {person.email &&
                    (mailHref ? (
                      <a
                        href={mailHref}
                        className="flex items-center gap-2 text-foreground hover:underline"
                      >
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        {person.email}
                      </a>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        {person.email}
                      </div>
                    ))}
                  {person.officeLocation && (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      {person.officeLocation}
                    </div>
                  )}
                  {manager && (
                    <div className="text-muted-foreground">
                      Reports to{" "}
                      <span className="font-medium text-foreground">{manager}</span>
                    </div>
                  )}
                </div>

                {canEditPerson && authId && treeId ? (
                  <PersonEdit
                    treeId={treeId}
                    authId={authId}
                    originNodeId={originNodeId}
                    person={person}
                    nodeIds={seats.map((seat) => seat.id)}
                    emailLocked={actor?.role !== "admin"}
                    onPatch={patchEmployee}
                    workplaceExtra={seatsList}
                  />
                ) : seatsList ? (
                  <FormSection
                    title="Workplace"
                    open={workplaceOpen}
                    onOpenChange={setWorkplaceOpen}
                  >
                    {seatsList}
                  </FormSection>
                ) : null}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PersonEdit({
  treeId,
  authId,
  originNodeId,
  person,
  nodeIds,
  emailLocked,
  onPatch,
  workplaceExtra,
}: {
  treeId: string;
  authId: string;
  originNodeId: string | null;
  person: SeatMember;
  nodeIds: string[];
  emailLocked: boolean;
  onPatch: (authId: string, patch: Partial<SeatMember>) => void;
  workplaceExtra?: React.ReactNode;
}) {
  const [draft, setDraft] = useState<EmployeeDraft>(() => draftFromMember(person));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setDraft(draftFromMember(person));
    setError(null);
    setFieldErrors({});
    // Only reset when the dialog target changes; person identity churns on tree paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authId]);

  const initialDraft = useMemo(() => draftFromMember(person), [person]);
  const hasChanges = !employeeDraftsEqual(draft, initialDraft);

  const save = () => {
    if (!hasChanges) return;
    setError(null);
    const errors = validateEmployeeDraft(draft);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const previous = { ...person };
    const next = memberPatchFromDraft(draft);
    onPatch(authId, next);
    useOrgData.getState().beginPersist(nodeIds);
    startTransition(async () => {
      const result = await updateEmployee(
        treeId,
        originNodeId ?? nodeIds[0] ?? "",
        authId,
        draft,
      );
      if (!result.ok) {
        onPatch(authId, previous);
        useOrgData.getState().endPersist(nodeIds);
        setError(result.reason);
        return;
      }
      onPatch(authId, result.patch);
      setDraft(draftFromMember({ ...person, ...result.patch }));
      useOrgData.getState().endPersist(nodeIds);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <EmployeeEditFields
        key={authId}
        draft={draft}
        errors={fieldErrors}
        disabled={pending}
        emailLocked={emailLocked}
        onChange={(next) => {
          setDraft(next);
          setFieldErrors({});
        }}
        idPrefix="dialog"
        workplaceExtra={workplaceExtra}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          variant={hasChanges || pending ? "default" : "secondary"}
          disabled={pending || !hasChanges}
          onClick={save}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function SeatEdit({
  treeId,
  nodeId,
  authId,
  isPrimary,
  showSetPrimary,
  nodeIds,
  onSetPrimary,
  onPatchEmployee,
}: {
  treeId: string;
  nodeId: string;
  authId: string;
  isPrimary: boolean;
  showSetPrimary: boolean;
  nodeIds: string[];
  onSetPrimary: (authId: string, nodeId: string) => void;
  onPatchEmployee: (authId: string, patch: Partial<SeatMember>) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const makePrimary = () => {
    if (isPrimary) return;
    setError(null);
    onSetPrimary(authId, nodeId);
    useOrgData.getState().beginPersist(nodeIds);
    startTransition(async () => {
      const result = await setPrimarySeat(treeId, nodeId, authId);
      if (!result.ok) {
        useOrgData.getState().endPersist(nodeIds);
        setError(result.reason);
        return;
      }
      onPatchEmployee(authId, result.patch);
      onSetPrimary(authId, nodeId);
      useOrgData.getState().endPersist(nodeIds);
    });
  };

  if (!showSetPrimary && !pending && !error) return null;

  return (
    <div className="mt-2 flex flex-col gap-2">
      {showSetPrimary ? (
        <Button size="sm" variant="secondary" disabled={pending} onClick={makePrimary}>
          Set as primary
        </Button>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
