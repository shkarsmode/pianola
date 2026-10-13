import { NextResponse } from "next/server";
import { deleteFiles, mutateIndex, publicMeta, readIndex, signedUrl, type StoredSong } from "@/lib/store";

export async function GET(_req: Request, ctx: RouteContext<"/api/songs/[id]">) {
  const { id } = await ctx.params;
  const { index } = await readIndex();
  const song = index.songs.find((s) => s.id === id);
  if (!song) return NextResponse.json({ error: "Пісню не знайдено" }, { status: 404 });
  const [audioUrl, analysisUrl] = await Promise.all([
    song.audioPath ? signedUrl(song.audioPath) : undefined,
    song.analysisPath ? signedUrl(song.analysisPath) : undefined,
  ]);
  return NextResponse.json({ song: { ...publicMeta(song), audioUrl, analysisUrl } });
}

/** Rename, pin, or send a failed song back to the queue. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/songs/[id]">) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { title?: string; pinned?: boolean; retry?: boolean };
  let found: StoredSong | undefined;
  await mutateIndex((idx) => {
    const s = idx.songs.find((x) => x.id === id);
    if (!s) return;
    if (typeof body.title === "string" && body.title.trim()) s.title = body.title.trim().slice(0, 160);
    if (typeof body.pinned === "boolean") s.pinned = body.pinned;
    if (body.retry && (s.status === "error" || s.status === "ready")) {
      s.status = "queued";
      s.error = undefined;
    }
    s.updatedAt = Date.now();
    found = s;
  });
  if (!found) return NextResponse.json({ error: "Пісню не знайдено" }, { status: 404 });
  return NextResponse.json({ song: publicMeta(found) });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/songs/[id]">) {
  const { id } = await ctx.params;
  let removed: StoredSong | undefined;
  await mutateIndex((idx) => {
    removed = idx.songs.find((s) => s.id === id);
    idx.songs = idx.songs.filter((s) => s.id !== id);
  });
  if (removed) await deleteFiles([removed.audioPath, removed.analysisPath, removed.uploadPath]);
  return NextResponse.json({ ok: true });
}
