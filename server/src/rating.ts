/**
 * 标准 Elo 评分算法（纯函数，便于单测）。
 *   - 初始分 1200，K 系数 32（业余棋类常见取值）。
 *   - 期望胜率 E(a) = 1 / (1 + 10^((Rb - Ra) / 400))。
 *   - 分差零和：A 增加的分数即 B 减少的分数。
 */
export const INITIAL_RATING = 1200;
export const K_FACTOR = 32;

/** A 相对 B 的期望胜率（0~1）。 */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/**
 * 按 A 的实际得分更新双方分段。
 * @param scoreA A 的得分：1 胜 / 0.5 和 / 0 负
 * @returns 双方新分（零和）
 */
export function updateRatings(ratingA: number, ratingB: number, scoreA: number): { a: number; b: number } {
  const expA = expectedScore(ratingA, ratingB);
  const deltaA = Math.round(K_FACTOR * (scoreA - expA));
  return { a: ratingA + deltaA, b: ratingB - deltaA };
}
