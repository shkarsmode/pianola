"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { IconSidebar } from "./Icons";
import { Sidebar } from "./Sidebar";
import { SongsProvider } from "./SongsProvider";

interface ShellCtx {
  sidebarOpen: boolean;
  openSidebar: () => void;
}

const Ctx = createContext<ShellCtx>({ sidebarOpen: true, openSidebar: () => {} });
export const useShell = () => useContext(Ctx);

/** The button that brings the sidebar back when it is hidden. */
export function SidebarButton() {
  const { sidebarOpen, openSidebar } = useShell();
  if (sidebarOpen) return null;
  return (
    <button aria-label="Показати панель" onClick={openSidebar} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-mute hover:bg-hover">
      <IconSidebar />
    </button>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px), (max-height: 520px)");
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    try {
      if (localStorage.getItem("pianola:sidebar") === "closed") setDesktopOpen(false);
    } catch {
      /* storage unavailable */
    }
    return () => mq.removeEventListener("change", apply);
  }, []);

  const setDesktop = useCallback((open: boolean) => {
    setDesktopOpen(open);
    try {
      localStorage.setItem("pianola:sidebar", open ? "open" : "closed");
    } catch {
      /* storage unavailable */
    }
  }, []);

  const open = mobile ? mobileOpen : desktopOpen;
  const ctx: ShellCtx = {
    sidebarOpen: open,
    openSidebar: () => (mobile ? setMobileOpen(true) : setDesktop(true)),
  };

  return (
    <SongsProvider>
      <Ctx.Provider value={ctx}>
        <div className="flex h-dvh overflow-hidden">
          {!mobile && desktopOpen && (
            <div className="shrink-0">
              <Sidebar onClose={() => setDesktop(false)} onNavigate={() => {}} />
            </div>
          )}
          {mobile && mobileOpen && (
            <div className="fixed inset-0 z-50 flex">
              <div className="fade-in absolute inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
              <div className="pop-in relative h-full shadow-xl">
                <Sidebar onClose={() => setMobileOpen(false)} onNavigate={() => setMobileOpen(false)} />
              </div>
            </div>
          )}
          <main className="flex min-w-0 flex-1 flex-col">{children}</main>
        </div>
      </Ctx.Provider>
    </SongsProvider>
  );
}
