const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const XQ = require("./public/engine.js");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.XIANGQI_DATA_DIR || path.join(__dirname, "data");
const DATABASE_PATH = path.join(DATA_DIR, "xiangqi.sqlite");
const ROOM_VIEWER_TIMEOUT_MS = Number(process.env.XIANGQI_ROOM_VIEWER_TIMEOUT_MS || 10_000);
const ROOM_EMPTY_GRACE_MS = Number(process.env.XIANGQI_ROOM_EMPTY_GRACE_MS || 20_000);
const ROOM_CLEANUP_INTERVAL_MS = Number(process.env.XIANGQI_ROOM_CLEANUP_INTERVAL_MS || 5_000);
fs.mkdirSync(DATA_DIR, { recursive: true });

const database = new DatabaseSync(DATABASE_PATH);
database.exec("PRAGMA journal_mode = WAL");
database.exec("PRAGMA synchronous = NORMAL");
database.exec(`CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`);
const selectRoom = database.prepare("SELECT state FROM rooms WHERE id = ?");
const selectAllRooms = database.prepare("SELECT state FROM rooms");
const upsertRoom = database.prepare(`INSERT INTO rooms (id, state, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`);
const deleteRoom = database.prepare("DELETE FROM rooms WHERE id = ?");
const rooms = new Map();

function makeId() {
  return crypto.randomBytes(4).toString("hex");
}

function newRoom(id = makeId()) {
  return {
    id,
    createdAt: Date.now(),
    phase: "lobby",
    board: XQ.initialBoard(),
    turn: "red",
    seats: {
      red: null,
      black: null
    },
    history: [],
    moves: [],
    pendingUndo: null,
    pendingDraw: null,
    result: null,
    clients: new Set(),
    viewers: new Map(),
    emptySince: Date.now()
  };
}

function roomState(room) {
  return {
    id: room.id,
    createdAt: room.createdAt,
    phase: room.phase,
    board: room.board,
    turn: room.turn,
    seats: room.seats,
    history: room.history,
    moves: room.moves,
    pendingUndo: room.pendingUndo,
    pendingDraw: room.pendingDraw,
    result: room.result
  };
}

function hydrateRoom(state) {
  return {
    ...state,
    clients: new Set(),
    viewers: new Map(),
    emptySince: Date.now()
  };
}

for (const stored of selectAllRooms.all()) {
  const state = JSON.parse(stored.state);
  rooms.set(state.id, hydrateRoom(state));
}

function saveRoom(room) {
  upsertRoom.run(room.id, JSON.stringify(roomState(room)), Date.now());
}

