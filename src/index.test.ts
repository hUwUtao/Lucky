import { describe, expect, test } from "bun:test";
import { startServer } from "./index";

describe("startServer", () => {
  test("binds to an ephemeral port when requested", async () => {
    const server = startServer({ port: 0, log: false });
    try {
      const port = server.server?.port ?? 0;
      expect(port).toBeGreaterThan(0);
    } finally {
      await server.stop();
    }
  });
});
