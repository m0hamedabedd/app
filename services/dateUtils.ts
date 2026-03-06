export const toLocalDateKey = (input: Date | string | number): string => {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const isTimestampOnLocalDate = (timestamp: string, localDateKey: string): boolean => {
  if (!timestamp || !localDateKey) return false;
  return toLocalDateKey(timestamp) === localDateKey;
};
