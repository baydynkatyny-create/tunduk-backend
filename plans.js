/ Пландар жана алардын лимиттери.
// Азыр бардыгы "free" — акы төлөө кошулганда, колдонуучунун "tier" талаасы
// "weekly"/"monthly"/"yearly" болуп өзгөрөт, ушул эле лимиттер колдонулат.

export const PLANS = {
  free: {
    label: "Бекер",
    chatPerDay: 1000,
    imagesPerDay: 3,
    videosPerDay: 1,
    priceSom: 0,
  },
  weekly: {
    label: "Жумалык",
    chatPerDay: 100,
    imagesPerDay: 20,
    videosPerDay: 5,
    priceSom: 99,
    durationDays: 7,
  },
  monthly: {
    label: "Айлык",
    chatPerDay: 300,
    imagesPerDay: 60,
    videosPerDay: 15,
    priceSom: 299,
    durationDays: 30,
  },
  yearly: {
    label: "Жылдык",
    chatPerDay: 1000,
    imagesPerDay: 200,
    videosPerDay: 60,
    priceSom: 2499,
    durationDays: 365,
  },
};

export function getPlan(tier) {
  return PLANS[tier] || PLANS.free;
}
