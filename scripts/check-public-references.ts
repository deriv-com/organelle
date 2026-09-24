import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([".git", ".next", "node_modules", "coverage"]);
const ignoredFiles = new Set(["public/icon.png"]);
const textExtensions = new Set([
  "",
  ".cjs",
  ".css",
  ".csv",
  ".dockerignore",
  ".example",
  ".gitignore",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml",
]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Deployment owners can supply a newline-delimited private denylist as a CI secret.
// Keep the values out of source control and never include them in scanner output.
const privatePatterns = (process.env.PUBLIC_REFERENCE_DENYLIST ?? "")
  .split(/\r?\n/)
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => new RegExp(escapeRegex(value).split(/\s+/).join("\\s+"), "i"));

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const findings: string[] = [];
for (const path of await filesUnder(root)) {
  const name = relative(root, path);
  if (ignoredFiles.has(name) || !textExtensions.has(extname(path))) continue;
  const contents = await readFile(path, "utf8");
  for (const pattern of privatePatterns) {
    if (pattern.test(contents)) {
      findings.push(`${name}: configured private reference`);
    }
  }
  if (/\barn:[a-z][a-z0-9-]*:/i.test(contents))
    findings.push(`${name}: cloud account ARN`);
  if (/https?:\/\/[^\s"')]*\.(?:internal|corp)(?:[/:]|$)/i.test(contents)) {
    findings.push(`${name}: private hostname`);
  }
}

if (findings.length) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Public reference check passed");
}
