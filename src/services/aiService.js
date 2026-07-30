import { getLegalMoves, boardToText, getAllLegalMoves } from '../utils/gameLogic';

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const MODEL = 'qwen2.5:7b';

function movesToText(moves) {
  return moves.map((m, i) => {
    const from = `(${m.from.r},${m.from.c})`;
    const to = `(${m.to.r},${m.to.c})`;
    return `${i}: from ${from} to ${to}`;
  }).join('\n');
}

export async function getAIMove(board) {
  const allMoves = getAllLegalMoves(board, 'black');

  if (allMoves.length === 0) return null;

  if (allMoves.length === 1) {
    return { move: allMoves[0], source: 'random', prompt: null, response: null };
  }

  const boardStr = boardToText(board);
  const movesStr = movesToText(allMoves);

  const promptContent = `你是一个中国象棋AI对手，你执黑棋。以下是当前棋盘状态（10行x9列）：

${boardStr}

所有合法的黑棋走法（编号: 从(from坐标) 到(to坐标)）：
${movesStr}

请分析局势，选择最佳走法。只输出一个数字编号，不要输出其他任何内容。`;

  let lastError = null;
  let rawResponse = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          prompt: promptContent,
          stream: false,
          temperature: 0.3,
          max_tokens: 10,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      rawResponse = data.response.trim();
      const text = rawResponse;

      const idx = parseInt(text, 10);
      if (!isNaN(idx) && idx >= 0 && idx < allMoves.length) {
        return { move: allMoves[idx], source: 'ollama', prompt: promptContent, response: rawResponse };
      }

      const match = text.match(/\d+/);
      if (match) {
        const idx2 = parseInt(match[0], 10);
        if (!isNaN(idx2) && idx2 >= 0 && idx2 < allMoves.length) {
          return { move: allMoves[idx2], source: 'ollama', prompt: promptContent, response: rawResponse };
        }
      }

      const coordsMatch = text.match(/\((\d+),(\d+)\).*\((\d+),(\d+)\)/);
      if (coordsMatch) {
        const [_, fr, fc, tr, tc] = coordsMatch.map(Number);
        const found = allMoves.find(
          m => m.from.r === fr && m.from.c === fc && m.to.r === tr && m.to.c === tc
        );
        if (found) return { move: found, source: 'ollama', prompt: promptContent, response: rawResponse };
      }

      lastError = `Ollama响应无法解析: "${text}"`;
    } catch (err) {
      if (err.name === 'AbortError') {
        lastError = 'Ollama请求超时(10s)';
      } else if (err.message === 'Failed to fetch' || err.code === 'ECONNREFUSED') {
        lastError = '无法连接Ollama (http://localhost:11434)';
      } else {
        lastError = `Ollama请求失败: ${err.message}`;
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const fallback = allMoves[Math.floor(Math.random() * allMoves.length)];
  return { move: fallback, source: 'random', error: lastError, prompt: promptContent, response: rawResponse || lastError };
}
