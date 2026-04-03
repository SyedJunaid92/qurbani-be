/**
 * @param {number} currentCow — active cow number (1-based: first cow is 1)
 * @param {number} sharesFilledOnCurrentCow — count of shares already taken on this cow (0–6)
 * @param {number} requestedShares — positive integer
 * @returns {{ segments: Array<{ cowNumber: number, fromShare: number, toShare: number, shareNumbers: number[], shareCount: number }>, assignments: Array<{ cowNumber: number, shareNumber: number }>, nextCow: number, nextFilled: number }}
 */
export function computeAllocation(currentCow, sharesFilledOnCurrentCow, requestedShares) {
  if (requestedShares < 1 || !Number.isInteger(requestedShares)) {
    throw new Error('shares must be a positive integer');
  }
  if (sharesFilledOnCurrentCow < 0 || sharesFilledOnCurrentCow > 6) {
    throw new Error('invalid allocation state');
  }

  let cow = currentCow;
  let filled = sharesFilledOnCurrentCow;
  let remaining = requestedShares;
  const segments = [];
  const assignments = [];

  while (remaining > 0) {
    const spaceOnCow = 7 - filled;
    const take = Math.min(spaceOnCow, remaining);
    const fromShare = filled + 1;
    const toShare = filled + take;
    const shareNumbers = [];
    for (let s = fromShare; s <= toShare; s += 1) {
      shareNumbers.push(s);
      assignments.push({ cowNumber: cow, shareNumber: s });
    }
    segments.push({
      cowNumber: cow,
      fromShare,
      toShare,
      shareNumbers,
      shareCount: shareNumbers.length
    });
    filled += take;
    remaining -= take;
    if (filled === 7) {
      cow += 1;
      filled = 0;
    }
  }

  return { segments, assignments, nextCow: cow, nextFilled: filled };
}
