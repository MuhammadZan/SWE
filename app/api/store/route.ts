import { connection } from "next/server";
import { readAll } from "@/lib/server-store";

// Returns every stored key. Always read at request time, never prerendered.
export async function GET() {
  await connection();
  return Response.json({ entries: await readAll() }, { headers: { "Cache-Control": "no-store" } });
}
