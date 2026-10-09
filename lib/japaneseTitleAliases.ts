const ALIASES: Record<string, string> = {
  "one piece": "ONE PIECE",
  naruto: "NARUTO",
  bleach: "BLEACH",
  "hunter x hunter": "HUNTER×HUNTER",
  "hunter hunter": "HUNTER×HUNTER",
  "jujutsu kaisen": "呪術廻戦",
  kagurabachi: "カグラバチ",
  "demon slayer kimetsu no yaiba": "鬼滅の刃",
  "demon slayer": "鬼滅の刃",
  "attack on titan": "進撃の巨人",
  "initial d": "頭文字D",
  "black clover": "ブラッククローバー",
  kingdom: "キングダム",
  "haikyu!!": "ハイキュー!!",
  "haikyu": "ハイキュー!!",
  "my hero academia": "僕のヒーローアカデミア",
  "captain tsubasa": "キャプテン翼",
  "fist of the north star": "北斗の拳",
  "jojo's bizarre adventure": "ジョジョの奇妙な冒険",
  "yu yu hakusho": "幽☆遊☆白書",
  "yuyu hakusho": "幽☆遊☆白書",
  "rurouni kenshin": "るろうに剣心",
  gintama: "銀魂",
  "spy x family": "SPY×FAMILY",
  "chainsaw man": "チェンソーマン",
  "the promised neverland": "約束のネバーランド",
  "one-punch man": "ワンパンマン",
  "one punch man": "ワンパンマン",
  kinnikuman: "キン肉マン",
  "saint seiya": "聖闘士星矢",
  "boys over flowers": "花より男子",
};

function key(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[×✕]/g, "x").replace(/[^\p{L}\p{N}]+/gu, "");
}

export function japaneseCatalogueTitle(series: string) {
  const wanted = key(series);
  return Object.entries(ALIASES).find(([english]) => key(english) === wanted)?.[1] ?? series;
}
