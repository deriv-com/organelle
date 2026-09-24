import { shouldMuteServingNotice, type SeatMember } from "@/features/chart/chart-row";
import { isSafeHttpUrl } from "@/lib/safe-url";

export const EMPLOYEE_STATUSES = [
  "joining",
  "active",
  "serving_notice",
  "inactive",
  "resigned",
] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  joining: "Joining",
  active: "Active",
  serving_notice: "Serving Notice",
  inactive: "Inactive",
  resigned: "Resigned",
};

export type EmployeeDraft = {
  fullName: string;
  email: string;
  legalFullName: string;
  employeeId: string;
  employmentRecord: string;
  jobTitle: string;
  positionLevel: string;
  avatarUrl: string;
  officeCountry: string;
  officeLocation: string;
  hiringCompany: string;
  status: EmployeeStatus;
  joiningDate: string;
  hiredAt: string;
  resignationDate: string;
  lastWorkingDate: string;
};

export type EmployeeFieldKey = keyof EmployeeDraft | "seatTitle";
export type FieldErrors = Partial<Record<EmployeeFieldKey, string>>;

const EMPLOYEE_DRAFT_KEYS = [
  "fullName",
  "email",
  "legalFullName",
  "employeeId",
  "employmentRecord",
  "jobTitle",
  "positionLevel",
  "avatarUrl",
  "officeCountry",
  "officeLocation",
  "hiringCompany",
  "status",
  "joiningDate",
  "hiredAt",
  "resignationDate",
  "lastWorkingDate",
] as const satisfies readonly (keyof EmployeeDraft)[];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidReactivationDate(value: string): boolean {
  return DATE_RE.test(value);
}

export function emptyDraft(): EmployeeDraft {
  return {
    fullName: "",
    email: "",
    legalFullName: "",
    employeeId: "",
    employmentRecord: "",
    jobTitle: "",
    positionLevel: "",
    avatarUrl: "",
    officeCountry: "",
    officeLocation: "",
    hiringCompany: "",
    status: "active",
    joiningDate: "",
    hiredAt: "",
    resignationDate: "",
    lastWorkingDate: "",
  };
}

export function draftFromMember(member: SeatMember): EmployeeDraft {
  return {
    fullName: member.displayName,
    email: member.email,
    legalFullName: member.legalFullName ?? "",
    employeeId: member.employeeId ?? "",
    employmentRecord: member.employmentRecord ?? "",
    jobTitle: member.sourceTitle || member.displayTitle,
    positionLevel: member.positionLevel == null ? "" : String(member.positionLevel),
    avatarUrl: member.avatarUrl ?? "",
    officeCountry: member.officeCountry ?? "",
    officeLocation: member.officeLocation,
    hiringCompany: member.hiringCompany ?? "",
    status: member.status,
    joiningDate: member.joiningDate ?? member.hiredAt ?? "",
    hiredAt: member.hiredAt ?? "",
    resignationDate: member.resignationDate ?? "",
    lastWorkingDate: member.lastWorkingDate ?? member.resignationDate ?? "",
  };
}

export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length >= 3 && trimmed.length <= 254 && EMAIL_RE.test(trimmed);
}

export function validateSeatTitle(title: string): string | null {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > 120)
    return "Job title must be 1–120 characters";
  return null;
}

export function resolveSeatTitle(seatTitle: string, personTitle: string): string {
  const seat = seatTitle.trim();
  if (seat.length > 0) return seat;
  return personTitle.trim();
}

export function employeeDraftsEqual(a: EmployeeDraft, b: EmployeeDraft): boolean {
  return EMPLOYEE_DRAFT_KEYS.every((key) => a[key] === b[key]);
}

function optionalLen(value: string, max: number, label: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > max) return `${label} must be at most ${max} characters`;
  return undefined;
}

function optionalDate(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (!DATE_RE.test(trimmed)) return "Use YYYY-MM-DD";
  return undefined;
}

function currentLocalDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function resolveEmployeeLifecycleStatus(
  status: EmployeeStatus,
  dates: { joiningDate?: string | null; lastWorkingDate?: string | null },
  today = currentLocalDateString(),
): EmployeeStatus {
  const lastWorkingDate = (dates.lastWorkingDate ?? "").trim();
  if (DATE_RE.test(lastWorkingDate) && lastWorkingDate < today) return "resigned";
  if (DATE_RE.test(lastWorkingDate)) return "serving_notice";

  const joiningDate = (dates.joiningDate ?? "").trim();
  if (status === "joining" && DATE_RE.test(joiningDate) && joiningDate <= today) {
    return "active";
  }

  return status;
}

