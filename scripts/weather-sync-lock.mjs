import { promises as fs } from "node:fs";

export function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export async function acquireWeatherSyncLock(lockPath, now = new Date()) {
  try {
    const handle = await fs.open(lockPath, "wx");
    const owner = { pid: process.pid, startedAt: now.toISOString() };
    await handle.writeFile(`${JSON.stringify(owner)}\n`);
    return { handle, owner, recovered: null };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }

  let previous;
  try {
    previous = JSON.parse(await fs.readFile(lockPath, "utf8"));
  } catch {
    previous = { pid: null, startedAt: null, invalid: true };
  }
  if (processIsAlive(Number(previous.pid))) {
    throw new Error(`Another live weather sync is active (pid ${previous.pid}).`);
  }

  await fs.unlink(lockPath);
  const handle = await fs.open(lockPath, "wx");
  const owner = { pid: process.pid, startedAt: now.toISOString() };
  await handle.writeFile(`${JSON.stringify(owner)}\n`);
  return { handle, owner, recovered: previous };
}

export async function releaseWeatherSyncLock(lockPath, lock) {
  await lock.handle.close();
  const current = JSON.parse(await fs.readFile(lockPath, "utf8").catch(() => "{}"));
  if (current.pid === lock.owner.pid && current.startedAt === lock.owner.startedAt) {
    await fs.unlink(lockPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}
