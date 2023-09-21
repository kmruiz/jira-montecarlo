export async function buildInfo() {
  const { stdout } = Bun.spawnSync({
    cmd: ["git", "rev-parse", "HEAD"],
    stdout: "pipe",
  });

  const gitHash = stdout.toString().trim();
  const packageJson = JSON.parse(
    await Bun.file(`${import.meta.dir}/../../package.json`).text()
  );

  return {
    git: gitHash,
    version: packageJson.version,
    bun: {
      version: Bun.version,
      git: Bun.revision,
    },
  };
}