export function validateEmployeeDraft(
  draft: EmployeeDraft,
  today = currentLocalDateString(),
): FieldErrors {
  const errors: FieldErrors = {};
  const name = draft.fullName.trim();
  const email = draft.email.trim();
  const resolvedStatus = resolveEmployeeLifecycleStatus(
    draft.status,
    {
      joiningDate: draft.joiningDate,
      lastWorkingDate: draft.lastWorkingDate,
    },
    today,
  );
  if (name.length < 1 || name.length > 200)
    errors.fullName = "Name must be 1–200 characters";
  if (email.length === 0) {
    if (resolvedStatus !== "joining")
      errors.email = "Email cannot be empty for active employees";
  } else if (!isValidEmail(email)) {
    errors.email = "Enter a valid email";
  }
  const level = draft.positionLevel.trim();
  if (level.length > 0) {
    const n = Number(level);
    if (!Number.isInteger(n) || n < 0 || n > 99)
      errors.positionLevel = "Level must be 0–99";
  }
  const legal = optionalLen(draft.legalFullName, 200, "Legal name");
  if (legal) errors.legalFullName = legal;
  const employeeId = optionalLen(draft.employeeId, 80, "Employee ID");
  if (employeeId) errors.employeeId = employeeId;
  const record = optionalLen(draft.employmentRecord, 80, "Employment record");
  if (record) errors.employmentRecord = record;
  const title = optionalLen(draft.jobTitle, 120, "Job title");
  if (title) errors.jobTitle = title;
  const avatar = optionalLen(draft.avatarUrl, 500, "Avatar URL");
  if (avatar) errors.avatarUrl = avatar;
  else if (draft.avatarUrl.trim().length > 0 && !isSafeHttpUrl(draft.avatarUrl)) {
    errors.avatarUrl = "Avatar URL must be http or https";
  }
  const country = optionalLen(draft.officeCountry, 80, "Office country");
  if (country) errors.officeCountry = country;
  const location = optionalLen(draft.officeLocation, 120, "Office location");
  if (location) errors.officeLocation = location;
  const company = optionalLen(draft.hiringCompany, 120, "Hiring company");
  if (company) errors.hiringCompany = company;
  const joining = optionalDate(draft.joiningDate);
  if (joining) errors.joiningDate = joining;
  const hired = optionalDate(draft.hiredAt);
  if (hired) errors.hiredAt = hired;
  const resigned = optionalDate(draft.resignationDate);
  if (resigned) errors.resignationDate = resigned;
  const last = optionalDate(draft.lastWorkingDate);
  if (last) errors.lastWorkingDate = last;
  else if (
    draft.status === "serving_notice" &&
    draft.lastWorkingDate.trim().length === 0
  ) {
    errors.lastWorkingDate = "Last working date is required for serving notice";
  }
  if (!EMPLOYEE_STATUSES.includes(draft.status)) errors.status = "Unknown status";
  return errors;
}

export function validateCreatePerson(
  draft: EmployeeDraft,
  seatTitle: string,
): FieldErrors {
  const errors = validateEmployeeDraft(draft);
  const resolved = resolveSeatTitle(seatTitle, draft.jobTitle);
  const seatError = validateSeatTitle(resolved);
  if (seatError) errors.seatTitle = seatError;
  return errors;
}

export function createPersonCanConfirm(
  draft: EmployeeDraft,
  seatTitle: string,
  busy = false,
): boolean {
  if (busy) return false;
  return Object.keys(validateCreatePerson(draft, seatTitle)).length === 0;
}

export function addSeatCanConfirm(
  selectedAuthId: string | null,
  jobTitle: string,
  busy = false,
): boolean {
  if (busy || selectedAuthId == null) return false;
  return validateSeatTitle(jobTitle) == null;
}

export { mailtoHref } from "@/lib/safe-url";

export function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function parsePositionLevel(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return Number(trimmed);
}

export function parseOptionalDate(value: string): string | null {
  return blankToNull(value);
}

