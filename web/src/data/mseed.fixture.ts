// Two miniSEED 2 records from EarthScope's ringserver (Oct 24, 2026, 03:23 UTC),
// Steim2-compressed, with what they decode to. The decoder's own check (the
// last sample against the record's reverse integration constant) passed.

export const RECORDS = [
  {
    station: "BYP",
    channel: "ENZ",
    location: "01",
    network: "UU",
    start: 1792814597760,
    rate: 100,
    n: 416,
    first: 16606,
    last: 16689,
    sum: 6930549,
    b64:
      "MDAwMDAxRCBCWVAgIDAxRU5aVVUH6gEpBAMRAB2wAaAAZAABAAAAAgAAAAAAQAAwA+gAOAsBCQAD6QAAAAAAAAFVVVUAAEDe" +
      "AABBMe1Z1twz++0MRALLqu5GDl0uqaKvIExGNt+1wBMoCjn3s94DZTin9fngGwUuENju2/gbLxkVaVVV/wa5xxguLMD9eQGw" +
      "qdYkM8WBn9/2LvwFH04eJuqO5xgVMgrdFCHZCBC55CL3+1Iy+Nuy2vgmYSLhwaYQFVVVVVUgA/7n3u/6Jysh76PdBiVvDZLy" +
      "G/QPKhCr0yYQIT/+tsQMGvY3+vEdovhWOgbD4PH2ARcmL+Ka4DB5KhVVVfXFyr77DfIXRzL3+MG4Aw9bRbrp19ViDbjsHkEI" +
      "6tToGPUxB8E5E93h2EQm+DqcqHIcTEzpzC9q6+MCqusVV9VXSwPb+jIh++wAIrbBKx4N9RAd0/8v9vDsIGVJFwvHk5/I7icn" +
      "D+fn0iH+zkVG76rhKv3yLybd5fgFL39XFVVVVSDQ0S0jAvIF7u8W3QAA8SI4RdvB1b8GOiwICwXY5ir0yx8F4zQ66eHp4QEx" +
      "CtwG+fEEPUzEnu4wLQba4hV1VVUjBwoS2+8NHubrO8/XSRDqMBTbtB3V21j7AybZ9dsNBtQkHR0F2ufbDyoFGhvc3gzt9D34" +
      "3hjr9/oRMPM=",
  },
  {
    station: "SHED",
    channel: "HNZ",
    location: "01",
    network: "UU",
    start: 1792814588220,
    rate: 100,
    n: 240,
    first: -6754,
    last: -7904,
    sum: -1756840,
    b64:
      "MDAwMDAxRCBTSEVEIDAxSE5aVVUH6gEpBAMIAAiYAPAAZAABAAAAAgAAAAAAQAAwA+gAOAsBCQAD6QAAAAAAAAKqqqr//+We" +
      "///hIIHmAQ6/snzA6wSqZL3SArCDl39MvrUBDoC3fuK+GwB+gIp/QIIZANy+gwFe+sy4hutLmyIqqqqq1KP4Bv8IG6yA/gKU" +
      "/k7T9r6Yf/jSL0tsv0IBloHAf8K+h32ixQbbDL/mAj7Ljmtkv4EAioFpf5S96X7cKqqqqoEQASDRZboK8mRSBufiCJyAvAIm" +
      "/Q1b5uXqOqqAnALYziJIqL/gfcjir9kOv/V+xoEUAU6+3H7iyyYL6Cqqqqq+nX+YgVcBkIA3f+K+038OgZp/oL4GfiiBKwSS" +
      "v6V8noAQAurU6UKmgI0ClL8tfKr47pD+2YQYRr7YfzwqqqqqzCFpWr//fmi+63/oggUBHL4qAHqBs3/4788yTL7nAciBkwCc" +
      "v1Z9yv9jw6z24KP8vv8A1oHdf66+c38CKqqqqtgnQWK/Sn3ggJ4CEL/rfYbxI5nizmv4CO5uAErg7bmWgQkBer8mfWjFoEsG" +
      "yAJoUIBXArKBb37UvpV+UCqqqqq/MH/egYcBauOua278Bnryv6wAmr7mf6yByAK2v0Z9TIASAsS/sHmggEEFXO9MKAaANQLW" +
      "v9h97L8tf1g=",
  },
];
