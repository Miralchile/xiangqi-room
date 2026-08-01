import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XQ = require("../public/engine.js");

test("standard Xiangqi opening layout", () => {
  const board = XQ.initialBoard();
  const row = (index) => board[index].map((piece) => piece?.type || ".").join("");
  assert.equal(board.length, 10);
  assert.ok(board.every((line) => line.length === 9));
  assert.equal(board.flat().filter(Boolean).length, 32);
  assert.equal(row(0), "RHEAKAEHR");
  assert.equal(row(2), ".C.....C.");
  assert.equal(row(3), "S.S.S.S.S");
  assert.equal(row(6), "S.S.S.S.S");
  assert.equal(row(7), ".C.....C.");
  assert.equal(row(9), "RHEAKAEHR");
});
