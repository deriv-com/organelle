import type { ChartRow } from "./chart-row";

export type PendingCmd = {
  token: string;
  before: ChartRow[];
  apply: (rows: ChartRow[]) => ChartRow[];
  nodeIds: string[];
  focusNodeId: string | null;
};

export function newPendingToken(): string {
  return crypto.randomUUID();
}

export function acknowledgePending(
  commands: PendingCmd[],
  token: string,
): PendingCmd[] {
  return commands.filter((command) => command.token !== token);
}

export function createPendingBuffers() {
  let user: PendingCmd[] = [];
  let redo: PendingCmd[] = [];

  return {
    pushUser(command: Omit<PendingCmd, "token"> & { token?: string }): PendingCmd {
      const full: PendingCmd = {
        ...command,
        token: command.token ?? newPendingToken(),
      };
      user = [...user, full];
      redo = [];
      return full;
    },
    popUser(): PendingCmd | undefined {
      if (user.length === 0) return undefined;
      const next = user.slice();
      const command = next.pop()!;
      user = next;
      redo = [...redo, command];
      return command;
    },
    popRedo(): PendingCmd | undefined {
      if (redo.length === 0) return undefined;
      const next = redo.slice();
      const command = next.pop()!;
      redo = next;
      user = [...user, command];
      return command;
    },
    acknowledge(token: string): void {
      user = acknowledgePending(user, token);
      redo = acknowledgePending(redo, token);
    },
    clear(): void {
      user = [];
      redo = [];
    },
    user(): PendingCmd[] {
      return user;
    },
    redo(): PendingCmd[] {
      return redo;
    },
    snapshotCount(): number {
      return user.length + redo.length;
    },
  };
}
