"use client";

import { useEffect, useRef, useState } from "react";

type DemoStatus =
  | { state: "idle" }
  | { state: "running" }
  | { state: "cooldown"; secondsRemaining: number }
  | { state: "unconfigured"; reason: string }
  | { state: "unfunded"; reason: string };

// "RUN DEMO" triggers a REAL on-chain arc (see web/app/api/demo/route.ts) —
// this component only ever watches the same status the server computes from
// chain state; it holds no lock/cooldown logic of its own. Polling is
// adaptive: fast while something's actively changing (running/cooldown),
// slow while idle (just enough to notice another visitor/tab triggered it).
export function DemoButton() {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  async function refreshStatus() {
    try {
      const res = await fetch("/api/demo", { cache: "no-store" });
      const data: DemoStatus = await res.json();
      if (!cancelledRef.current) setStatus(data);
      return data;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    cancelledRef.current = false;

    async function loop() {
      const data = await refreshStatus();
      if (cancelledRef.current) return;
      const delay = data?.state === "running" ? 3000 : data?.state === "cooldown" ? 5000 : 20000;
      timerRef.current = setTimeout(loop, delay);
    }
    loop();

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Smooth per-second countdown between the 5s server resyncs, so the label
  // doesn't sit frozen on one number.
  useEffect(() => {
    if (status?.state !== "cooldown") return;
    const t = setInterval(() => {
      setStatus((s) => (s?.state === "cooldown" && s.secondsRemaining > 0 ? { ...s, secondsRemaining: s.secondsRemaining - 1 } : s));
    }, 1000);
    return () => clearInterval(t);
  }, [status?.state]);

  async function handleClick() {
    setError(null);
    setTriggering(true);
    try {
      const res = await fetch("/api/demo", { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? data.status?.reason ?? "demo failed to start");
      }
    } catch {
      setError("network error triggering demo");
    } finally {
      setTriggering(false);
      refreshStatus();
    }
  }

  // Not configured (e.g. local dev without DEMO_*_KEYPAIR set) — hide
  // entirely rather than show a control that can never work.
  if (!status || status.state === "unconfigured") return null;

  const isRunning = status.state === "running" || triggering;
  const isCooldown = status.state === "cooldown";
  const isUnfunded = status.state === "unfunded";
  const disabled = isRunning || isCooldown || isUnfunded;

  const label = isRunning
    ? "ARENA RUNNING…"
    : isCooldown
      ? `ARENA COOLDOWN · ${status.secondsRemaining}S`
      : isUnfunded
        ? "ARENA UNAVAILABLE"
        : "▸ ENTER THE ARENA";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        title={
          isUnfunded
            ? status.reason
            : "Sends a real agent into a real propose → accept → dispute → slash arc on devnet — watch it live in the feed and on the network graph below"
        }
        className={
          "border px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] transition-colors " +
          (disabled
            ? "cursor-not-allowed border-ink-line text-ink-faint"
            : "border-bone bg-bone text-ink hover:opacity-80")
        }
      >
        {label}
      </button>
      {error && <span className="max-w-[220px] text-right text-[9px] text-danger-ink">{error}</span>}
    </div>
  );
}
