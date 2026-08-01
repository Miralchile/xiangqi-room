import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const XQ = require("../public/engine.js");
const testDataDir = mkdtempSync(join(tmpdir(), "xiangqi-test-"));
process.env.XIANGQI_DATA_DIR = testDataDir;
const { server, closeDatabase, databasePath } = require("../server.js");

async function post(base, action, payload = {}) {
  const response = await fetch(`${base}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ room: "undo-rule", action, ...payload })
  });
  return { status: response.status, body: await response.json() };
}

test("only the player who made the latest move can request undo", async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    await post(base, "takeSeat", { clientId: "red-client", color: "red" });
    await post(base, "takeSeat", { clientId: "black-client", color: "black" });
    await post(base, "lockSeat", { clientId: "red-client" });
    await post(base, "lockSeat", { clientId: "black-client" });

    await post(base, "move", { clientId: "red-client", from: { r: 6, c: 0 }, to: { r: 5, c: 0 } });

    const currentBlack = await post(base, "requestUndo", { clientId: "black-client" });
    assert.equal(currentBlack.status, 400);
    assert.match(currentBlack.body.error, /刚刚走棋的一方/);

    const lastMoverRed = await post(base, "requestUndo", { clientId: "red-client" });
    assert.equal(lastMoverRed.status, 200);
    assert.equal(lastMoverRed.body.state.pendingUndo.by, "red");

    await post(base, "respondUndo", { clientId: "black-client", accept: false });
    const redFeedback = await fetch(`${base}/api/state?room=undo-rule&client=red-client`).then((response) => response.json());
    assert.equal(redFeedback.state.notifications.length, 1);
    assert.match(redFeedback.state.notifications[0].text, /拒绝/);
    const blackPrivateState = await fetch(`${base}/api/state?room=undo-rule&client=black-client`).then((response) => response.json());
    assert.equal(blackPrivateState.state.notifications.length, 0);
    await post(base, "move", { clientId: "black-client", from: { r: 3, c: 0 }, to: { r: 4, c: 0 } });

    const currentRed = await post(base, "requestUndo", { clientId: "red-client" });
    assert.equal(currentRed.status, 400);
    const lastMoverBlack = await post(base, "requestUndo", { clientId: "black-client" });
    assert.equal(lastMoverBlack.status, 200);
    assert.equal(lastMoverBlack.body.state.pendingUndo.by, "black");

    const { DatabaseSync } = require("node:sqlite");
    const storedDatabase = new DatabaseSync(databasePath, { readOnly: true });
    const stored = storedDatabase.prepare("SELECT state FROM rooms WHERE id = ?").get("undo-rule");
    storedDatabase.close();
    const storedState = JSON.parse(stored.state);
    assert.equal(storedState.moves.length, 2);
    assert.equal(storedState.pendingUndo.by, "black");

    await post(base, "sendChat", { clientId: "spectator-client", name: "观棋者", text: "下一局见" });
    await post(base, "resign", { clientId: "red-client" });
    const reset = await post(base, "resetAfterResult", { clientId: "spectator-client" });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.state.phase, "lobby");
    assert.equal(reset.body.state.moves.length, 0);
    assert.equal(reset.body.state.historyLength, 0);
    assert.equal(reset.body.state.seats.red, null);
    assert.equal(reset.body.state.seats.black, null);
    assert.equal(reset.body.state.messages.length, 0);
    assert.equal(reset.body.state.notifications.length, 0);
    assert.deepEqual(reset.body.state.board, XQ.initialBoard());
  } finally {
    server.close();
    await once(server, "close");
    closeDatabase();
    await rm(testDataDir, { recursive: true, force: true });
  }
});
