const $ = (selector) => document.querySelector(selector);
const boardEl = $("#board");
const roomStatus = $("#roomStatus");
const inviteLink = $("#inviteLink");
const turnText = $("#turnText");
const viewerText = $("#viewerText");
const redSeatText = $("#redSeatText");
const blackSeatText = $("#blackSeatText");
const requestBox = $("#requestBox");
const moveList = $("#moveList");
const chatList = $("#chatList");
const chatNameInput = $("#chatNameInput");
const chatInput = $("#chatInput");
const lastMoveText = $("#lastMoveText");
const toast = $("#toast");

let state = null;
let pollTimer = null;
let pollInFlight = false;
let selected = null;
let legalTargets = [];
let pendingConfirm = null;
let shownResultKey = null;
let activeSideTab = "moves";
let lastChatSignature = null;
const BOARD_PAD = 11;
const BOARD_X_STEP = (100 - BOARD_PAD * 2) / 8;
const BOARD_Y_STEP = (100 - BOARD_PAD * 2) / 9;
const RED_FILE_LABELS = ["九", "八", "七", "六", "五", "四", "三", "二", "一"];
const BLACK_FILE_LABELS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const CHAT_NAME_KEY = "xiangqi-chat-name";
const CHAT_ADJECTIVES = ["沉着", "敏捷", "从容", "机敏", "果断", "安静", "清醒", "专注"];
const CHAT_NOUNS = ["棋友", "车手", "炮手", "马客", "观棋者", "过河兵", "守宫人", "对弈者"];

const clientId = (() => {
  const key = "xiangqi-client-id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  localStorage.setItem(key, value);
  return value;
})();

function randomChatName() {
  const adjective = CHAT_ADJECTIVES[Math.floor(Math.random() * CHAT_ADJECTIVES.length)];
  const noun = CHAT_NOUNS[Math.floor(Math.random() * CHAT_NOUNS.length)];
  const number = String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
  return `${adjective}${noun}${number}`;
}

function storedChatName() {
  const stored = localStorage.getItem(CHAT_NAME_KEY)?.trim();
  if (stored) return stored.slice(0, 16);
  const generated = randomChatName();
  localStorage.setItem(CHAT_NAME_KEY, generated);
  return generated;
}

chatNameInput.value = storedChatName();

const params = new URLSearchParams(location.search);
let roomId = params.get("room");
if (!roomId) {
  roomId = Math.random().toString(36).slice(2, 10);
  history.replaceState(null, "", `/?room=${roomId}`);
}

function myColor() {
  if (!state) return null;
  if (state.seats.red?.clientId === clientId) return "red";
  if (state.seats.black?.clientId === clientId) return "black";
  return null;
}

function other(color) {
  return color === "red" ? "black" : "red";
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 2600);
}

async function post(action, payload = {}) {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ room: roomId, clientId, action, ...payload })
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || "操作失败");
  return data.state;
}

async function refreshState() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const response = await fetch(`/api/state?room=${encodeURIComponent(roomId)}&client=${encodeURIComponent(clientId)}`, {
      cache: "no-store"
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "连接棋局失败");
    if (state?.result && !data.state.result) {
      shownResultKey = null;
      $("#resultModal").classList.add("hidden");
    }
    state = data.state;
    render();
  } catch (error) {
    roomStatus.textContent = "连接中断，正在等待服务恢复...";
  } finally {
    pollInFlight = false;
  }
}

function connect() {
  window.clearInterval(pollTimer);
  refreshState();
  pollTimer = window.setInterval(refreshState, 1200);
}

function isLegalTarget(pos) {
  return legalTargets.some((target) => target.r === pos.r && target.c === pos.c);
}

function boardForView() {
  if (myColor() === "black") {
    const cells = [];
    for (let r = 9; r >= 0; r -= 1) {
      for (let c = 8; c >= 0; c -= 1) cells.push({ r, c });
    }
    return cells;
  }
  const cells = [];
  for (let r = 0; r < 10; r += 1) {
    for (let c = 0; c < 9; c += 1) cells.push({ r, c });
  }
  return cells;
}

