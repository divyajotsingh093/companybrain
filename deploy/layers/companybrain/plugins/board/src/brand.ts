const DOTS: Array<[number, number, number]> = [
  [56, 50, 2.5],
  [56.43, 60.132, 3.1],
  [42.336, 66.287, 3.7],
  [26.189, 53.008, 4.3],
  [30.877, 26.885, 4.9],
  [61.125, 15.762, 5.5],
  [44, 50, 2.5],
  [43.57, 39.868, 3.1],
  [57.664, 33.713, 3.7],
  [73.811, 46.992, 4.3],
  [69.123, 73.115, 4.9],
  [38.875, 84.238, 5.5],
];

const INK = "#f8f7f2";
const ACCENT = "#0fae93";

const body = DOTS.map(([cx, cy, r], i) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${i === 5 || i === 11 ? ACCENT : INK}"/>`).join("");

export const mark = (size: number): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true" style="flex-shrink:0;display:block"><rect width="100" height="100" rx="23" fill="#16181c"/><rect x="1" y="1" width="98" height="98" rx="22" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="2"/>${body}</svg>`;

export const FAVICON = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="23" fill="#16181c"/>${body}</svg>`)}`;
