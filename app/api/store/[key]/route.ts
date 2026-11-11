import { deleteKey, isValidKey, writeKey } from "@/lib/server-store";

export async function PUT(req: Request, ctx: RouteContext<"/api/store/[key]">) {
  const { key } = await ctx.params;
  if (!isValidKey(key)) return Response.json({ error: "invalid key" }, { status: 400 });
  const value = await req.text();
  try {
    await writeKey(key, value);
  } catch (e) {
    const status = e instanceof SyntaxError ? 400 : 500;
    return Response.json({ error: (e as Error).message }, { status });
  }
  return new Response(null, { status: 204 });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/store/[key]">) {
  const { key } = await ctx.params;
  if (!isValidKey(key)) return Response.json({ error: "invalid key" }, { status: 400 });
  await deleteKey(key);
  return new Response(null, { status: 204 });
}
