import { execFileSync } from "node:child_process";
import { readFile, lstat } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();

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

const findings = new Set<string>();
const containsPrivate = (value: string) =>
  privatePatterns.some((pattern) => pattern.test(value));
const safeName = (name: string) => (containsPrivate(name) ? "[redacted path]" : name);
function inspect(name: string, contents: string) {
  const label = safeName(name);
  if (containsPrivate(name)) findings.add(`${label}: configured private path`);
  if (containsPrivate(contents)) findings.add(`${label}: configured private reference`);
  if (/\barn:[a-z][a-z0-9-]*:/i.test(contents))
    findings.add(`${label}: cloud account ARN`);
  if (/https?:\/\/[^\s"')]*\.(?:internal|corp)(?:[/:]|$)/i.test(contents))
    findings.add(`${label}: private hostname`);
}
const git = (args: string[]) =>
  execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
// Index blobs remain publication candidates even after unstaged edits or deletion.
const staged = git(["ls-files", "--stage", "-z"])
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
for (const entry of staged) {
  const tab = entry.indexOf("\t");
  const [mode, oid, stage] = entry.slice(0, tab).split(" ");
  const name = entry.slice(tab + 1);
  if (stage !== "0" || mode === "160000") {
    findings.add(`${safeName(name)}: unresolved index entry requires review`);
    continue;
  }
  if (mode === "120000")
    findings.add(`${safeName(name)}: symbolic link requires review`);
  inspect(name, git(["cat-file", "blob", oid]).toString("utf8"));
}
// No extension allowlist: custom configuration and binary content are inspected too.
const files = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
for (const name of new Set(files)) {
  inspect(name, "");
  const path = join(root, name);
  const metadata = await lstat(path).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!metadata) continue;
  if (metadata.isSymbolicLink()) {
    findings.add(`${safeName(name)}: symbolic link requires review`);
    continue;
  }
  if (metadata.isFile()) inspect(name, (await readFile(path)).toString("utf8"));
}
if (findings.size) {
  console.error([...findings].join("\n"));
  process.exitCode = 1;
} else {
  console.log("Public reference check passed");
}