function displayPoint(pos) {
  const point = myColor() === "black" ? { r: 9 - pos.r, c: 8 - pos.c } : pos;
  return {
    x: BOARD_PAD + point.c * BOARD_X_STEP,
    y: BOARD_PAD + point.r * BOARD_Y_STEP
  };
}

function createBoardLines() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "boardLines");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");

  const make = (tag, attrs) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    svg.appendChild(node);
    return node;
  };

  const x = (c) => BOARD_PAD + c * BOARD_X_STEP;
  const y = (r) => BOARD_PAD + r * BOARD_Y_STEP;
  for (let r = 0; r < 10; r += 1) {
    make("line", { x1: x(0), y1: y(r), x2: x(8), y2: y(r) });
  }
  for (let c = 0; c < 9; c += 1) {
    if (c === 0 || c === 8) {
      make("line", { x1: x(c), y1: y(0), x2: x(c), y2: y(9) });
    } else {
      make("line", { x1: x(c), y1: y(0), x2: x(c), y2: y(4) });
      make("line", { x1: x(c), y1: y(5), x2: x(c), y2: y(9) });
    }
  }
  make("line", { x1: x(3), y1: y(0), x2: x(5), y2: y(2), class: "palaceLine" });
  make("line", { x1: x(5), y1: y(0), x2: x(3), y2: y(2), class: "palaceLine" });
  make("line", { x1: x(3), y1: y(7), x2: x(5), y2: y(9), class: "palaceLine" });
  make("line", { x1: x(5), y1: y(7), x2: x(3), y2: y(9), class: "palaceLine" });

  const river = make("text", {
    x: "50",
    y: "50.8",
    "text-anchor": "middle",
    "dominant-baseline": "middle",
    class: "riverText"
  });
  river.textContent = myColor() === "black" ? "汉界    楚河" : "楚河    汉界";

  for (let c = 0; c < 9; c += 1) {
    const blackPoint = displayPoint({ r: 0, c });
    const redPoint = displayPoint({ r: 9, c });
    const blackLabel = make("text", {
      x: blackPoint.x,
      y: blackPoint.y < 50 ? blackPoint.y - 5.4 : blackPoint.y + 5.4,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      class: "fileLabel blackFileLabel"
    });
    blackLabel.textContent = BLACK_FILE_LABELS[c];

    const redLabel = make("text", {
      x: redPoint.x,
      y: redPoint.y < 50 ? redPoint.y - 5.4 : redPoint.y + 5.4,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      class: "fileLabel redFileLabel"
    });
    redLabel.textContent = RED_FILE_LABELS[c];
  }
  return svg;
}

function selectable(piece) {
  return state?.phase === "playing" && myColor() === state.turn && piece?.color === myColor();
}

function computeTargets(from) {
  const color = myColor();
  if (!color) return [];
  const targets = [];
  for (let r = 0; r < 10; r += 1) {
    for (let c = 0; c < 9; c += 1) {
      if (XQ.validateMove(state.board, from, { r, c }, color).ok) targets.push({ r, c });
    }
  }
  return targets;
}

async function commitMove(from, to) {
  try {
    await post("move", { from, to });
    selected = null;
    legalTargets = [];
  } catch (error) {
    showToast(error.message);
  }
}

function handleCellClick(pos) {
  if (!state) return;
  const piece = XQ.pieceAt(state.board, pos);
  if (selectable(piece)) {
    selected = pos;
    legalTargets = computeTargets(pos);
    renderBoard();
    return;
  }
  if (selected) {
    const color = myColor();
    const validation = XQ.validateMove(state.board, selected, pos, color);
    if (validation.ok) {
      commitMove(selected, pos);
      return;
    }
    if (validation.kind === "self-check") {
      showToast(validation.reason);
      return;
    }
  }
  selected = null;
  legalTargets = [];
  renderBoard();
}

