// Small UX helpers so instant operations still feel like a real app: a brief,
// randomised loading beat (never the same twice) that runs alongside the real
// work, so the spinner shows for a natural moment even when the backend is fast.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A random duration in [min, max) — keeps loading feeling organic.
export const randMs = (min = 600, max = 1500) => min + Math.random() * (max - min);

// Run an async action but keep it "loading" for at least a random beat.
export async function withMinTime(fn, min = 600, max = 1500) {
  const [res] = await Promise.all([
    Promise.resolve().then(fn),
    sleep(randMs(min, max)),
  ]);
  return res;
}
