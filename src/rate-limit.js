const buckets = new Map();

function nowMs() {
  return Date.now();
}

function pruneBucket(bucket, windowMs, now) {
  while (bucket.length > 0 && now - bucket[0] > windowMs) {
    bucket.shift();
  }
}

export function checkRateLimit(key, { max, windowMs }) {
  const now = nowMs();
  const bucket = buckets.get(key) || [];
  pruneBucket(bucket, windowMs, now);

  if (bucket.length >= max) {
    const retryAfterMs = windowMs - (now - bucket[0]);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  bucket.push(now);
  buckets.set(key, bucket);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function formatRetryAfter(seconds) {
  if (seconds < 60) {
    return "a minute";
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
