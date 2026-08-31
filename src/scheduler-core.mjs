export function shouldRunDhl(now = Date.now()) {
  const fiveMinuteBucket = Math.floor(Number(now) / (5 * 60 * 1000));
  return fiveMinuteBucket % 3 === 0;
}
