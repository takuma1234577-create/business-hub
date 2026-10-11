'use strict';
// 外れ値スコア: その投稿者の「普段の再生数」に対して何倍伸びたか。
// 大きいアカウントの平常運転より、小さいアカウントの突然のヒットを上に出すための指標。

function median(nums) {
  const xs = nums.filter((n) => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// 普段の再生数 = 対象動画を除いた直近動画の再生数の中央値
function baselineOf(feed, excludeId) {
  return median(feed.filter((v) => v.id !== excludeId).map((v) => v.views));
}

function outlierScore(views, baseline) {
  if (typeof views !== 'number' || typeof baseline !== 'number') return null;
  return Math.round((views / Math.max(baseline, 100)) * 10) / 10;
}

function tier(score) {
  if (score == null) return 'unknown';
  if (score >= 30) return 'exceptional';
  if (score >= 10) return 'viral';
  if (score >= 3) return 'good';
  return 'normal';
}

function rankOutliers(videos) {
  return [...videos].sort((a, b) => {
    const sa = a.score ?? -1;
    const sb = b.score ?? -1;
    if (sa !== sb) return sb - sa;
    return (b.views ?? 0) - (a.views ?? 0);
  });
}

module.exports = { median, baselineOf, outlierScore, tier, rankOutliers };
