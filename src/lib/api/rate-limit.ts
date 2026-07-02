type RateLimitRecord = {
  timestamps: number[];
};

export class InMemoryRateLimiter {
  private store = new Map<string, RateLimitRecord>();
  private limit: number;
  private windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /**
   * Checks if the key is within the rate limit.
   * Returns validation result and rate limit headers helper values.
   */
  public check(key: string): {
    success: boolean;
    limit: number;
    remaining: number;
    reset: number;
  } {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let record = this.store.get(key);
    if (!record) {
      record = { timestamps: [] };
      this.store.set(key, record);
    }

    // Clean up timestamps outside the sliding window
    record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

    if (record.timestamps.length >= this.limit) {
      const oldest = record.timestamps[0] ?? now;
      const reset = oldest + this.windowMs;
      return {
        success: false,
        limit: this.limit,
        remaining: 0,
        reset,
      };
    }

    record.timestamps.push(now);
    return {
      success: true,
      limit: this.limit,
      remaining: this.limit - record.timestamps.length,
      reset: now + this.windowMs,
    };
  }

  /**
   * Helper to clean up memory periodically.
   */
  public prune() {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    for (const [key, record] of this.store.entries()) {
      record.timestamps = record.timestamps.filter((ts) => ts > windowStart);
      if (record.timestamps.length === 0) {
        this.store.delete(key);
      }
    }
  }
}

// Pre-defined rate limiters
export const trainingImportLimiter = new InMemoryRateLimiter(5, 60 * 60 * 1000); // 5 imports per hour
export const medicalImportLimiter = new InMemoryRateLimiter(5, 60 * 60 * 1000); // 5 imports per hour
export const shiftGenerateLimiter = new InMemoryRateLimiter(15, 60 * 1000);     // 15 generazioni al minuto
export const copilotLimiter = new InMemoryRateLimiter(20, 60 * 1000);           // 20 messaggi al minuto per utente
