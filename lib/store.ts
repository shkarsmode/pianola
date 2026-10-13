/**
 * Song library in a private Vercel Blob store.
 *
 * `pianola/index.json` lists every song (status, title, file paths). It is read fresh from
 * origin and written with an ETag precondition, so the web app and the PC worker can both
 * update it without losing each other's changes. Audio and analysis files are private too;
 * the browser gets short-lived presigned URLs for them.
 */
import { BlobPreconditionFailedError, del, get, type IssuedSignedToken, issueSignedToken, presignUrl, put } from "@vercel/blob";
import type { SongMeta } from "./types";

export const INDEX_PATH = "pianola/index.json";

export interface StoredSong extends SongMeta {
  audioPath?: string;
  analysisPath?: string;
  uploadPath?: string;
}

export interface LibraryIndex {
  v: 1;
  songs: StoredSong[];
}

async function readJson<T>(pathname: string): Promise<{ data: T; etag: string } | null> {
  // identity encoding: a compressed response carries a weak ETag that ifMatch rejects
  const res = await get(pathname, { access: "private", useCache: false, headers: { "accept-encoding": "identity" } });
  if (!res || res.statusCode !== 200) return null;
  const text = await new Response(res.stream).text();
  return { data: JSON.parse(text) as T, etag: res.blob.etag.replace(/^W\//, "").replace(/"/g, "") };
}

export async function readIndex(): Promise<{ index: LibraryIndex; etag: string | null }> {
  const r = await readJson<LibraryIndex>(INDEX_PATH);
  return r ? { index: r.data, etag: r.etag } : { index: { v: 1, songs: [] }, etag: null };
}

/** Read-modify-write with an ETag check; retried when someone else wrote in between. */
export async function mutateIndex(fn: (index: LibraryIndex) => void): Promise<LibraryIndex> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { index, etag } = await readIndex();
    fn(index);
    try {
      await put(INDEX_PATH, JSON.stringify(index), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 60,
        ...(etag ? { ifMatch: etag } : {}),
      });
      return index;
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) {
        await new Promise((r) => setTimeout(r, 120 + Math.random() * 200));
        continue;
      }
      throw e;
    }
  }
  throw new Error("Бібліотека зайнята, спробуй ще раз");
}

let signer: { token: IssuedSignedToken; until: number } | null = null;

async function signingToken(): Promise<IssuedSignedToken> {
  if (!signer || signer.until - Date.now() < 2 * 3600e3) {
    const until = Date.now() + 24 * 3600e3;
    signer = { token: await issueSignedToken({ operations: ["get"], validUntil: until }), until };
  }
  return signer.token;
}

/** A GET URL for a private file, valid for `hours`. */
export async function signedUrl(pathname: string, hours = 12): Promise<string> {
  const token = await signingToken();
  const { presignedUrl } = await presignUrl(token, {
    operation: "get",
    pathname,
    access: "private",
    validUntil: Math.min(Date.now() + hours * 3600e3, signer!.until),
  });
  return presignedUrl;
}

export async function deleteFiles(paths: (string | undefined)[]) {
  const list = paths.filter((p): p is string => !!p);
  if (list.length) await del(list).catch(() => undefined);
}

/** What the browser may see of a song (no internal paths). */
export function publicMeta(s: StoredSong): SongMeta {
  const { audioPath: _a, analysisPath: _b, uploadPath: _c, ...rest } = s;
  void _a;
  void _b;
  void _c;
  return rest;
}
