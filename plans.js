// Пландар жана алардын лимиттери.
// Азыр бардыгы "free" — акы төлөө кошулганда, колдонуучунун "tier" талаасы
// "weekly"/"monthly"/"yearly" болуп өзгөрөт, ушул эле лимиттер колдонулат.
//
// ЭСКЕРТҮҮ: chat/images/videos лимиттери учурда дээрлик чексиз коюлган
// (999999). Аудио (/api/speak) "chat" эсебин колдонот, андыктан аны да
// ушул эле сан менен чектейт.

export const PLANS = {
  free: {
    label: "Бекер",
    chatPerDay: 999999,
    imagesPerDay: 999999,
    videosPerDay: 999999,
    priceSom: 0,
  },
  weekly: {
    label: "Жумалык",
    chatPerDay: 999999,
    imagesPerDay: 999999,
    videosPerDay: 999999,
    priceSom: 99,
    durationDays: 7,
  },
  monthly: {
    label: "Айлык",
    chatPerDay: 999999,
    imagesPerDay: 999999,
    videosPerDay: 999999,
    priceSom: 299,
    durationDays: 30,
  },
  yearly: {
    label: "Жылдык",
    chatPerDay: 999999,
    imagesPerDay: 999999,
    videosPerDay: 999999,
    priceSom: 2499,
    durationDays: 365,
  },
};

export function getPlan(tier) {
  return PLANS[tier] || PLANS.free;
}
