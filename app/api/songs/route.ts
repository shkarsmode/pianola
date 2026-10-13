import { NextResponse } from "next/server";
import { mutateIndex, publicMeta, readIndex, type StoredSong } from "@/lib/store";

export async function GET() {
  const { index } = await readIndex();
  const songs = [...index.songs].sort((a, b) => b.createdAt - a.createdAt).map(publicMeta);
  return NextResponse.json({ songs });
}

function newId(): string {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

function titleFromUrl(url: URL): string {
  const host = url.hostname.replace(/^www\./, "");
  if (host.includes("youtu")) return "Пісня з YouTube";
  if (host.includes("instagram")) return "Пісня з Instagram";
  if (host.includes("tiktok")) return "Пісня з TikTok";
  return `Пісня з ${host}`;
}

/** New song from a link ({url}) or from an uploaded/recorded file ({uploadPath, filename, kind}). */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    url?: string;
    uploadPath?: string;
    filename?: string;
    kind?: "upload" | "record";
  };
  const now = Date.now();
  let song: StoredSong;
  if (body.url) {
    let url: URL;
    try {
      url = new URL(body.url.trim());
      if (!/^https?:$/.test(url.protocol)) throw new Error();
    } catch {
      return NextResponse.json({ error: "Це не схоже на посилання" }, { status: 400 });
    }
    song = {
      id: newId(),
      title: titleFromUrl(url),
      createdAt: now,
      updatedAt: now,
      status: "queued",
      source: { kind: "url", url: url.toString() },
    };
  } else if (body.uploadPath) {
    const name = (body.filename ?? "Запис").replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 120) || "Запис";
    song = {
      id: newId(),
      title: name,
      createdAt: now,
      updatedAt: now,
      status: "queued",
      source: { kind: body.kind ?? "upload", filename: body.filename },
      uploadPath: body.uploadPath,
    };
  } else {
    return NextResponse.json({ error: "Потрібне посилання або файл" }, { status: 400 });
  }
  await mutateIndex((idx) => {
    idx.songs.push(song);
  });
  return NextResponse.json({ song: publicMeta(song) });
}
