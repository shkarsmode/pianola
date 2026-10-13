"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SongMeta } from "@/lib/types";
import { IconDots, IconLogo, IconLogout, IconPencil, IconPin, IconPlus, IconRetry, IconSearch, IconSidebar, IconTrash } from "./Icons";
import { STAGE_LABEL, useLibrary } from "./SongsProvider";

function groupOf(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  if (diff <= 0) return "Сьогодні";
  if (diff === 1) return "Вчора";
  if (diff < 7) return "Цього тижня";
  if (diff < 31) return "Цього місяця";
  return "Раніше";
}

const fmtDur = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");

function SongItem({ song, active, onNavigate }: { song: SongMeta; active: boolean; onNavigate: () => void }) {
  const { worker, rename, remove, retry, pin } = useLibrary();
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [title, setTitle] = useState(song.title);
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenu(false);
        setConfirm(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  const current = worker.current?.id === song.id ? worker.current : null;
  let sub = "";
  if (song.status === "ready") sub = [song.key, fmtDur(song.duration)].filter(Boolean).join(" · ");
  else if (song.status === "error") sub = "Не вдалося";
  else if (current) sub = `${STAGE_LABEL[current.stage] ?? "Обробка"} · ${Math.round(current.progress * 100)}%`;
  else sub = worker.online ? "У черзі" : "Чекає на ПК";

  if (editing) {
    return (
      <form
        className="px-2 py-1"
        onSubmit={(e) => {
          e.preventDefault();
          setEditing(false);
          if (title.trim() && title !== song.title) void rename(song.id, title);
        }}
      >
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (title.trim() && title !== song.title) void rename(song.id, title);
          }}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          className="h-9 w-full rounded-lg border border-ink bg-card px-2.5 text-sm outline-none"
        />
      </form>
    );
  }

  return (
    <div className={`group relative rounded-lg ${active ? "bg-hover" : "hover:bg-hover/70"}`}>
      <Link href={`/song/${song.id}`} onClick={onNavigate} className="block px-2.5 py-2 pr-9">
        <div className="flex items-center gap-1.5">
          {song.pinned && <IconPin size={12} className="shrink-0 text-faint" />}
          <span className="truncate text-[13.5px] leading-5 text-ink">{song.title}</span>
        </div>
        <div className={`truncate text-[11.5px] leading-4 ${song.status === "error" ? "text-danger" : "text-faint"}`}>
          {song.status !== "ready" && song.status !== "error" && (
            <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${current ? "bg-accent" : "bg-line-2"}`} />
          )}
          {sub}
        </div>
      </Link>
      <div ref={menuRef} className="absolute top-1.5 right-1">
        <button
          aria-label="Дії"
          onClick={() => setMenu((m) => !m)}
          className={`grid h-7 w-7 place-items-center rounded-md text-mute hover:bg-line ${menu ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100"}`}
        >
          <IconDots size={16} />
        </button>
        {menu && (
          <div className="pop-in absolute right-0 z-30 mt-1 w-48 rounded-xl border border-line bg-card p-1 shadow-[var(--shadow-pop)]">
            {confirm ? (
              <div className="p-2">
                <p className="mb-2 text-[13px]">Видалити «{song.title}»?</p>
                <div className="flex gap-1.5">
                  <button
                    className="h-8 flex-1 rounded-lg bg-danger text-[13px] font-medium text-white"
                    onClick={() => {
                      setMenu(false);
                      void remove(song.id);
                      if (active) router.push("/");
                    }}
                  >
                    Видалити
                  </button>
                  <button className="h-8 flex-1 rounded-lg bg-hover text-[13px]" onClick={() => setConfirm(false)}>
                    Ні
                  </button>
                </div>
              </div>
            ) : (
              <>
                <MenuItem icon={<IconPencil size={15} />} onClick={() => (setMenu(false), setEditing(true))}>
                  Перейменувати
                </MenuItem>
                <MenuItem icon={<IconPin size={15} />} onClick={() => (setMenu(false), void pin(song.id, !song.pinned))}>
                  {song.pinned ? "Відкріпити" : "Закріпити"}
                </MenuItem>
                {(song.status === "error" || song.status === "ready") && (
                  <MenuItem icon={<IconRetry size={15} />} onClick={() => (setMenu(false), void retry(song.id))}>
                    Обробити заново
                  </MenuItem>
                )}
                <MenuItem icon={<IconTrash size={15} />} danger onClick={() => setConfirm(true)}>
                  Видалити
                </MenuItem>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] hover:bg-hover ${danger ? "text-danger" : "text-ink"}`}
    >
      {icon}
      {children}
    </button>
  );
}

export function Sidebar({ onClose, onNavigate }: { onClose: () => void; onNavigate: () => void }) {
  const { songs, loaded, worker } = useLibrary();
  const [q, setQ] = useState("");
  const pathname = usePathname();
  const activeId = pathname.startsWith("/song/") ? pathname.split("/")[2] : null;

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? songs.filter((s) => s.title.toLowerCase().includes(needle)) : songs;
    const out: [string, SongMeta[]][] = [];
    const pinned = list.filter((s) => s.pinned);
    if (pinned.length) out.push(["Закріплені", pinned]);
    for (const s of list.filter((x) => !x.pinned)) {
      const g = groupOf(s.createdAt);
      const last = out[out.length - 1];
      if (last && last[0] === g) last[1].push(s);
      else out.push([g, [s]]);
    }
    return out;
  }, [songs, q]);

  return (
    <aside className="flex h-full w-[272px] flex-col border-r border-line bg-paper">
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <Link href="/" onClick={onNavigate} className="flex items-center gap-2 px-1">
          <IconLogo size={24} />
          <span className="text-[17px] font-semibold tracking-tight">Pianola</span>
        </Link>
        <button aria-label="Сховати панель" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-mute hover:bg-hover">
          <IconSidebar />
        </button>
      </div>
      <div className="px-3">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex h-10 items-center gap-2 rounded-xl bg-ink px-3 text-[14px] font-medium text-white hover:bg-ink-2"
        >
          <IconPlus size={17} />
          Нова пісня
        </Link>
        <label className="mt-2.5 flex h-9 items-center gap-2 rounded-xl border border-line bg-card px-2.5 text-mute focus-within:border-line-2">
          <IconSearch size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Пошук"
            className="h-full w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-faint"
          />
        </label>
      </div>
      <nav className="no-scrollbar mt-3 flex-1 overflow-y-auto px-2 pb-4">
        {loaded && !songs.length && <p className="px-3 py-6 text-[13px] leading-5 text-faint">Тут з’являться твої пісні. Почни з «Нова пісня».</p>}
        {groups.map(([title, list]) => (
          <section key={title} className="mb-3">
            <h3 className="px-2.5 pt-2 pb-1 text-[11.5px] font-medium tracking-wide text-faint uppercase">{title}</h3>
            {list.map((s) => (
              <SongItem key={s.id} song={s} active={s.id === activeId} onNavigate={onNavigate} />
            ))}
          </section>
        ))}
      </nav>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-4 py-3">
        <div className="min-w-0 text-[12px] leading-4">
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${worker.online ? "bg-lh" : "bg-line-2"}`} />
            <span className={worker.online ? "text-ink-2" : "text-mute"}>{worker.online ? "Обробник на ПК онлайн" : worker.known ? "ПК вимкнений" : "Перевіряю ПК…"}</span>
          </div>
          {!worker.online && worker.known && <div className="mt-0.5 truncate text-faint">Нові пісні почекають у черзі</div>}
        </div>
        <button
          aria-label="Вийти"
          title="Вийти"
          onClick={async () => {
            await fetch("/api/login", { method: "DELETE" });
            location.replace("/login");
          }}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-mute hover:bg-hover"
        >
          <IconLogout size={17} />
        </button>
      </div>
    </aside>
  );
}
