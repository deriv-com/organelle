import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
it.each(["settings.toml", "config.custom", "Dockerfile"])(
  "scans tracked %s without printing private values",
  (filename) => {
    const root = mkdtempSync(join(tmpdir(), "organelle-public-scan-"));
    execFileSync("git", ["init", "--quiet", root]);
    writeFileSync(join(root, filename), "example-private-marker");
    execFileSync("git", ["-C", root, "add", filename]);
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        resolve("node_modules/tsx/dist/loader.mjs"),
        resolve("scripts/check-public-references.ts"),
      ],
      {
        cwd: root,
        env: { ...process.env, PUBLIC_REFERENCE_DENYLIST: "example-private-marker" },
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(filename);
    expect(result.stderr).not.toContain("example-private-marker");
  },
);

function runScan(root: string) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      resolve("node_modules/tsx/dist/loader.mjs"),
      resolve("scripts/check-public-references.ts"),
    ],
    {
      cwd: root,
      env: { ...process.env, PUBLIC_REFERENCE_DENYLIST: "example-private-marker" },
      encoding: "utf8",
    },
  );
}
it.each(["edited", "deleted"])(
  "rejects staged private data after the working file is %s",
  (state) => {
    const root = mkdtempSync(join(tmpdir(), "organelle-public-index-"));
    execFileSync("git", ["init", "--quiet", root]);
    const file = join(root, "settings.custom");
    writeFileSync(file, "example-private-marker");
    execFileSync("git", ["-C", root, "add", "settings.custom"]);
    if (state === "edited") writeFileSync(file, "public example");
    else unlinkSync(file);
    const result = runScan(root);
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("example-private-marker");
  },
);
it("rejects and redacts a private filename even when its content is harmless", () => {
  const root = mkdtempSync(join(tmpdir(), "organelle-public-path-"));
  execFileSync("git", ["init", "--quiet", root]);
  writeFileSync(join(root, "example-private-marker.custom"), "public example");
  execFileSync("git", ["-C", root, "add", "."]);
  const result = runScan(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("configured private path");
  expect(result.stderr).not.toContain("example-private-marker");
});
