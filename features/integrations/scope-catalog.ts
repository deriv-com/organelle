/**
 * Integrations scope documentation.
 * Single source for docs UI and create-form labels.
 */

import { PRODUCTION_APP_BASE_URL, STRUCTURE_HEADERS_PATH } from "./app-base-url";
import { STRUCTURE_HEADERS_READ, type IntegrationScope } from "./scopes";

export type ScopeDoc = {
  id: IntegrationScope;
  title: string;
  summary: string;
  method: "GET";
  path: string;
  productionUrl: string;
  requiredScope: IntegrationScope;
  requestExample: string;
  responseExample: string;
  responseNotes: string[];
};

const STRUCTURE_HEADERS_RESPONSE = `{
  "tree": {
    "name": "v12",
    "level": "root",
    "children": [
      {
        "name": "Engineering",
        "level": "department",
        "children": [
          {
            "name": "Platform",
            "level": "team_level_1",
            "children": [
              { "name": "Infra", "level": "team_level_2", "children": [] }
            ]
          }
        ]
      }
    ]
  }
}`;

export const SCOPE_CATALOG: readonly ScopeDoc[] = [
  {
    id: STRUCTURE_HEADERS_READ,
    title: "Published header tree",
    summary: "Nested department and team headers from the live published org chart.",
    method: "GET",
    path: STRUCTURE_HEADERS_PATH,
    productionUrl: `${PRODUCTION_APP_BASE_URL}${STRUCTURE_HEADERS_PATH}`,
    requiredScope: STRUCTURE_HEADERS_READ,
    requestExample: `curl -sS \\
  -H "Authorization: Bearer <api_key>" \\
  "${PRODUCTION_APP_BASE_URL}${STRUCTURE_HEADERS_PATH}"`,
    responseExample: STRUCTURE_HEADERS_RESPONSE,
    responseNotes: [
      "Headers only: name, level, children. No seats, employees, or node ids.",
      "Levels: root → department → team_level_1 → team_level_2 → …",
      "Sibling order matches the published chart (sort_order).",
      "When the chart root is the Publisher seat, tree.name is v{version_seq} and children are top-level departments.",
    ],
  },
] as const;

export function getScopeDoc(scope: IntegrationScope): ScopeDoc | undefined {
  return SCOPE_CATALOG.find((entry) => entry.id === scope);
}
