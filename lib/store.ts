"use client";

// Durable client storage. The source of truth is data/store/*.json on disk, written via
// /api/store. localStorage is a synchronous cache so the UI can read instantly.
//
// Writes go to localStorage first and are marked "dirty" until the server confirms them,
// so nothing is lost if the dev server is down: dirty keys are re-sent on the next load.

const DIRTY_KEY = "sej:__dirty";
const LOCAL_ONLY = new Set(["sej:theme", DIRTY_KEY]);
const SYNC_EVENT = "sej:synced";

export type SyncStatus = "loading" | "synced" | "saving" | "offline";

let status: SyncStatus = "loading";
const statusListeners = new Set<() => void>();
function setStatus(s: SyncStatus) {
  if (s === status) return;
  status = s;
  statusListeners.forEach((l) => l());
}
export const syncStatus = {
  get: () => status,
  subscribe(l: () => void) {
    statusListeners.add(l);
    return () => statusListeners.delete(l);
  },
};

// ---------- local cache helpers ----------

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false; // quota: the server write below still persists it
  }
}
function lsRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}
function persistedLocalKeys() {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith("sej:") && !LOCAL_ONLY.has(k)) keys.push(k);
    }
  } catch {}
  return keys;
}

// Keys with local changes the server hasn't confirmed yet. Survives reloads.
type Dirty = Record<string, true>;
function readDirty(): Dirty {
  try {
    return JSON.parse(lsGet(DIRTY_KEY) ?? "{}") as Dirty;
  } catch {
    return {};
  }
}
function writeDirty(d: Dirty) {
  lsSet(DIRTY_KEY, JSON.stringify(d));
}

// In-memory values for keys too big for localStorage (large whiteboards).
const memory = new Map<string, string>();

// ---------- server sync ----------

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inflight = new Set<Promise<unknown>>();
const retryDelay = new Map<string, number>();

async function send(key: string) {
  const value = memory.get(key) ?? lsGet(key);
  const url = `/api/store/${encodeURIComponent(key)}`;
  const res = await fetch(url, value === null ? { method: "DELETE" } : { method: "PUT", body: value });
  if (!res.ok) throw new Error(`store ${res.status}`);
}

function schedule(key: string, delay = 400) {
  clearTimeout(timers.get(key));
  setStatus("saving");
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      const p = send(key)
        .then(() => {
          const d = readDirty();
          delete d[key];
          writeDirty(d);
          retryDelay.delete(key);
          if (timers.size === 0 && Object.keys(readDirty()).length === 0) setStatus("synced");
        })
        .catch(() => {
          setStatus("offline");
          const next = Math.min((retryDelay.get(key) ?? 1000) * 2, 30000);
          retryDelay.set(key, next);
          schedule(key, next);
        })
        .finally(() => inflight.delete(p));
      inflight.add(p);
    }, delay),
  );
}

/** Wait until every pending write has been attempted. */
export async function flush() {
  for (const [key, t] of timers) {
    clearTimeout(t);
    timers.delete(key);
    try {
      await send(key);
      const d = readDirty();
      delete d[key];
      writeDirty(d);
    } catch {
      schedule(key, 2000);
    }
  }
  await Promise.all([...inflight]);
}

// ---------- public API ----------

export function getItem(key: string): string | null {
  return memory.get(key) ?? lsGet(key);
}

export function setItem(key: string, value: string) {
  if (!lsSet(key, value)) memory.set(key, value);
  else memory.delete(key);
  writeDirty({ ...readDirty(), [key]: true });
  schedule(key);
}

export function removeItem(key: string) {
  lsRemove(key);
  memory.delete(key);
  writeDirty({ ...readDirty(), [key]: true });
  schedule(key, 0);
}

/** Keys currently stored (local cache view), excluding local-only settings. */
export function keys() {
  return [...new Set([...persistedLocalKeys(), ...memory.keys()])];
}

let ready: Promise<void> | null = null;

/**
 * Loads the on-disk store into the local cache once per page load.
 * - Keys with unsent local changes win and are re-sent.
 * - If the disk store is empty but this browser has data (first run after the upgrade),
 *   the browser's data is uploaded so existing progress is kept.
 */
export function initStore(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  ready ??= (async () => {
    try {
      const res = await fetch("/api/store", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const { entries } = (await res.json()) as { entries: Record<string, string> };
      const dirty = readDirty();
      const serverKeys = Object.keys(entries);

      if (serverKeys.length === 0) {
        const local = persistedLocalKeys();
        writeDirty({ ...dirty, ...Object.fromEntries(local.map((k) => [k, true as const])) });
        for (const k of local) schedule(k, 0);
      } else {
        for (const [k, v] of Object.entries(entries)) {
          if (dirty[k]) continue;
          if (!lsSet(k, v)) memory.set(k, v);
        }
        // Drop cached keys the server no longer has (deleted elsewhere), unless unsent here.
        for (const k of persistedLocalKeys()) if (!(k in entries) && !dirty[k]) lsRemove(k);
        for (const k of Object.keys(dirty)) schedule(k, 0);
      }
      if (timers.size === 0) setStatus("synced");
      try {
        await navigator.storage?.persist?.();
      } catch {}
    } catch {
      setStatus("offline"); // keep working from the local cache
    }
    window.dispatchEvent(new Event(SYNC_EVENT));
    window.addEventListener("pagehide", () => {
      for (const [key, t] of timers) {
        clearTimeout(t);
        const value = getItem(key);
        if (value !== null && value.length < 60_000)
          void fetch(`/api/store/${encodeURIComponent(key)}`, { method: "PUT", body: value, keepalive: true });
      }
    });
  })();
  return ready;
}

/** Subscribe to "the disk store was loaded into the cache". */
export function onSynced(cb: () => void) {
  window.addEventListener(SYNC_EVENT, cb);
  return () => window.removeEventListener(SYNC_EVENT, cb);
}
