import "server-only";

import { buildChart } from "@/features/chart/chart-row";
import { fetchPublishedTreeMetadata, fetchTreeRows } from "@/features/chart/tree-query";

import { buildSeatExportRows, formatSeatExportCsv } from "./seat-export";

export async function buildPublishedSeatExportCsv(): Promise<string> {
  const meta = await fetchPublishedTreeMetadata();
  const { rows } = buildChart(await fetchTreeRows(meta.treeId));
  return formatSeatExportCsv(buildSeatExportRows(rows));
}
