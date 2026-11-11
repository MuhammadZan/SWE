"use client";

// Whiteboard persistence. Each board is stored under its own localStorage key;
// a small index keeps titles and timestamps for the Whiteboard page.
export type BoardMeta = { id: string; title: string; updatedAt: string; problemSlug?: string };
export type StoredScene = { elements: unknown[]; appState: Record<string, unknown>; files: Record<string, unknown> };

const INDEX_KEY = "sej:boards:index";
const sceneKey = (id: string) => `sej:board:${id}`;

export function listBoards(): BoardMeta[] {
  try {
    return (JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]") as BoardMeta[]).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  } catch {
    return [];
  }
}

function writeIndex(list: BoardMeta[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {}
}

export function upsertBoardMeta(meta: Omit<BoardMeta, "updatedAt">) {
  const list = listBoards().filter((b) => b.id !== meta.id);
  writeIndex([{ ...meta, updatedAt: new Date().toISOString() }, ...list]);
}

export function loadScene(id: string): StoredScene | null {
  try {
    const raw = localStorage.getItem(sceneKey(id));
    return raw ? (JSON.parse(raw) as StoredScene) : null;
  } catch {
    return null;
  }
}

/** Returns false if the browser refused the write (usually storage quota from large images). */
export function saveScene(id: string, scene: StoredScene): boolean {
  try {
    localStorage.setItem(sceneKey(id), JSON.stringify(scene));
    return true;
  } catch {
    return false;
  }
}

export function deleteBoard(id: string) {
  try {
    localStorage.removeItem(sceneKey(id));
  } catch {}
  writeIndex(listBoards().filter((b) => b.id !== id));
}

export function newBoardId() {
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