function renderBoard() {
  boardEl.innerHTML = "";
  boardEl.appendChild(createBoardLines());
  for (const pos of boardForView()) {
    const piece = XQ.pieceAt(state.board, pos);
    const point = displayPoint(pos);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell";
    cell.dataset.row = pos.r;
    cell.dataset.col = pos.c;
    cell.style.left = `${point.x}%`;
    cell.style.top = `${point.y}%`;
    cell.setAttribute("aria-label", piece ? `${XQ.colorName(piece.color)}${XQ.pieceLabel(piece)}` : "空位");
    if (selected && selected.r === pos.r && selected.c === pos.c) cell.classList.add("selected");
    if (isLegalTarget(pos)) cell.classList.add("target");
    if (piece) cell.classList.add("occupied");
    if (piece) {
      const pieceEl = document.createElement("span");
      pieceEl.className = `piece ${piece.color}`;
      pieceEl.textContent = XQ.pieceLabel(piece);
      cell.appendChild(pieceEl);
    }
    cell.addEventListener("click", () => handleCellClick(pos));
    boardEl.appendChild(cell);
  }
}

function seatText(color) {
  const seat = state.seats[color];
  if (!seat) return "空位";
  const mine = seat.clientId === clientId ? "你" : seat.name;
  return `${mine}${seat.locked ? "，已锁定" : "，未锁定"}`;
}

function setButton(id, disabled) {
  $(id).disabled = Boolean(disabled);
}

function renderLobbyControls() {
  const color = myColor();
  const lobby = state.phase === "lobby";
  redSeatText.textContent = seatText("red");
  blackSeatText.textContent = seatText("black");

  setButton("#takeRedBtn", !lobby || (state.seats.red && state.seats.red.clientId !== clientId));
  setButton("#takeBlackBtn", !lobby || (state.seats.black && state.seats.black.clientId !== clientId));
  setButton("#lockRedBtn", !lobby || color !== "red" || state.seats.red?.locked);
  setButton("#lockBlackBtn", !lobby || color !== "black" || state.seats.black?.locked);
  const canRequestUndo = state.phase === "playing" && color && state.historyLength && color !== state.turn && !state.pendingUndo;
  setButton("#undoBtn", !canRequestUndo);
  $("#undoBtn").title = color === state.turn ? "轮到你走时不能申请悔棋" : "申请撤回自己刚刚走的一步";
  setButton("#drawBtn", state.phase !== "playing" || !color || Boolean(state.pendingDraw));
  setButton("#resignBtn", state.phase !== "playing" || !color);
}

function renderRequests() {
  requestBox.classList.add("hidden");
  requestBox.innerHTML = "";
  const color = myColor();
  if (!color || state.phase !== "playing") return;

  if (state.pendingUndo) {
    const by = state.pendingUndo.by;
    if (by === color) {
      requestBox.textContent = "已发出悔棋请求，等待对方处理。";
    } else {
      requestBox.innerHTML = `<strong>${XQ.colorName(by)}申请悔棋</strong><div class="inlineActions"><button data-action="undo-yes">同意</button><button data-action="undo-no">拒绝</button></div>`;
    }
    requestBox.classList.remove("hidden");
  } else if (state.pendingDraw) {
    const by = state.pendingDraw.by;
    if (by === color) {
      requestBox.textContent = "已发出求和请求，等待对方处理。";
    } else {
      requestBox.innerHTML = `<strong>${XQ.colorName(by)}请求和棋</strong><div class="inlineActions"><button data-action="draw-yes">同意</button><button data-action="draw-no">拒绝</button></div>`;
    }
    requestBox.classList.remove("hidden");
  }
}

