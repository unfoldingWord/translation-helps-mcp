import { describe, expect, it } from "vitest";
import {
  notesFromViews,
  wordLinksFromViews,
  type PackViews,
} from "../../src/api/routes/packViews.js";

const note = (over: Record<string, unknown>) => ({
  id: "x",
  reference: "2:1",
  verse: 1,
  intro: null,
  quote: "λάλει",
  occurrence: "1",
  note: "",
  tags: "",
  supportReference: "rc://*/ta/man/translate/figs-you",
  supportReferenceTitle: "Formas de «usted»",
  aligned: { literal: "habla", simple: "enseña" },
  ...over,
});

const views = (files: Record<string, unknown>): PackViews => ({
  get: async (path) => files[path] ?? null,
});

const chapter = (book: string, n: number, notes: unknown[]) => ({
  schema: 1,
  language: "es-419",
  book,
  chapter: n,
  sources: { notes: { key: "es-419_gl/es-419/tn", title: "Notas", version: "v66" } },
  notes,
});

const files = {
  "es-419/notes/TIT/1.json": chapter("TIT", 1, [
    note({ id: "book", reference: "front:intro", verse: "intro", intro: "book" }),
    note({ id: "ch1", reference: "1:intro", verse: "intro", intro: "chapter" }),
  ]),
  "es-419/notes/TIT/2.json": chapter("TIT", 2, [
    note({ id: "ch2", reference: "2:intro", verse: "intro", intro: "chapter" }),
    note({ id: "a", reference: "2:1", verse: 1 }),
    note({ id: "b", reference: "2:12", verse: 12, aligned: { literal: "instruyéndonos", simple: null } }),
    note({ id: "c", reference: "2:13-14", verse: 13, to: 14 }),
  ]),
  "es-419/word-links/TIT/2.json": {
    ...chapter("TIT", 2, []),
    links: [
      { id: "w1", reference: "2:12", verse: 12, origWords: "ἀσέβειαν", occurrence: "1", tags: "", twLink: "rc://*/tw/dict/bible/kt/godly", articlePath: "bible/kt/godly", title: "piadoso", aligned: { literal: "impiedad", simple: "lo que es incorrecto" } },
    ],
  },
};

describe("notas y enlaces leídos de las vistas de los paquetes", () => {
  it("dan las introducciones del libro y del capítulo, y las notas del versículo con sus palabras en los dos textos", async () => {
    const got = await notesFromViews(views(files), { language: "es-419", book: "TIT", chapter: "2", verseStart: "12" });
    expect(got?.notes.map((n) => n.id)).toEqual(["book", "ch2", "b"]);
    expect(got?.notes[0]).toMatchObject({ chapter: "front", verse: "intro" });
    expect(got?.notes[2]).toMatchObject({
      book: "TIT",
      chapter: "2",
      verse: "12",
      gatewayQuote: { original: "λάλει", aligned: "instruyéndonos", simple: "" },
      supportReferenceTitle: "Formas de «usted»",
    });
  });

  it("un rango trae las notas de todos sus versículos, también la de una nota que abarca dos", async () => {
    const got = await notesFromViews(views(files), { language: "es-419", book: "TIT", chapter: "2", verseStart: "12", verseEnd: "14" });
    expect(got?.notes.filter((n) => n.verse !== "intro").map((n) => n.id)).toEqual(["b", "c"]);
    const one = await notesFromViews(views(files), { language: "es-419", book: "TIT", chapter: "2", verseStart: "14" });
    expect(one?.notes.filter((n) => n.verse !== "intro").map((n) => n.id)).toEqual(["c"]);
  });

  it("«es» se busca como «es-419»; un idioma o un capítulo sin vista sigue por Door43 (null)", async () => {
    expect((await notesFromViews(views(files), { language: "es", book: "TIT", chapter: "2" }))?.language).toBe("es-419");
    expect(await notesFromViews(views(files), { language: "fr", book: "TIT", chapter: "2" })).toBeNull();
    expect(await notesFromViews(views(files), { language: "es-419", book: "TIT", chapter: "3" })).toBeNull();
  });

  it("los enlaces de palabras traen su título y sus palabras, con los campos del camino de Door43", async () => {
    const got = await wordLinksFromViews(views(files), { language: "es-419", book: "TIT", chapter: "2", verseStart: "12" });
    expect(got?.wordLinks[0]).toMatchObject({
      twId: "w1",
      wordPath: "bible/kt/godly",
      twTitle: "piadoso",
      gatewayQuote: { aligned: "impiedad", simple: "lo que es incorrecto" },
    });
  });
});
