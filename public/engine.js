(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.XQ = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const PIECE_TEXT = {
    red: { K: "帅", A: "仕", E: "相", H: "马", R: "车", C: "炮", S: "兵" },
    black: { K: "将", A: "士", E: "象", H: "马", R: "车", C: "炮", S: "卒" }
  };
  const PIECE_NAME = { K: "将", A: "士", E: "象", H: "马", R: "车", C: "炮", S: "兵" };

  function colorName(color) {
    return color === "red" ? "红方" : "黑方";
  }

  function cloneBoard(board) {
    return board.map((row) => row.map((piece) => (piece ? { ...piece } : null)));
  }

  function makePiece(color, type, index) {
    return { id: `${color}-${type}-${index}`, color, type };
  }

  function initialBoard() {
    const board = Array.from({ length: 10 }, () => Array(9).fill(null));
    const back = ["R", "H", "E", "A", "K", "A", "E", "H", "R"];
    back.forEach((type, col) => {
      board[0][col] = makePiece("black", type, col);
      board[9][col] = makePiece("red", type, col);
    });
    [1, 7].forEach((col, index) => {
      board[2][col] = makePiece("black", "C", index);
      board[7][col] = makePiece("red", "C", index);
    });
    [0, 2, 4, 6, 8].forEach((col, index) => {
      board[3][col] = makePiece("black", "S", index);
      board[6][col] = makePiece("red", "S", index);
    });
    return board;
  }

  function inside(pos) {
    return pos && Number.isInteger(pos.r) && Number.isInteger(pos.c) && pos.r >= 0 && pos.r < 10 && pos.c >= 0 && pos.c < 9;
  }

  function pieceAt(board, pos) {
    return inside(pos) ? board[pos.r][pos.c] : null;
  }

  function palace(color, pos) {
    if (pos.c < 3 || pos.c > 5) return false;
    return color === "red" ? pos.r >= 7 && pos.r <= 9 : pos.r >= 0 && pos.r <= 2;
  }

  function crossedRiver(color, row) {
    return color === "red" ? row <= 4 : row >= 5;
  }

  function betweenCount(board, from, to) {
    if (from.r !== to.r && from.c !== to.c) return Infinity;
    let count = 0;
    const dr = Math.sign(to.r - from.r);
    const dc = Math.sign(to.c - from.c);
    let r = from.r + dr;
    let c = from.c + dc;
    while (r !== to.r || c !== to.c) {
      if (board[r][c]) count += 1;
      r += dr;
      c += dc;
    }
    return count;
  }

  function locateKing(board, color) {
    for (let r = 0; r < 10; r += 1) {
      for (let c = 0; c < 9; c += 1) {
        const piece = board[r][c];
        if (piece && piece.color === color && piece.type === "K") return { r, c };
      }
    }
    return null;
  }

  function kingsFace(board) {
    const red = locateKing(board, "red");
    const black = locateKing(board, "black");
    if (!red || !black || red.c !== black.c) return false;
    return betweenCount(board, red, black) === 0;
  }

  function rawCanMove(board, from, to, capture) {
    const piece = pieceAt(board, from);
    if (!piece || !inside(to)) return false;
    const dr = to.r - from.r;
    const dc = to.c - from.c;
    const adr = Math.abs(dr);
    const adc = Math.abs(dc);

    if (piece.type === "K") {
      const target = pieceAt(board, to);
      if (target?.type === "K" && from.c === to.c && betweenCount(board, from, to) === 0) return true;
      return palace(piece.color, to) && adr + adc === 1;
    }

    if (piece.type === "A") return palace(piece.color, to) && adr === 1 && adc === 1;

    if (piece.type === "E") {
      const staysHome = piece.color === "red" ? to.r >= 5 : to.r <= 4;
      const eye = { r: from.r + dr / 2, c: from.c + dc / 2 };
      return staysHome && adr === 2 && adc === 2 && !pieceAt(board, eye);
    }

    if (piece.type === "H") {
      if (!((adr === 2 && adc === 1) || (adr === 1 && adc === 2))) return false;
      const leg = adr === 2 ? { r: from.r + Math.sign(dr), c: from.c } : { r: from.r, c: from.c + Math.sign(dc) };
      return !pieceAt(board, leg);
    }

    if (piece.type === "R") return (dr === 0 || dc === 0) && betweenCount(board, from, to) === 0;

    if (piece.type === "C") {
      if (dr !== 0 && dc !== 0) return false;
      return capture ? betweenCount(board, from, to) === 1 : betweenCount(board, from, to) === 0;
    }

    if (piece.type === "S") {
      const forward = piece.color === "red" ? -1 : 1;
      if (dr === forward && dc === 0) return true;
      return crossedRiver(piece.color, from.r) && dr === 0 && adc === 1;
    }

    return false;
  }

  function applyMove(board, from, to) {
    const next = cloneBoard(board);
    next[to.r][to.c] = next[from.r][from.c];
    next[from.r][from.c] = null;
    return next;
  }

  function isInCheck(board, color) {
    const king = locateKing(board, color);
    if (!king) return true;
    const enemy = color === "red" ? "black" : "red";
    for (let r = 0; r < 10; r += 1) {
      for (let c = 0; c < 9; c += 1) {
        const piece = board[r][c];
        if (!piece || piece.color !== enemy) continue;
        if (rawCanMove(board, { r, c }, king, true)) return true;
      }
    }
    return false;
  }

  function validateMove(board, from, to, color) {
    if (!inside(from) || !inside(to)) return { ok: false, reason: "坐标越界。" };
    const piece = pieceAt(board, from);
    if (!piece) return { ok: false, reason: "起点没有棋子。" };
    if (piece.color !== color) return { ok: false, reason: "不能移动对方棋子。" };
    const target = pieceAt(board, to);
    if (target && target.color === color) return { ok: false, reason: "不能吃自己的棋子。" };
    if (!rawCanMove(board, from, to, Boolean(target))) return { ok: false, reason: "棋子走法不符合规则。" };
    const next = applyMove(board, from, to);
    if (kingsFace(next)) return { ok: false, kind: "self-check", reason: "该走法会导致将帅照面，不能这样走。" };
    if (isInCheck(next, color)) return { ok: false, kind: "self-check", reason: "该走法会使己方被直接将军，不能这样走。" };
    return { ok: true };
  }

  function allLegalMoves(board, color) {
    const moves = [];
    for (let r = 0; r < 10; r += 1) {
      for (let c = 0; c < 9; c += 1) {
        const piece = board[r][c];
        if (!piece || piece.color !== color) continue;
        for (let tr = 0; tr < 10; tr += 1) {
          for (let tc = 0; tc < 9; tc += 1) {
            const from = { r, c };
            const to = { r: tr, c: tc };
            if (validateMove(board, from, to, color).ok) moves.push({ from, to });
          }
        }
      }
    }
    return moves;
  }

  function isCheckmate(board, color) {
    return isInCheck(board, color) && allLegalMoves(board, color).length === 0;
  }

  function pieceLabel(piece) {
    return piece ? PIECE_TEXT[piece.color][piece.type] : "";
  }

  function describeMove(piece, from, to, captured) {
    const cap = captured ? `吃${PIECE_NAME[captured.type]}` : "至";
    return `${colorName(piece.color)}${PIECE_NAME[piece.type]} ${from.r + 1},${from.c + 1} ${cap} ${to.r + 1},${to.c + 1}`;
  }

  function resultPresentation(result, viewerColor) {
    const winner = result?.winner || null;
    if (!winner) return { title: "本局和棋", text: result?.text || "本局和棋", tone: "neutral" };
    if (viewerColor === winner) {
      return {
        title: "你赢了",
        text: result.type === "checkmate" ? `你已将杀${colorName(winner === "red" ? "black" : "red")}，本局结束。` : result.text,
        tone: "win"
      };
    }
    if (viewerColor) {
      return {
        title: "你输了",
        text: result.type === "checkmate" ? `${colorName(winner)}已完成将杀，本局结束。` : result.text,
        tone: "loss"
      };
    }
    return {
      title: `${colorName(winner)}获胜`,
      text: result.type === "checkmate"
        ? `${colorName(winner)}将杀${colorName(winner === "red" ? "black" : "red")}，本局结束。`
        : result.text,
      tone: "neutral"
    };
  }

  return {
    initialBoard,
    cloneBoard,
    pieceAt,
    pieceLabel,
    colorName,
    validateMove,
    applyMove,
    isInCheck,
    isCheckmate,
    allLegalMoves,
    describeMove,
    resultPresentation
  };
});