function getRoom(id) {
  const cleanId = String(id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || makeId();
  if (!rooms.has(cleanId)) {
    const stored = selectRoom.get(cleanId);
    const room = stored ? hydrateRoom(JSON.parse(stored.state)) : newRoom(cleanId);
    rooms.set(cleanId, room);
    if (!stored) saveRoom(room);
  }
  return rooms.get(cleanId);
}

function publicState(room) {
  const activeAfter = Date.now() - ROOM_VIEWER_TIMEOUT_MS;
  for (const [clientId, seenAt] of room.viewers) {
    if (seenAt < activeAfter) room.viewers.delete(clientId);
  }
  room.emptySince = room.viewers.size ? null : room.emptySince || Date.now();
  return {
    id: room.id,
    createdAt: room.createdAt,
    phase: room.phase,
    board: room.board,
    turn: room.turn,
    seats: room.seats,
    historyLength: room.history.length,
    moves: room.moves.slice(-80),
    pendingUndo: room.pendingUndo,
    pendingDraw: room.pendingDraw,
    result: room.result,
    viewerCount: room.viewers.size,
    check: room.phase === "playing" ? XQ.isInCheck(room.board, room.turn) : false,
    legalMoveCount: room.phase === "playing" ? XQ.allLegalMoves(room.board, room.turn).length : 0
  };
}

function touchViewer(room, clientId) {
  if (!clientId) return;
  room.viewers.set(clientId, Date.now());
  room.emptySince = null;
}

function cleanupEmptyRooms(now = Date.now()) {
  const activeAfter = now - ROOM_VIEWER_TIMEOUT_MS;
  for (const [id, room] of rooms) {
    for (const [clientId, seenAt] of room.viewers) {
      if (seenAt < activeAfter) room.viewers.delete(clientId);
    }
    if (room.viewers.size || room.clients.size) {
      room.emptySince = null;
      continue;
    }
    room.emptySince ||= now;
    if (now - room.emptySince < ROOM_EMPTY_GRACE_MS) continue;
    rooms.delete(id);
    deleteRoom.run(id);
  }
}

const cleanupTimer = setInterval(cleanupEmptyRooms, ROOM_CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

function sendEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(room) {
  const payload = publicState(room);
  for (const client of Array.from(room.clients)) {
    sendEvent(client, payload);
  }
}

function json(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function playerColor(room, clientId) {
  if (room.seats.red?.clientId === clientId) return "red";
  if (room.seats.black?.clientId === clientId) return "black";
  return null;
}

function otherColor(color) {
  return color === "red" ? "black" : "red";
}

function requirePlayer(room, clientId) {
  const color = playerColor(room, clientId);
  if (!color) throw new Error("只有红方或黑方可以执行这个操作。");
  return color;
}

function maybeStart(room) {
  if (
    room.phase === "lobby" &&
    room.seats.red?.locked &&
    room.seats.black?.locked
  ) {
    room.phase = "playing";
    room.turn = "red";
  }
}

function resetRoom(room) {
  room.board = XQ.initialBoard();
  room.turn = "red";
  room.phase = "lobby";
  room.history = [];
  room.moves = [];
  room.pendingUndo = null;
  room.pendingDraw = null;
  room.result = null;
  room.seats = { red: null, black: null };
}

function handleAction(room, data) {
  const clientId = String(data.clientId || "");
  if (!clientId) throw new Error("缺少 clientId。");

  switch (data.action) {
    case "takeSeat": {
      if (room.phase !== "lobby") throw new Error("开局后不能重新选边。");
      const color = data.color === "black" ? "black" : "red";
      const current = playerColor(room, clientId);
      if (current && current !== color) room.seats[current] = null;
      if (room.seats[color] && room.seats[color].clientId !== clientId) {
        throw new Error(`${XQ.colorName(color)}已被选择。`);
      }
      room.seats[color] = {
        clientId,
        name: String(data.name || XQ.colorName(color)).slice(0, 24),
        locked: false
      };
      maybeStart(room);
      return;
    }
    case "leaveSeat": {
      if (room.phase !== "lobby") throw new Error("开局后不能离开座位。");
      const color = playerColor(room, clientId);
      if (color) room.seats[color] = null;
      return;
    }
    case "lockSeat": {
      if (room.phase !== "lobby") throw new Error("当前阶段不能锁定。");
      const color = requirePlayer(room, clientId);
      room.seats[color].locked = true;
      maybeStart(room);
      return;
    }
    case "unlockSeat": {
      if (room.phase !== "lobby") throw new Error("当前阶段不能解锁。");
      const color = requirePlayer(room, clientId);
      room.seats[color].locked = false;
      return;
    }
    case "move": {
      if (room.phase !== "playing") throw new Error("棋局还没有开始。");
      const color = requirePlayer(room, clientId);
      if (room.turn !== color) throw new Error("还没有轮到你走。");
      const move = {
        from: data.from,
        to: data.to
      };
      const validation = XQ.validateMove(room.board, move.from, move.to, color);
      if (!validation.ok) throw new Error(validation.reason || "这步棋不合法。");
      const piece = XQ.pieceAt(room.board, move.from);
      const captured = XQ.pieceAt(room.board, move.to);
      room.history.push({
        board: XQ.cloneBoard(room.board),
        turn: room.turn,
        phase: room.phase,
        result: room.result
      });
      room.board = XQ.applyMove(room.board, move.from, move.to);
      room.moves.push({
        color,
        piece: piece.type,
        from: move.from,
        to: move.to,
        captured: captured ? captured.type : null,
        notation: XQ.describeMove(piece, move.from, move.to, captured),
        createdAt: Date.now()
      });
      room.pendingUndo = null;
      room.pendingDraw = null;
      const next = otherColor(color);
      if (XQ.isCheckmate(room.board, next)) {
        room.phase = "ended";
        room.result = {
          type: "checkmate",
          winner: color,
          text: `${XQ.colorName(color)}将杀获胜`,
          createdAt: Date.now()
        };
      } else {
        room.turn = next;
      }
      return;
    }
    case "requestUndo": {
      if (room.phase !== "playing") throw new Error("当前不能悔棋。");
      const color = requirePlayer(room, clientId);
      if (!room.history.length) throw new Error("还没有可以撤回的走法。");
      if (room.pendingUndo) throw new Error("已有待处理的悔棋请求。");
      if (color === room.turn || room.moves.at(-1)?.color !== color) {
        throw new Error("只能由刚刚走棋的一方申请悔棋。");
      }
      room.pendingUndo = { by: color, createdAt: Date.now() };
      return;
    }
    case "respondUndo": {
      if (room.phase !== "playing" || !room.pendingUndo) throw new Error("没有待处理的悔棋请求。");
      const color = requirePlayer(room, clientId);
      if (color === room.pendingUndo.by) throw new Error("需要对方处理悔棋请求。");
      if (color !== room.turn) throw new Error("需要轮到走棋的一方处理悔棋请求。");
      if (data.accept) {
        const previous = room.history.pop();
        room.board = previous.board;
        room.turn = previous.turn;
        room.phase = previous.phase;
        room.result = previous.result;
        room.moves.pop();
      }
      room.pendingUndo = null;
      return;
    }
    case "resign": {
      if (room.phase !== "playing") throw new Error("当前不能认输。");
      const color = requirePlayer(room, clientId);
      const winner = otherColor(color);
      room.phase = "ended";
      room.result = {
        type: "resign",
        winner,
        text: `${XQ.colorName(color)}认输，${XQ.colorName(winner)}获胜`,
        createdAt: Date.now()
      };
      return;
    }
    case "requestDraw": {
      if (room.phase !== "playing") throw new Error("当前不能求和。");
      const color = requirePlayer(room, clientId);
      room.pendingDraw = { by: color, createdAt: Date.now() };
      return;
    }
    case "respondDraw": {
      if (room.phase !== "playing" || !room.pendingDraw) throw new Error("没有待处理的求和请求。");
      const color = requirePlayer(room, clientId);
      if (color === room.pendingDraw.by) throw new Error("需要对方处理求和请求。");
      if (data.accept) {
        room.phase = "ended";
        room.result = { type: "draw", winner: null, text: "双方同意和棋", createdAt: Date.now() };
      }
      room.pendingDraw = null;
      return;
    }
    case "restart": {
      requirePlayer(room, clientId);
      if (room.phase !== "ended") throw new Error("只有结束后才能重开。");
      resetRoom(room);
      return;
    }
    case "resetAfterResult": {
      if (room.phase !== "ended" || !room.result) throw new Error("当前棋局尚未结束。");
      resetRoom(room);
      return;
    }
    default:
      throw new Error("未知操作。");
  }
}

function serveStatic(req, res, pathname) {
  const filePath = pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, pathname);
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(normalized, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(normalized);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8"
    };
    res.writeHead(200, {
      "content-type": types[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(req.method === "HEAD" ? undefined : data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    const room = getRoom(url.searchParams.get("room"));
    const clientId = String(url.searchParams.get("client") || "").slice(0, 100);
    touchViewer(room, clientId);
    json(res, 200, { ok: true, state: publicState(room) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    const room = getRoom(url.searchParams.get("room"));
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "access-control-allow-origin": "*"
    });
    room.clients.add(res);
    room.emptySince = null;
    sendEvent(res, publicState(room));
    req.on("close", () => {
      room.clients.delete(res);
      broadcast(room);
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/action") {
    try {
      const data = await readBody(req);
      const room = getRoom(data.room);
      handleAction(room, data);
      saveRoom(room);
      broadcast(room);
      json(res, 200, { ok: true, state: publicState(room) });
    } catch (error) {
      json(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/room") {
    const room = getRoom(makeId());
    saveRoom(room);
    json(res, 200, { ok: true, state: publicState(room) });
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res, url.pathname);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Chinese chess room server: http://localhost:${server.address().port}`);
  });
}

function closeDatabase() {
  clearInterval(cleanupTimer);
  database.close();
}

module.exports = { server, closeDatabase, databasePath: DATABASE_PATH };
