import { readFile } from "node:fs/promises";

const lockUrls = [
  new URL("../package-lock.json", import.meta.url),
  new URL("db/package-lock.json", import.meta.url),
];
const reviewed = new Set([
  "0BSD",
  "Apache-2.0",
  "Apache-2.0 AND LGPL-3.0-or-later",
  "Apache-2.0 AND LGPL-3.0-or-later AND MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "LGPL-3.0-or-later",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
  "WTFPL",
]);
const rejected = [];
let packageCount = 0;
for (const lockUrl of lockUrls) {
  const lock = JSON.parse(await readFile(lockUrl, "utf8"));
  for (const [path, metadata] of Object.entries(lock.packages ?? {})) {
    if (!path) continue;
    packageCount++;
    const license = metadata.license;
    if (typeof license !== "string" || !reviewed.has(license)) {
      rejected.push(`${path}: ${license ?? "missing license"}`);
    }
  }
}
if (rejected.length) {
  console.error(`Unreviewed dependency licenses:\n${rejected.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Reviewed license metadata for ${packageCount} packages`);
}
