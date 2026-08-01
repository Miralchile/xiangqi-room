import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XQ = require("../public/engine.js");

test("a move exposing one's own king is rejected immediately", () => {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  board[0][3] = { id: "black-king", color: "black", type: "K" };
  board[9][4] = { id: "red-king", color: "red", type: "K" };
  board[5][4] = { id: "black-rook", color: "black", type: "R" };
  board[7][4] = { id: "red-rook", color: "red", type: "R" };

  const result = XQ.validateMove(board, { r: 7, c: 4 }, { r: 7, c: 3 }, "red");
  assert.equal(result.ok, false);
  assert.equal(result.kind, "self-check");
  assert.match(result.reason, /直接将军/);
});

test("a legal move is not blocked because the opponent may mate next", () => {
  const board = XQ.initialBoard();
  const result = XQ.validateMove(board, { r: 6, c: 0 }, { r: 5, c: 0 }, "red");
  assert.deepEqual(result, { ok: true });
  assert.equal("allowsImmediateMate" in XQ, false);
});

test("checkmate result messages match winner, loser and spectator roles", () => {
  const result = { type: "checkmate", winner: "red", text: "红方将杀获胜" };
  assert.deepEqual(XQ.resultPresentation(result, "red"), {
    title: "你赢了",
    text: "你已将杀黑方，本局结束。",
    tone: "win"
  });
  assert.deepEqual(XQ.resultPresentation(result, "black"), {
    title: "你输了",
    text: "红方已完成将杀，本局结束。",
    tone: "loss"
  });
  assert.deepEqual(XQ.resultPresentation(result, null), {
    title: "红方获胜",
    text: "红方将杀黑方，本局结束。",
    tone: "neutral"
  });
});
