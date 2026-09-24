"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Link2, Search, X } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  EDITOR_ROLES,
  MERGE_ROLES,
  hasAllowedRole,
  roleLabel,
  type AppRole,
} from "@/features/auth/policy";
import type { SandboxShareLevel } from "./access";
import {
  getSandboxShareDetails,
  grantSandboxAccess,
  revokeSandboxAccess,
  type SandboxShareDetails,
  type SharePerson,
} from "./sharing";
import { searchRecipientCandidates } from "./recipient-search";

function displayName(person: Pick<SharePerson, "name" | "email">): string {
  return person.name?.trim() || person.email;
}

function initials(name: string | null | undefined): string {
  return (name ?? "")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function personContext(person: SharePerson): string {
  return [person.jobTitle, person.officeLocation].filter(Boolean).join(" · ");
}

function inheritsEditorAccess(role: AppRole): boolean {
  return hasAllowedRole(role, MERGE_ROLES);
}

function canReceiveAssignedEditor(role: AppRole): boolean {
  return hasAllowedRole(role, EDITOR_ROLES);
}

export function ShareSandboxDialog({
  open,
  onOpenChange,
  sandboxId,
  sandboxName,
  returnFocus,
  readOnly = false,
  showPastAccess = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sandboxId: string | null;
  sandboxName: string | null;
  returnFocus?: HTMLElement | null;
  readOnly?: boolean;
  showPastAccess?: boolean;
}) {
  const [origin, setOrigin] = useState("");
  const [details, setDetails] = useState<SandboxShareDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedPeople, setSelectedPeople] = useState<SharePerson[]>([]);
  const [level, setLevel] = useState<SandboxShareLevel>("viewer");
  const dialogGeneration = useRef(0);
  const [pendingGeneration, setPendingGeneration] = useState<number | null>(null);
  const pending = pendingGeneration === dialogGeneration.current;

  const canCopyLink = Boolean(details?.canManage && !readOnly);
  const path = sandboxId ? `/sandbox/${sandboxId}` : "";
  const shareUrl = origin && path ? `${origin}${path}` : path;
  const activeShares = useMemo(
    () => details?.shares.filter((share) => share.status === "active") ?? [],
    [details],
  );
  const pastShares = useMemo(
    () => details?.shares.filter((share) => share.status !== "active") ?? [],
    [details],
  );
  const canManage = Boolean(details?.canManage && !readOnly);
  const canAdd = Boolean(canManage && !details?.archived);
  const automaticEditorPeople = selectedPeople.filter((person) =>
    inheritsEditorAccess(person.role),
  );
  const selectedNeedsAssignment = automaticEditorPeople.length < selectedPeople.length;
  const selectedCanReceiveEditor = selectedPeople
    .filter((person) => !inheritsEditorAccess(person.role))
    .every((person) => canReceiveAssignedEditor(person.role));
  const assignedLevelCount = selectedPeople.length - automaticEditorPeople.length;
  const automaticEditorSubject =
    automaticEditorPeople.length === 1
      ? roleLabel(automaticEditorPeople[0]!.role)
      : `${automaticEditorPeople.length} selected people`;
  const everyoneSelectedReceivesEditor =
    selectedPeople.length > 0 &&
    (level === "editor" || automaticEditorPeople.length === selectedPeople.length);
  const accessHelper = everyoneSelectedReceivesEditor
    ? "Editor applies to all selected people. Access ends when the sandbox is published."
    : automaticEditorPeople.length > 0 && assignedLevelCount > 0
      ? `${roleLabel(level)} applies to ${assignedLevelCount} ${assignedLevelCount === 1 ? "person" : "people"}. ${automaticEditorSubject} will automatically receive Editor access based on ${automaticEditorPeople.length === 1 ? "their global role" : "their global roles"}. Access ends when the sandbox is published.`
      : automaticEditorPeople.length > 0
        ? `${automaticEditorSubject} will automatically receive Editor access based on ${automaticEditorPeople.length === 1 ? "their global role" : "their global roles"}. Access ends when the sandbox is published.`
        : "Publishers and admins automatically receive Editor access. Access ends when the sandbox is published.";
  const results = useMemo(() => {
    const selectedIds = new Set(selectedPeople.map((person) => person.authId));
    return searchRecipientCandidates(details?.recipients ?? [], query).filter(
      (person) => !selectedIds.has(person.authId),
    );
  }, [details?.recipients, query, selectedPeople]);
  const showSearchPanel = canAdd && !pending && query.trim().length > 0;

  const refresh = async (
    targetSandboxId = sandboxId,
    generation = dialogGeneration.current,
  ) => {
    if (!targetSandboxId || generation !== dialogGeneration.current) return;
    setLoading(true);
    setLoadError(false);
    try {
      const next = await getSandboxShareDetails(targetSandboxId);
      if (generation !== dialogGeneration.current) return;
      setDetails(next);
      setLoadError(next === null);
    } catch {
      if (generation !== dialogGeneration.current) return;
      setDetails(null);
      setLoadError(true);
    } finally {
      if (generation === dialogGeneration.current) setLoading(false);
    }
  };

  useEffect(() => {
    const generation = ++dialogGeneration.current;
    setPendingGeneration(null);
    if (!open || !sandboxId) return;
    setOrigin(window.location.origin);
    setQuery("");
    setSelectedPeople([]);
    setLevel("viewer");
    setDetails(null);
    setLoadError(false);
    void refresh(sandboxId, generation);
    // refresh is intentionally tied to the selected sandbox and open state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sandboxId]);

  const replaceSelectedPeople = (people: SharePerson[]) => {
    setSelectedPeople(people);
    const assignedPeople = people.filter(
      (person) => !inheritsEditorAccess(person.role),
    );
    if (
      assignedPeople.length === 0 ||
      assignedPeople.some((person) => !canReceiveAssignedEditor(person.role))
    ) {
      setLevel("viewer");
    }
  };

  const runPending = (generation: number, operation: () => Promise<void>) => {
    setPendingGeneration(generation);
    void operation().finally(() => {
      setPendingGeneration((current) => (current === generation ? null : current));
    });
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      dialogGeneration.current += 1;
      setPendingGeneration(null);
    }
    onOpenChange(nextOpen);
  };

  const invite = () => {
    if (!sandboxId || selectedPeople.length === 0) return;
    const targetSandboxId = sandboxId;
    const generation = dialogGeneration.current;
    const invitations = [...selectedPeople];
    const invitationLevel = selectedNeedsAssignment ? level : "viewer";
    runPending(generation, async () => {
      const failed: SharePerson[] = [];
      for (const person of invitations) {
        try {
          const result = await grantSandboxAccess(
            targetSandboxId,
            person.authId,
            invitationLevel,
          );
          if (!result.ok) failed.push(person);
        } catch {
          failed.push(person);
        }
      }
      if (generation === dialogGeneration.current) {
        replaceSelectedPeople(failed.length > 0 ? failed : []);
        setQuery("");
      }
      if (failed.length > 0) {
        toast.error(
          failed.length === invitations.length
            ? "Couldn’t invite the selected people"
            : `${failed.length} ${failed.length === 1 ? "person" : "people"} couldn’t be invited`,
        );
      } else {
        toast.success(
          `${invitations.length} ${invitations.length === 1 ? "person" : "people"} invited`,
        );
      }
      await refresh(targetSandboxId, generation);
    });
  };

  const changeLevel = (authId: string, next: SandboxShareLevel) => {
    if (!sandboxId) return;
    const targetSandboxId = sandboxId;
    const generation = dialogGeneration.current;
    runPending(generation, async () => {
      try {
        const result = await grantSandboxAccess(targetSandboxId, authId, next);
        if (!result.ok) toast.error(result.reason);
        else toast.success("Access updated");
        await refresh(targetSandboxId, generation);
      } catch {
        toast.error("Couldn’t update access");
      }
    });
  };

  const remove = (shareId: string) => {
    if (!sandboxId) return;
    const targetSandboxId = sandboxId;
    const generation = dialogGeneration.current;
    runPending(generation, async () => {
      try {
        const result = await revokeSandboxAccess(targetSandboxId, shareId);
        if (!result.ok) toast.error(result.reason);
        else toast.success("Access removed");
        await refresh(targetSandboxId, generation);
      } catch {
        toast.error("Couldn’t remove access");
      }
    });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Sandbox link copied");
    } catch {
      toast.error("Couldn’t copy link");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[min(720px,90vh)] gap-0 space-y-5 overflow-y-auto p-6 sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          if (!returnFocus) return;
          event.preventDefault();
          returnFocus.focus();
        }}
      >
        <DialogHeader className="gap-0">
          <DialogTitle className="text-lg font-semibold text-gray-900">
            {readOnly ? "Sandbox access" : "Share sandbox"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-gray-500">
            {readOnly
              ? `Access to ${sandboxName ?? "this sandbox"}.`
              : `Give someone access to ${sandboxName ?? "this sandbox"} only.`}
          </DialogDescription>
        </DialogHeader>

        {loading && !details ? (
          <div className="flex min-h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : loadError ? (
          <div className="flex min-h-32 flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">
              Couldn’t load sandbox access.
            </p>
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {canAdd ? (
              <section aria-labelledby="sandbox-share-people-label">
                <label
                  id="sandbox-share-people-label"
                  htmlFor="sandbox-share-people"
                  className="mt-2 block text-sm font-medium"
                >
                  Add people
                </label>
                <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="relative min-w-0 flex-1">
                    <div className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 bg-white p-2 shadow-xs focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20">
                      {selectedPeople.map((person) => (
                        <span
                          key={person.authId}
                          className="inline-flex h-5 max-w-full items-center gap-1.5 rounded-md bg-muted py-0 pl-1 pr-1.5 text-xs font-medium"
                        >
                          <Avatar size="sm" className="size-5">
                            {person.avatarUrl ? (
                              <AvatarImage src={person.avatarUrl} alt="" />
                            ) : null}
                            <AvatarFallback className="bg-primary/20 text-[9px] font-semibold text-foreground">
                              {initials(person.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="max-w-32 truncate">{person.name}</span>
                          <button
                            type="button"
                            disabled={pending}
                            className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`Remove ${person.name}`}
                            onClick={() => {
                              const nextPeople = selectedPeople.filter(
                                (item) => item.authId !== person.authId,
                              );
                              replaceSelectedPeople(nextPeople);
                            }}
                          >
                            <X className="size-3.5" />
                          </button>
                        </span>
                      ))}
                      <div className="flex min-w-36 flex-1 items-center">
                        <Search className="ml-1 size-4 shrink-0 text-muted-foreground" />
                        <Input
                          id="sandbox-share-people"
                          className="h-5 min-w-24 flex-1 border-0 bg-transparent px-2 py-0 shadow-none focus-visible:ring-0"
                          value={query}
                          placeholder={
                            selectedPeople.length > 0
                              ? "Add another person"
                              : "Search by name or email"
                          }
                          onChange={(event) => setQuery(event.target.value)}
                          name="sandbox-share-people-search"
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          disabled={pending}
                          role="combobox"
                          aria-autocomplete="list"
                          aria-controls="sandbox-share-search-results"
                          aria-expanded={showSearchPanel}
                        />
                      </div>
                    </div>
                    {showSearchPanel ? (
                      <div
                        id="sandbox-share-search-results"
                        className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md bg-popover p-1 shadow-md"
                      >
                        {results.length > 0 ? (
                          results.map((person) => (
                            <button
                              key={person.authId}
                              type="button"
                              disabled={pending}
                              className="flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                              onClick={() => {
                                const nextPeople = [...selectedPeople, person];
                                replaceSelectedPeople(nextPeople);
                                setQuery("");
                              }}
                            >
                              <Avatar>
                                {person.avatarUrl ? (
                                  <AvatarImage src={person.avatarUrl} alt="" />
                                ) : null}
                                <AvatarFallback className="bg-primary/15 text-xs font-semibold text-foreground">
                                  {initials(person.name)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">
                                  {person.name}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {person.email}
                                </span>
                                {personContext(person) ? (
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {personContext(person)}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          ))
                        ) : (
                          <p
                            className="px-3 py-4 text-center text-xs text-muted-foreground"
                            role="status"
                          >
                            No matching people.
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {selectedPeople.length === 0 || selectedNeedsAssignment ? (
                      <Select
                        value={level}
                        disabled={pending}
                        onValueChange={(value) => setLevel(value as SandboxShareLevel)}
                      >
                        <SelectTrigger
                          aria-label="Access level"
                          className="h-10! w-28 rounded-lg border-border px-3 py-2"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="viewer">Viewer</SelectItem>
                          <SelectItem
                            value="editor"
                            disabled={!selectedCanReceiveEditor}
                          >
                            Editor
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <div
                        aria-label="Access level"
                        className="flex h-10 w-28 items-center rounded-lg border border-border bg-muted px-3 py-2 text-sm font-medium"
                      >
                        Editor
                      </div>
                    )}
                    <Button
                      className="h-10 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                      disabled={selectedPeople.length === 0 || pending}
                      onClick={invite}
                    >
                      Invite
                    </Button>
                  </div>
                </div>
                <p className="mt-2.5 text-xs leading-relaxed text-gray-500">
                  {accessHelper}
                </p>
              </section>
            ) : details?.archived && !readOnly ? (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                Archived sandboxes cannot receive new shares.
              </p>
            ) : null}

            <section className="space-y-2" aria-labelledby="people-with-access">
              <h3 id="people-with-access" className="text-sm font-medium">
                People with access{" "}
                <span className="font-normal text-gray-500">
                  ({activeShares.length + 1})
                </span>
              </h3>
              <div className="divide-y divide-gray-100">
                <div className="flex items-center gap-3 py-2.5">
                  <Avatar className="size-9">
                    <AvatarFallback className="bg-primary/15 text-xs font-semibold">
                      {initials(details?.ownerName ?? "Owner")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {details?.ownerName ?? "Owner"}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {details?.ownerEmail ?? ""}
                    </p>
                  </div>
                  <Badge variant="secondary">Owner</Badge>
                </div>
                {activeShares.map((share) => {
                  const inheritedEditor = inheritsEditorAccess(share.role);
                  return (
                    <div key={share.shareId} className="flex items-center gap-3 py-2.5">
                      <Avatar className="size-9">
                        <AvatarFallback className="bg-muted text-xs font-semibold">
                          {initials(displayName(share))}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {displayName(share)}
                        </p>
                        <p className="truncate text-xs text-gray-500">{share.email}</p>
                      </div>
                      {canManage ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 capitalize text-muted-foreground"
                              disabled={pending}
                              aria-label={`Access for ${displayName(share)}`}
                            >
                              {inheritedEditor ? "Editor" : share.accessLevel}
                              <ChevronDown className="size-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {inheritedEditor ? (
                              <DropdownMenuItem disabled>
                                Editor from {roleLabel(share.role)} role
                              </DropdownMenuItem>
                            ) : (
                              <>
                                <DropdownMenuItem
                                  disabled={
                                    details?.archived || share.accessLevel === "viewer"
                                  }
                                  onSelect={() => changeLevel(share.authId, "viewer")}
                                >
                                  Viewer
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={
                                    details?.archived ||
                                    share.accessLevel === "editor" ||
                                    !canReceiveAssignedEditor(share.role)
                                  }
                                  onSelect={() => changeLevel(share.authId, "editor")}
                                >
                                  Editor
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                              </>
                            )}
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => remove(share.shareId)}
                            >
                              Remove access
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <Badge variant="outline" className="capitalize">
                          {inheritedEditor ? "editor" : share.accessLevel}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
              {activeShares.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Only people with access can view this sandbox.
                </p>
              ) : null}
            </section>

            {(readOnly || showPastAccess) && pastShares.length > 0 ? (
              <section className="space-y-2" aria-labelledby="past-access">
                <h3 id="past-access" className="text-sm font-medium">
                  Past access
                </h3>
                <div className="divide-y rounded-lg border">
                  {pastShares.map((share) => (
                    <div
                      key={share.shareId}
                      className="flex items-center gap-3 px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {displayName(share)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {share.email}
                        </p>
                      </div>
                      <Badge variant="outline" className="capitalize">
                        {share.accessLevel}
                      </Badge>
                      <Badge variant="secondary" className="capitalize">
                        {share.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}

        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          {canCopyLink ? (
            <Button
              variant="outline"
              className="rounded-lg border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 shadow-none hover:bg-gray-100 hover:text-gray-900"
              onClick={() => void copyLink()}
            >
              <Link2 data-icon="inline-start" />
              Copy link
            </Button>
          ) : (
            <span />
          )}
          <Button
            className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
            onClick={() => handleOpenChange(false)}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
