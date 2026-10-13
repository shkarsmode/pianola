"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface MidiState {
  supported: boolean;
  connected: boolean;
  devices: string[];
  error?: string;
}

/** A digital piano over USB (Web MIDI): note-on/off events from every connected input. */
export function useMidi(onNote: (pitch: number, on: boolean, velocity: number) => void) {
  const [state, setState] = useState<MidiState>({ supported: false, connected: false, devices: [] });
  const access = useRef<MIDIAccess | null>(null);
  const handler = useRef(onNote);
  handler.current = onNote;

  useEffect(() => {
    setState((s) => ({ ...s, supported: typeof navigator !== "undefined" && "requestMIDIAccess" in navigator }));
  }, []);

  const attach = useCallback((a: MIDIAccess) => {
    const names: string[] = [];
    a.inputs.forEach((input) => {
      names.push(input.name || "MIDI");
      input.onmidimessage = (e: MIDIMessageEvent) => {
        const d = e.data;
        if (!d || d.length < 3) return;
        const cmd = d[0] & 0xf0;
        if (cmd === 0x90 && d[2] > 0) handler.current(d[1], true, d[2]);
        else if (cmd === 0x80 || (cmd === 0x90 && d[2] === 0)) handler.current(d[1], false, 0);
      };
    });
    setState({ supported: true, connected: names.length > 0, devices: names });
  }, []);

  const connect = useCallback(async () => {
    if (!("requestMIDIAccess" in navigator)) {
      setState({ supported: false, connected: false, devices: [], error: "Цей браузер не підтримує MIDI — спробуй Chrome" });
      return false;
    }
    try {
      const a = await navigator.requestMIDIAccess();
      access.current = a;
      attach(a);
      a.onstatechange = () => attach(a);
      return a.inputs.size > 0;
    } catch {
      setState((s) => ({ ...s, error: "Браузер не дав доступу до MIDI" }));
      return false;
    }
  }, [attach]);

  // Reconnect silently if permission was granted earlier.
  useEffect(() => {
    let cancelled = false;
    navigator.permissions
      ?.query({ name: "midi" as PermissionName })
      .then((p) => {
        if (!cancelled && p.state === "granted") void connect();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connect]);

  return { midi: state, connectMidi: connect };
}
