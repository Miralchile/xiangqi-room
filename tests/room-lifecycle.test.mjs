import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const testDataDir = mkdtempSync(join(tmpdir(), "xiangqi-lifecycle-test-"));
process.env.XIANGQI_DATA_DIR = testDataDir;
process.env.XIANGQI_ROOM_VIEWER_TIMEOUT_MS = "40";
process.env.XIANGQI_ROOM_EMPTY_GRACE_MS = "80";
process.env.XIANGQI_ROOM_CLEANUP_INTERVAL_MS = "20";
const { server, closeDatabase, databasePath } = require("../server.js");

test("an empty room is removed from persistent storage", async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${base}/api/state?room=empty-room&client=visitor`);
    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 180));

    const { DatabaseSync } = require("node:sqlite");
    const storedDatabase = new DatabaseSync(databasePath, { readOnly: true });
    const stored = storedDatabase.prepare("SELECT id FROM rooms WHERE id = ?").get("empty-room");
    storedDatabase.close();
    assert.equal(stored, undefined);
  } finally {
    server.close();
    await once(server, "close");
    closeDatabase();
    await rm(testDataDir, { recursive: true, force: true });
  }
});
