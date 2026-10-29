/**
 * OBS Study Notes / Study Questions fixtures, trimmed from the live
 * unfoldingWord/en_obs-sn (v5) sn_OBS.tsv and unfoldingWord/en_obs-sq (v4)
 * sq_OBS.tsv. SN has the OBS-TN columns; SQ has the OBS-TQ columns and its
 * rows cover frame ranges (1:1-8, 1:1-16).
 *
 * SAMPLE_SQ_TSV holds every story-1 row of the real file, in file order, plus
 * the `front` row (response shortened) and the first story-2 row.
 */

/** sn_OBS.tsv columns: Reference ID Tags SupportReference Quote Occurrence Note */
export const SAMPLE_SN_TSV = [
  "Reference\tID\tTags\tSupportReference\tQuote\tOccurrence\tNote",
  "1:1\tprf0\t\t\tGod\t1\tThe term **God** refers to the eternal being who created the universe out of nothing.",
  "1:1\tqs8q\t\t\tthe beginning\t1\tThis refers to the time before anything except God existed.",
  "1:1\tb70w\t\t\tcreated\t1\tThis term here means that God made it from nothing.",
  "1:1\twcjr\t\t\tGod's Spirit\t1\tThis is the Holy Spirit.",
  "1:2\tt4c6\t\t\tlight\t1\tThis light was different than the sun.",
  "1:3\tbwkg\t\t\tsky\t1\tThis refers to all the space above the earth.",
  "2:1\tx999\t\t\t\t\tNote for story 2 only.",
].join("\n");

/** sq_OBS.tsv columns: Reference ID Tags Quote Occurrence Question Response */
export const SAMPLE_SQ_TSV = [
  "Reference\tID\tTags\tQuote\tOccurrence\tQuestion\tResponse",
  "front\tvj0h\tintro\t\t\t\t# A Guide to Using the Stories in the OBS\\n\\n## The Reason for the Stories",
  "1:1-8\ttoi2\tmeaning\t\t\tWhat did God do in order to create everything except the first people?\tGod only spoke, and the universe and everything in it appeared. In that way, he showed his great power.",
  "1:9\tegb5\tapplication\t\t\tIn what way are people like God and made in his image? How are they different than God?\tGod made people to be like God, but not the same as God.",
  "1:9-10\tnqcu\tmeaning\t\t\tIn what way did God decide to make people to be different than the animals?\tGod decided to make people in God’s image and to be like him.",
  "1:10\tjkeb\tapplication\t\t\tWhy do you think God made the man and the woman in a different way than he made the universe and the other things in the earth?\tGod creates people in a more personal way than he created everything else.",
  "1:11\to115\tmeaning\t\t\tWhat two special trees did God plant in the garden?\tGod planted many trees in the garden, but he also planted two special trees.",
  "1:11\typnk\tapplication\t\t\tWhy do you think God put the tree of the knowledge of good and evil in the garden when he did not want Adam to eat its fruit?\tGod wanted Adam to be able to choose whether or not to obey God.",
  "1:12-14\tjl8m\tmeaning\t\t\tWhat did God do so that the man would not be alone?\tGod wanted Adam to have a helper who would be like Adam.",
  "1:13\ttxrb\tapplication\t\t\tWhy do you think God made the woman from the man rather than from the soil?\tGod wanted the man and the woman to become one.",
  "1:14\tndh8\tapplication\t\t\tHow do you think a man becomes one with his wife?\tGod wants a man and his wife to have a special bond that is closer than their connection to any other person.",
  "1:1-15\ttmdk\tmeaning\t\t\tWhat all did God create?\tGod made the universe and everything in it.",
  "1:15\tsnic\tapplication\t\t\tWhy did God decide that everything he had made was very good?\tGod created everything so that everything would work together to accomplish what he wanted to happen.",
  "1:16\tfs3g\tmeaning\t\t\tWhat did God do after he finished making everything?\tAfter God finished making everything in six days, he rested on the seventh day.",
  "1:16\ttqz7\tapplication\t\t\tWhat did God want people to do on the seventh day?\tGod made the seventh day a special day.",
  "1:1-16\tkn32\tsummary\t\t\t\tGod created everything that exists.",
  "2:1\tip61\tmeaning\t\t\tWhat did Adam and Eve need that they did not have in the garden?\tAdam and Eve had everything they needed in the garden.",
].join("\n");

export const SN_1_1_IDS = ["prf0", "qs8q", "b70w", "wcjr"];

/**
 * IDs v1 production returns for en, in file order. id returns the same IDs;
 * its file lists nqcu before egb5.
 */
export const SQ_FRONT_IDS = ["vj0h"];
export const SQ_1_3_IDS = ["toi2", "tmdk", "kn32"];
export const SQ_1_2_4_IDS = ["toi2", "tmdk", "kn32"];
export const SQ_STORY_1_IDS = [
  "toi2",
  "egb5",
  "nqcu",
  "jkeb",
  "o115",
  "ypnk",
  "jl8m",
  "txrb",
  "ndh8",
  "tmdk",
  "snic",
  "fs3g",
  "tqz7",
  "kn32",
];