function renderMoves() {
  moveList.innerHTML = "";
  if (!state.moves.length) {
    const empty = document.createElement("li");
    empty.className = "emptyMove";
    empty.textContent = "棋局开始后，走子记录会显示在这里。";
    moveList.appendChild(empty);
    return;
  }
  state.moves.slice().reverse().forEach((move, index) => {
    const item = document.createElement("li");
    item.className = `moveEntry ${move.color}`;
    const number = document.createElement("span");
    number.className = "moveIndex";
    number.textContent = state.moves.length - index;
    const description = document.createElement("span");
    description.className = "moveDescription";
    description.textContent = move.notation;
    item.append(number, description);
    moveList.appendChild(item);
  });
}

function renderChat() {
  const messages = state.messages || [];
  const signature = messages.map((message) => message.id).join(":");
  if (signature === lastChatSignature) return;
  const nearBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 48;
  lastChatSignature = signature;
  chatList.innerHTML = "";

  if (!messages.length) {
    const empty = document.createElement("li");
    empty.className = "emptyChat";
    empty.textContent = "还没有消息。";
    chatList.appendChild(empty);
    return;
  }

  messages.forEach((message) => {
    const item = document.createElement("li");
    item.className = "chatMessage";
    if (message.clientId === clientId) item.classList.add("mine");

    const meta = document.createElement("div");
    meta.className = "chatMeta";
    const name = document.createElement("strong");
    name.textContent = message.name;
    const time = document.createElement("time");
    time.dateTime = new Date(message.createdAt).toISOString();
    time.textContent = new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    meta.append(name, time);

    const content = document.createElement("p");
    content.textContent = message.text;
    item.append(meta, content);
    chatList.appendChild(item);
  });

  if (nearBottom || activeSideTab === "chat") chatList.scrollTop = chatList.scrollHeight;
}

function setSideTab(tab) {
  activeSideTab = tab;
  const chatActive = tab === "chat";
  $("#movesView").classList.toggle("hidden", chatActive);
  $("#chatView").classList.toggle("hidden", !chatActive);
  $("#movesTab").setAttribute("aria-selected", String(!chatActive));
  $("#chatTab").setAttribute("aria-selected", String(chatActive));
  if (chatActive) chatList.scrollTop = chatList.scrollHeight;
}

function saveChatName() {
  const name = chatNameInput.value.replace(/\s+/g, " ").trim().slice(0, 16);
  if (!name) {
    showToast("聊天 ID 不能为空");
    return null;
  }
  chatNameInput.value = name;
  localStorage.setItem(CHAT_NAME_KEY, name);
  return name;
}

function renderStatus() {
  const link = `${location.origin}/?room=${encodeURIComponent(roomId)}`;
  inviteLink.value = link;
  viewerText.textContent = `${state.viewerCount} 人在线`;
  const lastMove = state.moves[state.moves.length - 1];
  lastMoveText.textContent = lastMove ? lastMove.notation : "尚未走子";
  turnText.classList.remove("redTurn", "blackTurn");
  if (state.result) {
    roomStatus.textContent = state.result.text;
    turnText.textContent = "本局已结束";
    return;
  }
  if (state.phase === "lobby") {
    roomStatus.textContent = "选边后锁定，双方锁定后自动开始";
    turnText.textContent = "等待双方锁定";
    return;
  }
  const check = state.check ? "，被将军" : "";
  const mine = myColor();
  const role = mine ? `你是${XQ.colorName(mine)}` : "你正在观战";
  roomStatus.textContent = `${role}，当前${XQ.colorName(state.turn)}行棋`;
  turnText.textContent = `${XQ.colorName(state.turn)}走${check}`;
  turnText.classList.add(state.turn === "red" ? "redTurn" : "blackTurn");
}

function showResultModal() {
  if (!state.result) return;
  const resultKey = `${roomId}:${state.result.createdAt || "legacy"}:${state.result.type}:${state.result.winner || "draw"}`;
  if (shownResultKey === resultKey) return;
  shownResultKey = resultKey;

  const color = myColor();
  const presentation = XQ.resultPresentation(state.result, color);
  const resultDialog = $("#resultModal .resultDialog");
  resultDialog.classList.remove("isWin", "isLoss");
  $("#resultTitle").textContent = presentation.title;
  $("#resultText").textContent = presentation.text;
  if (presentation.tone === "win") resultDialog.classList.add("isWin");
  if (presentation.tone === "loss") resultDialog.classList.add("isLoss");

  $("#resultModal").classList.remove("hidden");
  $("#resultOk").focus();
}

