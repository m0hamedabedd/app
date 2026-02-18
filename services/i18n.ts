export type AppLanguage = 'en' | 'ar';

export const resolveLanguage = (language?: string): AppLanguage => {
  return language === 'ar' ? 'ar' : 'en';
};

export const isArabicLanguage = (language?: string): boolean => {
  return resolveLanguage(language) === 'ar';
};

export const tr = (language: string | undefined, enText: string, arText: string): string => {
  return isArabicLanguage(language) ? arText : enText;
};

export const localeForLanguage = (language?: string): string => {
  return isArabicLanguage(language) ? 'ar-EG' : 'en-US';
};
