"use client";

import { useState } from "react";
import { IconLogo } from "@/components/Icons";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim() || busy) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      const next = new URLSearchParams(location.search).get("next");
      location.replace(next && next.startsWith("/") ? next : "/");
      return;
    }
    setBusy(false);
    setError("Невірний пароль");
  }

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-16">
      <form onSubmit={submit} className="pop-in w-full max-w-[340px]">
        <div className="mb-8 flex items-center gap-2.5">
          <IconLogo size={30} />
          <span className="text-[22px] font-semibold tracking-tight">Pianola</span>
        </div>
        <label className="mb-2 block text-sm text-mute" htmlFor="pw">
          Пароль
        </label>
        <input
          id="pw"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-11 w-full rounded-xl border border-line-2 bg-card px-3.5 text-[15px] outline-none transition-colors focus:border-ink"
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 h-11 w-full rounded-xl bg-ink text-[15px] font-medium text-white transition-opacity disabled:opacity-60"
        >
          {busy ? "Входжу…" : "Увійти"}
        </button>
      </form>
    </main>
  );
}