export function localEmployeeInsert(
  draft: EmployeeDraft,
  authId: string,
  today = currentLocalDateString(),
): {
  auth_id: string;
  email: string | null;
  full_name: string;
  legal_full_name: string | null;
  id: string | null;
  employment_record: string | null;
  job_title: string | null;
  position_level: number | null;
  avatar_url: string | null;
  office_country: string | null;
  office_location: string | null;
  hiring_company: string | null;
  status: EmployeeStatus;
  joining_date: string | null;
  hired_at: string | null;
  resignation_date: string | null;
  last_working_date: string | null;
} {
  return {
    auth_id: authId,
    email: blankToNull(draft.email),
    full_name: draft.fullName.trim(),
    legal_full_name: blankToNull(draft.legalFullName),
    id: blankToNull(draft.employeeId),
    employment_record: blankToNull(draft.employmentRecord),
    job_title: blankToNull(draft.jobTitle),
    position_level: parsePositionLevel(draft.positionLevel),
    avatar_url: blankToNull(draft.avatarUrl),
    office_country: blankToNull(draft.officeCountry),
    office_location: blankToNull(draft.officeLocation),
    hiring_company: blankToNull(draft.hiringCompany),
    status: resolveEmployeeLifecycleStatus(
      draft.status,
      {
        joiningDate: draft.joiningDate,
        lastWorkingDate: draft.lastWorkingDate,
      },
      today,
    ),
    joining_date: parseOptionalDate(draft.joiningDate),
    hired_at: parseOptionalDate(draft.hiredAt),
    resignation_date: parseOptionalDate(draft.resignationDate),
    last_working_date: parseOptionalDate(draft.lastWorkingDate),
  };
}

export function seatMemberFromDraft(
  authId: string,
  draft: EmployeeDraft,
  today = currentLocalDateString(),
): SeatMember {
  const name = draft.fullName.trim() || "Unknown";
  const title = draft.jobTitle.trim();
  const status = resolveEmployeeLifecycleStatus(
    draft.status,
    {
      joiningDate: draft.joiningDate,
      lastWorkingDate: draft.lastWorkingDate,
    },
    today,
  );
  const positionLevel = parsePositionLevel(draft.positionLevel);
  return {
    authId,
    displayName: name,
    displayTitle: title,
    email: draft.email.trim(),
    avatarUrl: blankToNull(draft.avatarUrl),
    officeLocation: draft.officeLocation.trim(),
    status,
    servingNoticeMuted: shouldMuteServingNotice(status, positionLevel),
    joiningDate: parseOptionalDate(draft.joiningDate),
    isHost: true,
    isPrimary: true,
    sourceName: name,
    sourceTitle: title,
    sourceAvatarUrl: blankToNull(draft.avatarUrl),
    overrideName: null,
    overrideTitle: null,
    overrideAvatarUrl: null,
    legalFullName: blankToNull(draft.legalFullName),
    employeeId: blankToNull(draft.employeeId),
    employmentRecord: blankToNull(draft.employmentRecord),
    positionLevel,
    officeCountry: blankToNull(draft.officeCountry),
    hiringCompany: blankToNull(draft.hiringCompany),
    hiredAt: parseOptionalDate(draft.hiredAt),
    resignationDate: parseOptionalDate(draft.resignationDate),
    lastWorkingDate: parseOptionalDate(draft.lastWorkingDate),
  };
}

export function memberPatchFromDraft(
  draft: EmployeeDraft,
  today = currentLocalDateString(),
): Partial<SeatMember> {
  const name = draft.fullName.trim();
  const title = draft.jobTitle.trim();
  const avatar = blankToNull(draft.avatarUrl);
  const status = resolveEmployeeLifecycleStatus(
    draft.status,
    {
      joiningDate: draft.joiningDate,
      lastWorkingDate: draft.lastWorkingDate,
    },
    today,
  );
  const positionLevel = parsePositionLevel(draft.positionLevel);
  return {
    displayName: name,
    displayTitle: title,
    email: draft.email.trim(),
    avatarUrl: avatar,
    officeLocation: draft.officeLocation.trim(),
    status,
    servingNoticeMuted: shouldMuteServingNotice(status, positionLevel),
    joiningDate: parseOptionalDate(draft.joiningDate),
    sourceName: name,
    sourceTitle: title,
    sourceAvatarUrl: avatar,
    overrideName: name,
    overrideTitle: title,
    overrideAvatarUrl: avatar,
    legalFullName: blankToNull(draft.legalFullName),
    employeeId: blankToNull(draft.employeeId),
    employmentRecord: blankToNull(draft.employmentRecord),
    positionLevel,
    officeCountry: blankToNull(draft.officeCountry),
    hiringCompany: blankToNull(draft.hiringCompany),
    hiredAt: parseOptionalDate(draft.hiredAt),
    resignationDate: parseOptionalDate(draft.resignationDate),
    lastWorkingDate: parseOptionalDate(draft.lastWorkingDate),
  };
}
