/**
 * Warn before refresh/close while a sandbox persist is in flight.
 * The browser supplies the dialog copy; we only arm `beforeunload`.
 */

export type PersistPhase = "idle" | "saving" | "saved";

export function shouldWarnOnUnload(phase: PersistPhase): boolean {
  return phase === "saving";
}

export function attachPersistUnload(getPhase: () => PersistPhase): () => void {
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!shouldWarnOnUnload(getPhase())) return;
    event.preventDefault();
    event.returnValue = "";
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  return () => window.removeEventListener("beforeunload", onBeforeUnload);
}
