export const MIN_OFFERING_YEAR = 1754;
export const CURRENT_YEAR = new Date().getFullYear();

export function getOfferingYearError(value: string) {
  if (!value.trim()) return "";
  if (!/^\d{4}$/.test(value)) {
    return `Enter a whole-number year from ${MIN_OFFERING_YEAR} to ${CURRENT_YEAR}.`;
  }

  const year = Number(value);
  if (year < MIN_OFFERING_YEAR || year > CURRENT_YEAR) {
    return `Enter a year from ${MIN_OFFERING_YEAR} to ${CURRENT_YEAR}.`;
  }
  return "";
}