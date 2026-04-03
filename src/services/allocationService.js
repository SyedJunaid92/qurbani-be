/**
 * Allocation rules:
 * - Each booking is processed in chunks of at most 7 shares (one cow per chunk).
 * - Each chunk must sit entirely on a single cow (shares are consecutive on that cow).
 * - When placing a chunk, use the smallest cow number that has enough free slots (7 - filled >= chunk).
 * - If no existing cow fits, start a new cow (maxCow + 1) and leave partial cows' trailing slots for later bookings.
 *
 * @param {Array<{ cowNumber: number, filled: number }>} cowsInput — prefix-filled slots per cow, sorted or not
 * @param {number} requestedShares — positive integer
 * @returns {{ segments: Array<{ cowNumber: number, fromShare: number, toShare: number, shareNumbers: number[], shareCount: number }>, assignments: Array<{ cowNumber: number, shareNumber: number }>, nextCows: Array<{ cowNumber: number, filled: number }> }}
 */
export function computeAllocationFromCows(cowsInput, requestedShares) {
  if (requestedShares < 1 || !Number.isInteger(requestedShares)) {
    throw new Error('shares must be a positive integer');
  }

  const working = (cowsInput ?? []).map((c) => ({
    cowNumber: c.cowNumber,
    filled: c.filled
  }));

  for (const c of working) {
    if (c.filled < 0 || c.filled > 7) {
      throw new Error('invalid cow state');
    }
  }

  const segments = [];
  const assignments = [];
  let remaining = requestedShares;

  while (remaining > 0) {
    const chunk = Math.min(7, remaining);
    const sorted = [...working].sort((a, b) => a.cowNumber - b.cowNumber);
    const idx = sorted.findIndex((c) => 7 - c.filled >= chunk);

    let cowNumber;
    let fromShare;
    let toShare;

    if (idx >= 0) {
      const target = sorted[idx];
      cowNumber = target.cowNumber;
      fromShare = target.filled + 1;
      toShare = target.filled + chunk;
      const w = working.find((x) => x.cowNumber === cowNumber);
      w.filled += chunk;
    } else {
      const maxCow = working.length ? Math.max(...working.map((c) => c.cowNumber)) : 0;
      cowNumber = maxCow + 1;
      fromShare = 1;
      toShare = chunk;
      working.push({ cowNumber, filled: chunk });
    }

    const shareNumbers = [];
    for (let s = fromShare; s <= toShare; s += 1) {
      shareNumbers.push(s);
      assignments.push({ cowNumber, shareNumber: s });
    }
    segments.push({
      cowNumber,
      fromShare,
      toShare,
      shareNumbers,
      shareCount: chunk
    });

    remaining -= chunk;
  }

  working.sort((a, b) => a.cowNumber - b.cowNumber);
  return { segments, assignments, nextCows: working };
}
