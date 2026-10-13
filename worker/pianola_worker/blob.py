"""Minimal client for the private Vercel Blob store (same HTTP API the @vercel/blob SDK uses)."""
import json
import time
from urllib.parse import quote

import requests

API = "https://vercel.com/api/blob"
API_VERSION = "12"


class PreconditionFailed(Exception):
    pass


class BlobError(Exception):
    pass


class Blob:
    def __init__(self, token: str):
        if not token.startswith("vercel_blob_rw_"):
            raise ValueError("BLOB_READ_WRITE_TOKEN is missing or malformed")
        self.token = token
        self.store_id = token.split("_")[3]
        self.http = requests.Session()

    def _headers(self, extra: dict | None = None) -> dict:
        h = {
            "authorization": f"Bearer {self.token}",
            "x-api-version": API_VERSION,
            "x-vercel-blob-store-id": self.store_id,
        }
        if extra:
            h.update(extra)
        return h

    @staticmethod
    def _raise(r: requests.Response) -> None:
        if r.ok:
            return
        code, message = "unknown_error", r.text[:300]
        try:
            err = r.json().get("error", {})
            code, message = err.get("code", code), err.get("message", message)
        except ValueError:
            pass
        if code == "precondition_failed" or r.status_code == 412:
            raise PreconditionFailed(message)
        raise BlobError(f"{r.status_code} {code}: {message}")

    def put(self, pathname: str, data: bytes, content_type: str, *, random_suffix: bool = False,
            overwrite: bool = True, if_match: str | None = None, cache_max_age: int | None = None) -> dict:
        h = {
            "x-vercel-blob-access": "private",
            "x-add-random-suffix": "1" if random_suffix else "0",
            "x-allow-overwrite": "1" if overwrite else "0",
            "x-content-type": content_type,
        }
        if if_match:
            h["x-if-match"] = if_match
        if cache_max_age is not None:
            h["x-cache-control-max-age"] = str(cache_max_age)
        for attempt in range(4):
            try:
                r = self.http.put(f"{API}/?pathname={quote(pathname)}", data=data,
                                  headers=self._headers(h), timeout=300)
            except requests.RequestException:
                if attempt == 3:
                    raise
                time.sleep(1.5 * (attempt + 1))
                continue
            if r.status_code >= 500 and attempt < 3:
                time.sleep(1.5 * (attempt + 1))
                continue
            self._raise(r)
            return r.json()
        raise BlobError("put failed")

    def object_url(self, pathname_or_url: str) -> str:
        if pathname_or_url.startswith("https://"):
            return pathname_or_url
        return f"https://{self.store_id.lower()}.private.blob.vercel-storage.com/{quote(pathname_or_url)}"

    def get(self, pathname_or_url: str, fresh: bool = True) -> tuple[bytes, str] | None:
        url = self.object_url(pathname_or_url) + ("?cache=0" if fresh else "")
        # identity encoding: a compressed response carries a weak ETag that x-if-match rejects
        r = self.http.get(url, headers={"authorization": f"Bearer {self.token}", "accept-encoding": "identity"},
                          timeout=120)
        if r.status_code == 404:
            return None
        self._raise(r)
        etag = r.headers.get("etag", "")
        if etag.startswith("W/"):
            etag = etag[2:]
        return r.content, etag.strip('"')

    def download(self, pathname_or_url: str, dest) -> None:
        url = self.object_url(pathname_or_url)
        with self.http.get(url, headers={"authorization": f"Bearer {self.token}"}, stream=True, timeout=300) as r:
            self._raise(r)
            with open(dest, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)

    def delete(self, paths: list[str]) -> None:
        paths = [p for p in paths if p]
        if not paths:
            return
        urls = [self.object_url(p) for p in paths]
        r = self.http.post(f"{API}/delete", data=json.dumps({"urls": urls}),
                           headers=self._headers({"content-type": "application/json"}), timeout=60)
        self._raise(r)
