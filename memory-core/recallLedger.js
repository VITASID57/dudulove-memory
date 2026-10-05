'use strict';

class RecallLedger {
  constructor({ now = Date.now, ttlMs = 30 * 60 * 1000, cooldownMs = 60 * 1000, maxSessions = 500 } = {}) {
    Object.assign(this, { now, ttlMs, cooldownMs, maxSessions });
    this.sessions = new Map();
  }
  begin({ residentId, surface, sessionId, turnId, topicKey }) {
    const now = this.now();
    for (const [key, value] of this.sessions) if (value.expires <= now) this.sessions.delete(key);
    if (!sessionId) return null;
    const key = JSON.stringify([residentId, surface, String(sessionId)]);
    if (!this.sessions.has(key)) {
      if (this.sessions.size >= this.maxSessions) this.sessions.delete(this.sessions.keys().next().value);
      this.sessions.set(key, { turn: 0, entries: new Map() });
    }
    const session = this.sessions.get(key);
    if (!turnId || session.turnId !== turnId) session.turn++;
    Object.assign(session, { turnId, topicKey, expires: now + this.ttlMs });
    return session;
  }
  allows(session, id) {
    if (!session) return true;
    const entry = session.entries.get(id);
    if (!entry) return true;
    if (entry.stickyUntil > this.now() && entry.topicKey && entry.topicKey === session.topicKey) return true;
    return session.turn > entry.lastSurfacedTurn + 1 && this.now() >= entry.cooldownUntil;
  }
  record(session, items, { stickyMs = 0 } = {}) {
    if (!session) return;
    for (const item of items) {
      const old = session.entries.get(item.id);
      session.entries.set(item.id, {
        memoryId: item.id, lastSurfacedTurn: session.turn, timestamp: this.now(),
        surfacedCount: (old?.surfacedCount || 0) + 1,
        stickyUntil: this.now() + Math.min(Math.max(Number(stickyMs) || 0, 0), 120000),
        cooldownUntil: this.now() + this.cooldownMs, topicKey: session.topicKey,
      });
    }
    while (session.entries.size > 200) session.entries.delete(session.entries.keys().next().value);
  }
  end({ residentId, surface, sessionId }) { this.sessions.delete(JSON.stringify([residentId, surface, String(sessionId)])); }
}
module.exports = { RecallLedger, recallLedger: new RecallLedger() };
