// All values are in 만원. Cash after salary is the tax base; buildings determine rent.
export const START_CASH = 300;
export const SALARY = 250;
export const BONUS = SALARY * .5;
export const LAND_TAX_RATE = 0.10;
export const BUILDINGS = [{ name: "별장" }, { name: "빌딩" }, { name: "호텔" }] as const;
export const GROUP_ECONOMY = [
  { land: [20, 24, 28, 32], costs: [5, 10, 20], rents: [15, 33, 69] },
  { land: [36, 40, 44, 48], costs: [6, 12, 24], rents: [18, 36, 81] },
  { land: [52, 56, 60, 64], costs: [8, 16, 32], rents: [24, 51, 108] },
  { land: [68, 72, 76, 80], costs: [10, 20, 40], rents: [27, 63, 135] },
  { land: [84, 88, 92, 96], costs: [12, 24, 48], rents: [33, 78, 162] },
  { land: [100, 104, 108, 112], costs: [14, 28, 56], rents: [36, 90, 189] },
  { land: [116, 120, 124, 128], costs: [16, 32, 64], rents: [45, 99, 216] },
] as const;
