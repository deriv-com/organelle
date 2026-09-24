import { afterEach, describe, expect, it, vi } from "vitest";

const clients = vi.hoisted(() => [] as Array<ReturnType<typeof makeClient>>);
const beginErrors = vi.hoisted(() => [] as Error[]);
function makeClient() {
  const tx = vi.fn<(strings: TemplateStringsArray) => Promise<unknown[]>>(
    async () => [],
  );
  return {
    tx,
    begin: vi.fn(async (_options: string, fn: (sql: unknown) => unknown) => {
      const error = beginErrors.shift();
      if (error) throw error;
      return fn(tx);
    }),
    end: vi.fn(async () => undefined),
  };
}
vi.mock("postgres", () => ({
  default: vi.fn(() => {
    const client = makeClient();
    clients.push(client);
    return client;
  }),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
  clients.length = 0;
  beginErrors.length = 0;
});

describe("bounded read-only database scope", () => {
  it("terminates a hung read at the deadline without closing the shared client", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/test");
    vi.useFakeTimers();
    const { getDb, withReadOnlyDb, withDbRetry } = await import("./db");
    const shared = getDb();
    const pending = withReadOnlyDb(
      () => withDbRetry(async () => new Promise(() => {})),
      { timeoutMs: 100 },
    );
    const rejected = expect(pending).rejects.toMatchObject({ code: "DB_READ_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(clients[1].end).toHaveBeenCalledWith({ timeout: 0 });
    expect(shared.end).not.toHaveBeenCalled();
    expect(getDb()).toBe(shared);
  });

  it("shares one read-only transaction across nested reads and cleans up on success", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/test");
    const { withReadOnlyDb, withDbRetry } = await import("./db");
    const result = await withReadOnlyDb(async () => {
      await Promise.all(
        [1, 2, 3].map(() =>
          withDbRetry(async (sql) => {
            expect(sql).toBe(clients[0].tx);
          }),
        ),
      );
      return "loaded";
    });
    expect(result).toBe("loaded");
    expect(clients).toHaveLength(1);
    expect(clients[0].begin).toHaveBeenCalledWith("read only", expect.any(Function));
    expect(clients[0].tx.mock.calls[0][0]).toContain(
      "set local statement_timeout = '10s'",
    );
    expect(clients[0].end).toHaveBeenCalledWith({ timeout: 0 });
  });

  it("does not retry a failed transaction or leak its connection", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/test");
    const { withReadOnlyDb, withDbRetry } = await import("./db");
    const read = vi.fn(async () => {
      throw new Error("CONNECTION_CLOSED");
    });
    await expect(withReadOnlyDb(() => withDbRetry(read))).rejects.toThrow(
      "CONNECTION_CLOSED",
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(clients[0].end).toHaveBeenCalled();
  });

  it("retries transient startup failures before the read callback begins", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/test");
    beginErrors.push(
      new Error(
        "Client network socket disconnected before secure TLS connection was established",
      ),
      new Error("read ECONNRESET"),
    );
    const { withReadOnlyDb } = await import("./db");
    const read = vi.fn(async () => "loaded");

    await expect(withReadOnlyDb(read, { attempts: 3 })).resolves.toBe("loaded");

    expect(read).toHaveBeenCalledTimes(1);
    expect(clients).toHaveLength(3);
    expect(clients.every((client) => client.end.mock.calls.length === 1)).toBe(true);
  });
});
