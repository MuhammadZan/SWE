// Parses every ```mermaid block in the given markdown files (default: all content) and reports syntax errors.
// Usage: node scripts/validate-mermaid.mjs [files...]
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const k of ["DOMParser", "Element", "HTMLElement", "Node", "navigator", "getComputedStyle"])
  if (!(k in globalThis)) Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true });

const { default: mermaid } = await import("mermaid");
mermaid.initialize({ startOnLoad: false });

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".md") ? [path.join(dir, e.name)] : [],
  );
}

const files = process.argv.length > 2 ? process.argv.slice(2) : walk(path.join(process.cwd(), "content"));
let total = 0, bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const re = /^```mermaid\n([\s\S]*?)^```/gm;
  let m;
  while ((m = re.exec(src))) {
    total++;
    const line = src.slice(0, m.index).split("\n").length;
    try {
      await mermaid.parse(m[1]);
    } catch (e) {
      bad++;
      console.log(`FAIL ${path.relative(process.cwd(), f)}:${line}\n  ${String(e.message ?? e).split("\n").slice(0, 3).join("\n  ")}`);
    }
  }
}
console.log(`${total} mermaid blocks, ${bad} failing`);
process.exit(bad ? 1 : 0);
