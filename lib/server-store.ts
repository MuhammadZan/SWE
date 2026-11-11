// File-backed key/value store for progress and whiteboards (server only).
// Each key is one JSON file in data/store/. Writes are atomic (tmp file + rename),
// and the first write of each key per day is snapshotted to data/backups/<date>/.
import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_DIR = path.join(DATA_DIR, "store");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const KEEP_BACKUP_DAYS = 14;

const KEY_RE = /^sej:[A-Za-z0-9:_-]{1,120}$/;

export function isValidKey(key: string) {
  return KEY_RE.test(key) && !key.startsWith("sej:theme");
}

const fileFor = (dir: string, key: string) => path.join(dir, `${key.replace(/:/g, "__")}.json`);
const keyFor = (file: string) => file.replace(/\.json$/, "").replace(/__/g, ":");

export async function readAll(): Promise<Record<string, string>> {
  let files: string[];
  try {
    files = await fs.readdir(STORE_DIR);
  } catch {
    return {};
  }
  const entries = await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => [keyFor(f), await fs.readFile(path.join(STORE_DIR, f), "utf8")] as const),
  );
  return Object.fromEntries(entries.filter(([k]) => isValidKey(k)));
}

async function snapshot(key: string) {
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(BACKUP_DIR, day);
  const target = fileFor(dir, key);
  try {
    await fs.access(target);
    return; // already snapshotted today
  } catch {}
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.copyFile(fileFor(STORE_DIR, key), target);
  } catch {
    return; // nothing to snapshot yet
  }
  await pruneBackups();
}

async function pruneBackups() {
  try {
    const days = (await fs.readdir(BACKUP_DIR)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    for (const d of days.slice(0, Math.max(0, days.length - KEEP_BACKUP_DAYS)))
      await fs.rm(path.join(BACKUP_DIR, d), { recursive: true, force: true });
  } catch {}
}

export async function writeKey(key: string, value: string) {
  JSON.parse(value); // reject anything that isn't JSON
  await fs.mkdir(STORE_DIR, { recursive: true });
  await snapshot(key);
  const file = fileFor(STORE_DIR, key);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, value, "utf8");
  await fs.rename(tmp, file);
}

export async function deleteKey(key: string) {
  await snapshot(key);
  await fs.rm(fileFor(STORE_DIR, key), { force: true });
}
