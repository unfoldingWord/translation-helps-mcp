/**
 * Reference Parser
 * Parse Bible references into structured format
 */

export interface ParsedReference {
  book: string;
  chapter?: number;
  verse?: number;
  endChapter?: number;
  endVerse?: number;
  originalText: string;
  isValid: boolean;
}

/**
 * Parse a Bible reference string into structured data
 */
export function parseReference(referenceString: string): ParsedReference {
  const originalText = referenceString;

  if (!referenceString || typeof referenceString !== "string") {
    return {
      book: "",
      originalText,
      isValid: false,
    };
  }

  // Clean the input
  const cleaned = referenceString.trim();
  // Normalize leading book part only, keep chapter/verse suffixes intact
  const split = cleaned.split(/\s+/);
  if (split.length > 0) {
    split[0] = normalizeBookAbbreviation(split[0]);
  }
  const normalizedInput = split.join(" ");

  // Normalize common abbreviations before parsing
  function normalizeBookAbbreviation(raw: string): string {
    if (!raw) return raw;
    const input = raw.trim();
    const lower = input.toLowerCase();

    // Handle numeric prefixes like 1Co, 1 Cor, 1Jn, etc.
    const m = lower.match(/^(\d)\s*([a-z]+)/);
    let numPrefix: string | null = null;
    let base = lower;
    if (m) {
      numPrefix = m[1];
      base = m[2];
    }

    const map: Record<string, string> = {
      // ── English abbreviations ──────────────────────────────────────────────
      gen: "Genesis",
      ge: "Genesis",
      gn: "Genesis",
      ex: "Exodus",
      exo: "Exodus",
      lev: "Leviticus",
      le: "Leviticus",
      num: "Numbers",
      nu: "Numbers",
      deut: "Deuteronomy",
      deu: "Deuteronomy",
      dt: "Deuteronomy",
      jos: "Joshua",
      josh: "Joshua",
      jdgs: "Judges",
      jdg: "Judges",
      rut: "Ruth",
      ru: "Ruth",
      sam: "Samuel",
      ki: "Kings",
      ch: "Chronicles",
      ezr: "Ezra",
      neh: "Nehemiah",
      est: "Esther",
      job: "Job",
      psa: "Psalms",
      ps: "Psalms",
      pro: "Proverbs",
      pr: "Proverbs",
      ecc: "Ecclesiastes",
      sng: "Song of Songs",
      sos: "Song of Songs",
      isa: "Isaiah",
      jer: "Jeremiah",
      lam: "Lamentations",
      ezk: "Ezekiel",
      dan: "Daniel",
      hos: "Hosea",
      jol: "Joel",
      amo: "Amos",
      oba: "Obadiah",
      jon: "Jonah",
      mic: "Micah",
      nam: "Nahum",
      hab: "Habakkuk",
      zep: "Zephaniah",
      hag: "Haggai",
      zec: "Zechariah",
      mal: "Malachi",
      mat: "Matthew",
      mt: "Matthew",
      mrk: "Mark",
      mk: "Mark",
      luk: "Luke",
      lk: "Luke",
      jhn: "John",
      joh: "John",
      // Ensure bare 'jn' maps to Gospel of John, not numbered epistles
      jn: "John",
      act: "Acts",
      rom: "Romans",
      ro: "Romans",
      cor: "Corinthians",
      co: "Corinthians",
      gal: "Galatians",
      eph: "Ephesians",
      php: "Philippians",
      col: "Colossians",
      th: "Thessalonians",
      ti: "Titus",
      phm: "Philemon",
      heb: "Hebrews",
      jas: "James",
      pe: "Peter",
      jn1: "1 John",
      jn2: "2 John",
      jn3: "3 John",
      jud: "Jude",
      rev: "Revelation",
      re: "Revelation",
      // ── Spanish full names ─────────────────────────────────────────────────
      genesis: "Genesis",
      exodo: "Exodus",
      levitico: "Leviticus",
      numeros: "Numbers",
      deuteronomio: "Deuteronomy",
      josue: "Joshua",
      jueces: "Judges",
      jue: "Judges",
      reyes: "Kings",
      rey: "Kings",
      cronicas: "Chronicles",
      cron: "Chronicles",
      esdras: "Ezra",
      esd: "Ezra",
      nehemias: "Nehemiah",
      ester: "Esther",
      salmos: "Psalms",
      sal: "Psalms",
      proverbios: "Proverbs",
      eclesiastes: "Ecclesiastes",
      ecl: "Ecclesiastes",
      cantares: "Song of Songs",
      cnt: "Song of Songs",
      isaias: "Isaiah",
      jeremias: "Jeremiah",
      lamentaciones: "Lamentations",
      ezequiel: "Ezekiel",
      eze: "Ezekiel",
      oseas: "Hosea",
      ose: "Hosea",
      joel: "Joel",
      amos: "Amos",
      abdias: "Obadiah",
      abd: "Obadiah",
      jonas: "Jonah",
      miqueas: "Micah",
      miq: "Micah",
      nahum: "Nahum",
      habacuc: "Habakkuk",
      sofonias: "Zephaniah",
      sof: "Zephaniah",
      hageo: "Haggai",
      zacarias: "Zechariah",
      zac: "Zechariah",
      malaquias: "Malachi",
      mateo: "Matthew",
      marcos: "Mark",
      mar: "Mark",
      lucas: "Luke",
      luc: "Luke",
      juan: "John",
      hechos: "Acts",
      hch: "Acts",
      romanos: "Romans",
      corintios: "Corinthians",
      galatas: "Galatians",
      efesios: "Ephesians",
      efe: "Ephesians",
      filipenses: "Philippians",
      fil: "Philippians",
      colosenses: "Colossians",
      tesalonicenses: "Thessalonians",
      tes: "Thessalonians",
      timoteo: "Timothy",
      tim: "Timothy",
      tito: "Titus",
      filemon: "Philemon",
      flm: "Philemon",
      hebreos: "Hebrews",
      santiago: "James",
      sant: "James",
      pedro: "Peter",
      judas: "Jude",
      apocalipsis: "Revelation",
      apoc: "Revelation",
    };

    // Special handling for numbered books (e.g., 1Co -> 1 Corinthians)
    if (numPrefix) {
      if (base.startsWith("co") || base.startsWith("cor"))
        return `${numPrefix} Corinthians`;
      if (base.startsWith("th") || base.startsWith("tes"))
        return `${numPrefix} Thessalonians`;
      if (base.startsWith("tim")) return `${numPrefix} Timothy`;
      if (base.startsWith("ti")) return `${numPrefix} Timothy`;
      if (base.startsWith("pe") || base.startsWith("ped"))
        return `${numPrefix} Peter`;
      // Only map to numbered John epistles when an explicit number is present
      if (base === "jn" || base === "jhn" || base === "john" || base === "juan")
        return `${numPrefix} John`;
      if (base.startsWith("sa")) return `${numPrefix} Samuel`;
      if (base.startsWith("ki") || base.startsWith("rey"))
        return `${numPrefix} Kings`;
      if (base.startsWith("ch") || base.startsWith("cron"))
        return `${numPrefix} Chronicles`;
    }

    const mapped = map[base] || map[lower] || null;
    if (mapped) return mapped;

    // If nothing matched, capitalize first letter of each word as fallback
    return input.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Pattern to match various reference formats
  const patterns = [
    // Cross-chapter verse range: "Genesis 1:1-2:3"
    /^(.+?)\s+(\d+):(\d+)-(\d+):(\d+)$/,
    // Full reference with verse range: "Genesis 1:1-3"
    /^(.+?)\s+(\d+):(\d+)-(\d+)$/,
    // Full reference single verse: "Genesis 1:1"
    /^(.+?)\s+(\d+):(\d+)$/,
    // Chapter range: "Genesis 1-3"
    /^(.+?)\s+(\d+)-(\d+)$/,
    // Chapter only: "Genesis 1"
    /^(.+?)\s+(\d+)$/,
    // Book only: "Genesis"
    /^(.+)$/,
  ];

  let result: ParsedReference | null = null;

  // Cross-chapter verse range
  const crossChapterMatch = normalizedInput.match(patterns[0]);
  if (crossChapterMatch) {
    const [, book, startChapter, startVerse, endChapter, endVerse] =
      crossChapterMatch;
    result = {
      book: book.trim(),
      chapter: parseInt(startChapter, 10),
      verse: parseInt(startVerse, 10),
      endChapter: parseInt(endChapter, 10),
      endVerse: parseInt(endVerse, 10),
      originalText,
      isValid: true,
    };
  }

  // Try other patterns if no cross-chapter match
  if (!result) {
    for (let i = 1; i < patterns.length; i++) {
      const match = normalizedInput.match(patterns[i]);
      if (match) {
        if (i === 1) {
          // Verse range within same chapter
          const [, book, chapter, verse, endVerse] = match;
          result = {
            book: book.trim(),
            chapter: parseInt(chapter, 10),
            verse: parseInt(verse, 10),
            endVerse: parseInt(endVerse, 10),
            originalText,
            isValid: true,
          };
        } else if (i === 2) {
          // Single verse
          const [, book, chapter, verse] = match;
          result = {
            book: book.trim(),
            chapter: parseInt(chapter, 10),
            verse: parseInt(verse, 10),
            originalText,
            isValid: true,
          };
        } else if (i === 3) {
          // Chapter range
          const [, book, startChapter, endChapter] = match;
          result = {
            book: book.trim(),
            chapter: parseInt(startChapter, 10),
            endChapter: parseInt(endChapter, 10),
            originalText,
            isValid: true,
          };
        } else if (i === 4) {
          // Single chapter
          const [, book, chapter] = match;
          result = {
            book: book.trim(),
            chapter: parseInt(chapter, 10),
            originalText,
            isValid: true,
          };
        } else {
          // Book only
          const [, book] = match;
          result = {
            book: book.trim(),
            originalText,
            isValid: true,
          };
        }
        break;
      }
    }
  }

  // Return the result or default
  return (
    result || {
      book: normalizedInput,
      originalText,
      isValid: Boolean(cleaned),
    }
  );
}

/**
 * Validate if a parsed reference is well-formed
 */
export function isValidReference(ref: ParsedReference): boolean {
  if (!ref.book) return false;

  // Chapter should be positive if present
  if (ref.chapter !== undefined && ref.chapter <= 0) return false;

  // Verse should be positive if present
  if (ref.verse !== undefined && ref.verse <= 0) return false;

  // End verse should be >= start verse if present
  if (
    ref.endVerse !== undefined &&
    ref.verse !== undefined &&
    ref.endVerse < ref.verse
  ) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// USFM code lookup
// ---------------------------------------------------------------------------

/** Map full/common English book names to USFM 3-letter codes. */
const BOOK_NAME_TO_USFM: Record<string, string> = {
  Genesis: "GEN",
  Exodus: "EXO",
  Leviticus: "LEV",
  Numbers: "NUM",
  Deuteronomy: "DEU",
  Joshua: "JOS",
  Judges: "JDG",
  Ruth: "RUT",
  "1 Samuel": "1SA",
  "2 Samuel": "2SA",
  "1 Kings": "1KI",
  "2 Kings": "2KI",
  "1 Chronicles": "1CH",
  "2 Chronicles": "2CH",
  Ezra: "EZR",
  Nehemiah: "NEH",
  Esther: "EST",
  Job: "JOB",
  Psalms: "PSA",
  Psalm: "PSA",
  Proverbs: "PRO",
  Ecclesiastes: "ECC",
  "Song of Songs": "SNG",
  "Song of Solomon": "SNG",
  Isaiah: "ISA",
  Jeremiah: "JER",
  Lamentations: "LAM",
  Ezekiel: "EZK",
  Daniel: "DAN",
  Hosea: "HOS",
  Joel: "JOL",
  Amos: "AMO",
  Obadiah: "OBA",
  Jonah: "JON",
  Micah: "MIC",
  Nahum: "NAM",
  Habakkuk: "HAB",
  Zephaniah: "ZEP",
  Haggai: "HAG",
  Zechariah: "ZEC",
  Malachi: "MAL",
  Matthew: "MAT",
  Mark: "MRK",
  Luke: "LUK",
  John: "JHN",
  Acts: "ACT",
  Romans: "ROM",
  "1 Corinthians": "1CO",
  "2 Corinthians": "2CO",
  Galatians: "GAL",
  Ephesians: "EPH",
  Philippians: "PHP",
  Colossians: "COL",
  "1 Thessalonians": "1TH",
  "2 Thessalonians": "2TH",
  "1 Timothy": "1TI",
  "2 Timothy": "2TI",
  Titus: "TIT",
  Philemon: "PHM",
  Hebrews: "HEB",
  James: "JAS",
  "1 Peter": "1PE",
  "2 Peter": "2PE",
  "1 John": "1JN",
  "2 John": "2JN",
  "3 John": "3JN",
  Jude: "JUD",
  Revelation: "REV",
  // ── Spanish full names ─────────────────────────────────────────────────────
  "Génesis": "GEN",
  "Éxodo": "EXO",
  "Exodo": "EXO",
  "Levítico": "LEV",
  "Levitico": "LEV",
  "Números": "NUM",
  "Numeros": "NUM",
  "Deuteronomio": "DEU",
  "Josué": "JOS",
  "Josue": "JOS",
  "Jueces": "JDG",
  "1 Reyes": "1KI",
  "2 Reyes": "2KI",
  "1 Crónicas": "1CH",
  "2 Crónicas": "2CH",
  "1 Cronicas": "1CH",
  "2 Cronicas": "2CH",
  "Esdras": "EZR",
  "Nehemías": "NEH",
  "Nehemias": "NEH",
  "Ester": "EST",
  "Salmos": "PSA",
  "Salmo": "PSA",
  "Proverbios": "PRO",
  "Eclesiastés": "ECC",
  "Eclesiastes": "ECC",
  "Cantares": "SNG",
  "Cantar de los Cantares": "SNG",
  "Isaías": "ISA",
  "Isaias": "ISA",
  "Jeremías": "JER",
  "Jeremias": "JER",
  "Lamentaciones": "LAM",
  "Ezequiel": "EZK",
  "Oseas": "HOS",
  "Amós": "AMO",
  "Abdías": "OBA",
  "Abdias": "OBA",
  "Jonás": "JON",
  "Jonas": "JON",
  "Miqueas": "MIC",
  "Nahúm": "NAM",
  "Habacuc": "HAB",
  "Sofonías": "ZEP",
  "Sofonias": "ZEP",
  "Hageo": "HAG",
  "Zacarías": "ZEC",
  "Zacarias": "ZEC",
  "Malaquías": "MAL",
  "Malaquias": "MAL",
  "Mateo": "MAT",
  "Marcos": "MRK",
  "Lucas": "LUK",
  "Juan": "JHN",
  "Hechos": "ACT",
  "Romanos": "ROM",
  "1 Corintios": "1CO",
  "2 Corintios": "2CO",
  "Gálatas": "GAL",
  "Galatas": "GAL",
  "Efesios": "EPH",
  "Filipenses": "PHP",
  "Colosenses": "COL",
  "1 Tesalonicenses": "1TH",
  "2 Tesalonicenses": "2TH",
  "1 Timoteo": "1TI",
  "2 Timoteo": "2TI",
  "Tito": "TIT",
  "Filemón": "PHM",
  "Filemon": "PHM",
  "Hebreos": "HEB",
  "Santiago": "JAS",
  "1 Pedro": "1PE",
  "2 Pedro": "2PE",
  "1 Juan": "1JN",
  "2 Juan": "2JN",
  "3 Juan": "3JN",
  "Judas": "JUD",
  "Apocalipsis": "REV",
};

/**
 * Convert a full/common book name to its USFM 3-letter code.
 * Falls back to the uppercased input (handles codes passed directly).
 */
export function bookNameToUsfm(bookName: string): string {
  const trimmed = bookName.trim();
  return BOOK_NAME_TO_USFM[trimmed] ?? trimmed.toUpperCase();
}

// ---------------------------------------------------------------------------
// Tool-friendly reference parsing
// ---------------------------------------------------------------------------

export interface ToolReference {
  /** USFM book code, e.g. "JHN" */
  book: string;
  chapter: string;
  verseStart?: string;
  verseEnd?: string;
}

/**
 * Parse a reference string into fields suitable for zip-file lookups.
 * Returns null if the reference has no chapter (book-only is not supported
 * by fetch tools).
 */
export function parseReferenceForTool(reference: string): ToolReference | null {
  const parsed = parseReference(reference);
  if (!parsed.isValid || !parsed.chapter) return null;

  const book = bookNameToUsfm(parsed.book);
  return {
    book,
    chapter: String(parsed.chapter),
    verseStart: parsed.verse !== undefined ? String(parsed.verse) : undefined,
    verseEnd: parsed.endVerse !== undefined ? String(parsed.endVerse) : undefined,
  };
}

/**
 * Normalize a reference to a standard format
 */
export function normalizeReference(ref: ParsedReference): string {
  if (!ref.book) return "";

  let normalized = ref.book;

  if (ref.chapter) {
    normalized += ` ${ref.chapter}`;

    // Handle chapter range
    if (ref.endChapter && ref.endChapter !== ref.chapter) {
      normalized += `-${ref.endChapter}`;
    } else if (ref.verse) {
      // Handle verse or verse range
      normalized += `:${ref.verse}`;

      if (ref.endVerse && ref.endVerse !== ref.verse) {
        normalized += `-${ref.endVerse}`;
      }
    }
  }

  return normalized;
}
