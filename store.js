import { readFileSync, writeFileSync, existsSync } from "fs";
import { getPlan } from "./plans.js";

const DB_FILE = "./users.json";

function loadDb() {
  if (!existsSync(DB_FILE)) return {};
  try {
    return JSON.parse(readFileSync(DB_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveDb(db) {
  writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // "2026-08-06"
}

const LIMIT_KEY = { chat: "chatPerDay", images: "imagesPerDay", video: "videosPerDay" };

// Колдонуучуну табат же жаңы түзөт
function ensureUser(db, userId) {
  if (!db[userId]) {
    db[userId] = {
      tier: "free",
      tierExpiresAt: null,
      usage: { date: todayKey(), chat: 0, images: 0, video: 0 },
    };
  }
  const u = db[userId];

  // Күн алмашса — эсептегичтерди нөлдөйбүз
  if (u.usage.date !== todayKey()) {
    u.usage = { date: todayKey(), chat: 0, images: 0, video: 0 };
  }
  // Эски колдонуучуларда "video" талаасы жок болушу мүмкүн
  if (u.usage.video === undefined) u.usage.video = 0;

  // Акылуу план мөөнөтү бүтсө — "free"'ге кайтарабыз
  if (u.tierExpiresAt && new Date(u.tierExpiresAt) < new Date()) {
    u.tier = "free";
    u.tierExpiresAt = null;
  }

  return u;
}

// kind: "chat" | "images" | "video"
export function checkAndIncrement(userId, kind) {
  const db = loadDb();
  const user = ensureUser(db, userId);
  const plan = getPlan(user.tier);
  const limit = plan[LIMIT_KEY[kind]];
  const used = user.usage[kind];

  if (used >= limit) {
    saveDb(db);
    return { allowed: false, used, limit, tier: user.tier };
  }

  user.usage[kind] += 1;
  saveDb(db);
  return { allowed: true, used: user.usage[kind], limit, tier: user.tier };
}

export function getUsage(userId) {
  const db = loadDb();
  const user = ensureUser(db, userId);
  saveDb(db);
  const plan = getPlan(user.tier);
  return {
    tier: user.tier,
    tierLabel: plan.label,
    tierExpiresAt: user.tierExpiresAt,
    chat: { used: user.usage.chat, limit: plan.chatPerDay },
    images: { used: user.usage.images, limit: plan.imagesPerDay },
    video: { used: user.usage.video, limit: plan.videosPerDay },
  };
}

// Кийин төлөм системасы ушул функцияны чакырат (webhook аркылуу)
export function setTier(userId, tier, durationDays) {
  const db = loadDb();
  const user = ensureUser(db, userId);
  user.tier = tier;
  user.tierExpiresAt = durationDays
    ? new Date(Date.now() + durationDays * 86400000).toISOString()
    : null;
  saveDb(db);
  return user;
}
