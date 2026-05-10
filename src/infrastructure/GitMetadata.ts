export interface GitMetadata {
  gitSha?: string;
  gitDirty: boolean;
}

export function getGitMetadata(): GitMetadata {
  const sha = runGit(["rev-parse", "--short", "HEAD"]);
  const status = runGit(["status", "--porcelain"]);
  return {
    gitSha: sha === "" ? undefined : sha,
    gitDirty: status !== "",
  };
}

function runGit(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "ignore" });
  if (!result.success) {
    return "";
  }
  return new TextDecoder().decode(result.stdout).trim();
}
