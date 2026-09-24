import type { AuditEvent } from "./format";

export type AuditActorOption = {
  authId: string;
  name: string;
  email: string | null;
};

export type AuditOpOption = {
  op: string;
  label: string;
};

export type AuditPageData = {
  rows: AuditEvent[];
  total: number;
  page: number;
  pageCount: number;
};
