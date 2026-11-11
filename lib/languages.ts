export type Language = {
  code: string; // BCP-47
  name: string;
  flag: string;
  rtl?: boolean;
  specialChars?: string[];
  articles?: string[];
  /** Languages whose nouns have a gender shown by the definite article (Articles & plurals game). */
  gender?: { articles: string[] };
};

export const LANGUAGES: Language[] = [
  { code: "en-US", name: "English", flag: "🇬🇧", articles: ["a", "an", "the"] },
  {
    code: "es-ES",
    name: "Spanish",
    flag: "🇪🇸",
    specialChars: ["á", "é", "í", "ó", "ú", "ñ", "ü", "¿", "¡"],
    articles: ["el", "la", "los", "las", "un", "una", "unos", "unas"],
    gender: { articles: ["el", "la"] },
  },
  {
    code: "fr-FR",
    name: "French",
    flag: "🇫🇷",
    specialChars: ["à", "â", "æ", "ç", "é", "è", "ê", "ë", "î", "ï", "ô", "œ", "ù", "û", "ü", "ÿ"],
    articles: ["le", "la", "les", "l'", "un", "une", "des", "du"],
    gender: { articles: ["le", "la", "l'"] },
  },
  {
    code: "de-DE",
    name: "German",
    flag: "🇩🇪",
    specialChars: ["ä", "ö", "ü", "ß", "Ä", "Ö", "Ü"],
    articles: ["der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer"],
    gender: { articles: ["der", "die", "das"] },
  },
  {
    code: "it-IT",
    name: "Italian",
    flag: "🇮🇹",
    specialChars: ["à", "è", "é", "ì", "ò", "ù"],
    articles: ["il", "lo", "la", "i", "gli", "le", "l'", "un", "uno", "una", "un'"],
    gender: { articles: ["il", "lo", "la", "l'"] },
  },
  {
    code: "pt-BR",
    name: "Portuguese",
    flag: "🇵🇹",
    specialChars: ["á", "â", "ã", "à", "ç", "é", "ê", "í", "ó", "ô", "õ", "ú"],
    articles: ["o", "a", "os", "as", "um", "uma", "uns", "umas"],
    gender: { articles: ["o", "a"] },
  },
  { code: "ar-SA", name: "Arabic", flag: "🇸🇦", rtl: true },
];

/** Older language variants map onto the one version that's kept (see migration 0006). */
export const LANGUAGE_ALIASES: Record<string, string> = { "en-GB": "en-US", "es-MX": "es-ES", "pt-PT": "pt-BR" };

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [string, ...string[]];

export function getLanguage(code: string): Language {
  code = LANGUAGE_ALIASES[code] ?? code;
  return (
    LANGUAGES.find((l) => l.code === code) ??
    LANGUAGES.find((l) => l.code.split("-")[0] === code.split("-")[0]) ?? {
      code,
      name: code,
      flag: "🏳️",
    }
  );
}

export function isRtl(code: string): boolean {
  return Boolean(getLanguage(code).rtl);
}

export function langDir(code: string): "rtl" | "ltr" {
  return isRtl(code) ? "rtl" : "ltr";
}

export function languageName(code: string): string {
  return getLanguage(code).name.replace(/ \(.*\)$/, "");
}

export function isEnglish(code: string): boolean {
  return code.toLowerCase().startsWith("en");
}

/** The definite articles a noun of this language can take (empty when the language has no gendered articles). */
export function genderArticles(code: string): string[] {
  return getLanguage(code).gender?.articles ?? [];
}
