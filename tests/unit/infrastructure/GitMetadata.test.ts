import { afterEach, describe, expect, test } from "bun:test";

import { getGitMetadata } from "../../../src/infrastructure/GitMetadata.ts";

describe("getGitMetadata", () => {
  const previousSpawnSync = Bun.spawnSync;

  afterEach(() => {
    Bun.spawnSync = previousSpawnSync;
  });

  test("does not throw when git is not available in the runtime image", () => {
    Bun.spawnSync = () => {
      throw new Error('Executable not found in $PATH: "git"');
    };

    expect(() => getGitMetadata()).not.toThrow();
    expect(getGitMetadata()).toEqual({
      gitSha: undefined,
      gitDirty: false,
    });
  });
});
