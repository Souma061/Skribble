export function calculateRemainingSeconds(roundEndsAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((roundEndsAt - now) / 1000));
}

export function crossedTimeThreshold(
  previousTimeLeft: number,
  currentTimeLeft: number,
  threshold: number,
): boolean {
  return previousTimeLeft > threshold && currentTimeLeft <= threshold;
}
