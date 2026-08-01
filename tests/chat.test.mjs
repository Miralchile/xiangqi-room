import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const testDataDir = mkdtempSync(join(tmpdir(), "xiangqi-chat-test-"));
process.env.XIANGQI_DATA_DIR = testDataDir;
process.env.XIANGQI_CHAT_COOLDOWN_MS = "1000";
const { server, closeDatabase, databasePath } = require("../server.js");

async function post(base, clientId, name, text) {
  const response = await fetch(`${base}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ room: "chat-room", clientId, action: "sendChat", name, text })
  });
  return { status: response.status, body: await response.json() };
}

async function action(base, clientId, actionName, payload = {}) {
  const response = await fetch(`${base}/api/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ room: "chat-room", clientId, action: actionName, ...payload })
  });
  return { status: response.status, body: await response.json() };
}

test("players and spectators can use persistent room chat", async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const publicCreated = await fetch(`${base}/api/room`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameType: "xiangqi", isPublic: true })
    }).then((response) => response.json());
    const privateCreated = await fetch(`${base}/api/room`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameType: "xiangqi", isPublic: false })
    }).then((response) => response.json());
    const publicRooms = await fetch(`${base}/api/rooms`).then((response) => response.json());
    assert.ok(publicRooms.rooms.some((room) => room.id === publicCreated.state.id));
    assert.ok(!publicRooms.rooms.some((room) => room.id === privateCreated.state.id));

    const sent = await post(base, "spectator", " 沉着棋友 0088 ", " 大家好 <b>观战</b> ");
    assert.equal(sent.status, 200);
    assert.equal(sent.body.state.messages.length, 1);
    assert.equal(sent.body.state.messages[0].name, "沉着棋友 0088");
    assert.equal(sent.body.state.messages[0].text, "大家好 <b>观战</b>");
    const chatById = await fetch(`${base}/api/chat?target=${sent.body.state.chatId}&client=visitor`).then((response) => response.json());
    assert.equal(chatById.chat.roomId, "chat-room");
    assert.equal(chatById.chat.messages[0].name, "沉着棋友 0088");
    assert.equal(chatById.chat.messages[0].role, "观众");

    await action(base, "spectator", "takeSeat", { color: "red", name: "沉着棋友 0088" });
    const renamed = await action(base, "spectator", "updateIdentity", { name: "专注炮手1024" });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.state.seats.red.name, "专注炮手1024");
    assert.equal(renamed.body.state.messages[0].name, "专注炮手1024");
    assert.equal(renamed.body.state.messages[0].role, "红方");

    const throttled = await post(base, "spectator", "新名字", "第二条");
    assert.equal(throttled.status, 400);
    assert.match(throttled.body.error, /发送太快/);

    const { DatabaseSync } = require("node:sqlite");
    const storedDatabase = new DatabaseSync(databasePath, { readOnly: true });
    const stored = storedDatabase.prepare("SELECT state FROM rooms WHERE id = ?").get("chat-room");
    storedDatabase.close();
    assert.equal(JSON.parse(stored.state).messages[0].clientId, "spectator");
  } finally {
    server.close();
    await once(server, "close");
    closeDatabase();
    await rm(testDataDir, { recursive: true, force: true });
  }
});