function render() {
  if (!state) return;
  renderStatus();
  renderLobbyControls();
  renderRequests();
  renderMoves();
  renderChat();
  renderBoard();
  showResultModal();
}

async function simpleAction(action, payload) {
  try {
    await post(action, payload);
  } catch (error) {
    showToast(error.message);
  }
}

$("#newRoomBtn").addEventListener("click", async () => {
  const response = await fetch("/api/room", { method: "POST" });
  const data = await response.json();
  if (!data.ok) {
    showToast(data.error || "创建失败");
    return;
  }
  roomId = data.state.id;
  history.pushState(null, "", `/?room=${roomId}`);
  selected = null;
  legalTargets = [];
  shownResultKey = null;
  lastChatSignature = null;
  $("#resultModal").classList.add("hidden");
  connect();
});

$("#copyLinkBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    showToast("邀请链接已复制");
  } catch {
    inviteLink.select();
    showToast("已选中链接，可手动复制");
  }
});

$("#takeRedBtn").addEventListener("click", () => simpleAction("takeSeat", { color: "red", name: "红方" }));
$("#takeBlackBtn").addEventListener("click", () => simpleAction("takeSeat", { color: "black", name: "黑方" }));
$("#lockRedBtn").addEventListener("click", () => simpleAction("lockSeat"));
$("#lockBlackBtn").addEventListener("click", () => simpleAction("lockSeat"));
$("#undoBtn").addEventListener("click", () => simpleAction("requestUndo"));
$("#drawBtn").addEventListener("click", () => simpleAction("requestDraw"));
$("#resignBtn").addEventListener("click", () => {
  pendingConfirm = () => simpleAction("resign");
  $("#confirmTitle").textContent = "确认认输";
  $("#confirmText").textContent = "认输后本局立即结束。";
  $("#confirmModal").classList.remove("hidden");
});

requestBox.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "undo-yes") simpleAction("respondUndo", { accept: true });
  if (action === "undo-no") simpleAction("respondUndo", { accept: false });
  if (action === "draw-yes") simpleAction("respondDraw", { accept: true });
  if (action === "draw-no") simpleAction("respondDraw", { accept: false });
});

$("#confirmCancel").addEventListener("click", () => {
  pendingConfirm = null;
  $("#confirmModal").classList.add("hidden");
});

$("#confirmOk").addEventListener("click", () => {
  const action = pendingConfirm;
  pendingConfirm = null;
  $("#confirmModal").classList.add("hidden");
  if (action) action();
});

$("#resultOk").addEventListener("click", () => {
  $("#resultModal").classList.add("hidden");
  selected = null;
  legalTargets = [];
  simpleAction("resetAfterResult");
});

$("#movesTab").addEventListener("click", () => setSideTab("moves"));
$("#chatTab").addEventListener("click", () => setSideTab("chat"));
$("#saveNameBtn").addEventListener("click", () => {
  if (saveChatName()) showToast("聊天 ID 已保存");
});
$("#randomNameBtn").addEventListener("click", () => {
  chatNameInput.value = randomChatName();
  saveChatName();
});
chatInput.addEventListener("input", () => {
  $("#chatCount").textContent = `${chatInput.value.length} / 200`;
});
$("#chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = saveChatName();
  const text = chatInput.value.trim();
  if (!name || !text) {
    if (!text) showToast("消息不能为空");
    return;
  }
  const button = $("#sendChatBtn");
  button.disabled = true;
  try {
    state = await post("sendChat", { name, text });
    chatInput.value = "";
    $("#chatCount").textContent = "0 / 200";
    lastChatSignature = null;
    render();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

connect();
