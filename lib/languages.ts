export type Language = {
  code: string; // BCP-47
  name: string;
  flag: string;
  rtl?: boolean;
  specialChars?: string[];
  articles?: string[];
};

export const LANGUAGES: Language[] = [
  { code: "en-US", name: "English (US)", flag: "🇺🇸", articles: ["a", "an", "the"] },
  { code: "en-GB", name: "English (UK)", flag: "🇬🇧", articles: ["a", "an", "the"] },
  {
    code: "es-ES",
    name: "Spanish (Spain)",
    flag: "🇪🇸",
    specialChars: ["á", "é", "í", "ó", "ú", "ñ", "ü", "¿", "¡"],
    articles: ["el", "la", "los", "las", "un", "una", "unos", "unas"],
  },
  {
    code: "es-MX",
    name: "Spanish (Mexico)",
    flag: "🇲🇽",
    specialChars: ["á", "é", "í", "ó", "ú", "ñ", "ü", "¿", "¡"],
    articles: ["el", "la", "los", "las", "un", "una", "unos", "unas"],
  },
  {
    code: "fr-FR",
    name: "French",
    flag: "🇫🇷",
    specialChars: ["à", "â", "æ", "ç", "é", "è", "ê", "ë", "î", "ï", "ô", "œ", "ù", "û", "ü", "ÿ"],
    articles: ["le", "la", "les", "l'", "un", "une", "des", "du"],
  },
  {
    code: "de-DE",
    name: "German",
    flag: "🇩🇪",
    specialChars: ["ä", "ö", "ü", "ß", "Ä", "Ö", "Ü"],
    articles: ["der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer"],
  },
  {
    code: "it-IT",
    name: "Italian",
    flag: "🇮🇹",
    specialChars: ["à", "è", "é", "ì", "ò", "ù"],
    articles: ["il", "lo", "la", "i", "gli", "le", "l'", "un", "uno", "una", "un'"],
  },
  {
    code: "pt-BR",
    name: "Portuguese (Brazil)",
    flag: "🇧🇷",
    specialChars: ["á", "â", "ã", "à", "ç", "é", "ê", "í", "ó", "ô", "õ", "ú"],
    articles: ["o", "a", "os", "as", "um", "uma", "uns", "umas"],
  },
  {
    code: "pt-PT",
    name: "Portuguese (Portugal)",
    flag: "🇵🇹",
    specialChars: ["á", "â", "ã", "à", "ç", "é", "ê", "í", "ó", "ô", "õ", "ú"],
    articles: ["o", "a", "os", "as", "um", "uma", "uns", "umas"],
  },
  { code: "nl-NL", name: "Dutch", flag: "🇳🇱", specialChars: ["é", "ë", "ï", "ĳ"], articles: ["de", "het", "een"] },
  { code: "sv-SE", name: "Swedish", flag: "🇸🇪", specialChars: ["å", "ä", "ö"], articles: ["en", "ett"] },
  { code: "nb-NO", name: "Norwegian", flag: "🇳🇴", specialChars: ["æ", "ø", "å"], articles: ["en", "ei", "et"] },
  { code: "da-DK", name: "Danish", flag: "🇩🇰", specialChars: ["æ", "ø", "å"], articles: ["en", "et"] },
  { code: "fi-FI", name: "Finnish", flag: "🇫🇮", specialChars: ["ä", "ö", "å"] },
  { code: "pl-PL", name: "Polish", flag: "🇵🇱", specialChars: ["ą", "ć", "ę", "ł", "ń", "ó", "ś", "ź", "ż"] },
  { code: "cs-CZ", name: "Czech", flag: "🇨🇿", specialChars: ["á", "č", "ď", "é", "ě", "í", "ň", "ó", "ř", "š", "ť", "ú", "ů", "ý", "ž"] },
  { code: "ro-RO", name: "Romanian", flag: "🇷🇴", specialChars: ["ă", "â", "î", "ș", "ț"] },
  { code: "hu-HU", name: "Hungarian", flag: "🇭🇺", specialChars: ["á", "é", "í", "ó", "ö", "ő", "ú", "ü", "ű"], articles: ["a", "az", "egy"] },
  { code: "el-GR", name: "Greek", flag: "🇬🇷", specialChars: ["ά", "έ", "ή", "ί", "ό", "ύ", "ώ", "ϊ", "ϋ", "ΐ", "ΰ"], articles: ["ο", "η", "το", "οι", "τα", "ένας", "μία", "ένα"] },
  { code: "tr-TR", name: "Turkish", flag: "🇹🇷", specialChars: ["ç", "ğ", "ı", "İ", "ö", "ş", "ü"] },
  { code: "ru-RU", name: "Russian", flag: "🇷🇺", specialChars: ["ё", "й", "ъ", "ь"] },
  { code: "uk-UA", name: "Ukrainian", flag: "🇺🇦", specialChars: ["є", "і", "ї", "ґ", "'"] },
  { code: "ar-SA", name: "Arabic", flag: "🇸🇦", rtl: true },
  { code: "he-IL", name: "Hebrew", flag: "🇮🇱", rtl: true },
  { code: "fa-IR", name: "Persian", flag: "🇮🇷", rtl: true },
  { code: "hi-IN", name: "Hindi", flag: "🇮🇳" },
  { code: "id-ID", name: "Indonesian", flag: "🇮🇩" },
  { code: "vi-VN", name: "Vietnamese", flag: "🇻🇳", specialChars: ["ă", "â", "đ", "ê", "ô", "ơ", "ư", "à", "á", "ả", "ã", "ạ"] },
  { code: "th-TH", name: "Thai", flag: "🇹🇭" },
  { code: "zh-CN", name: "Chinese (Simplified)", flag: "🇨🇳" },
  { code: "zh-TW", name: "Chinese (Traditional)", flag: "🇹🇼" },
  { code: "ja-JP", name: "Japanese", flag: "🇯🇵" },
  { code: "ko-KR", name: "Korean", flag: "🇰🇷" },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [string, ...string[]];

export function getLanguage(code: string): Language {
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
