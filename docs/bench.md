# Bench

How well Jev decides, what it costs, and how fast it answers. Everything here is computed from files in this repository; nothing is asked of Jev to make this page.

<p align="center"><img src="media/bench-ceiling.svg" width="900" alt="Jev against a blind LLM teacher, as a share of the ceiling"></p>

<p align="center"><img src="media/bench-cost.svg" width="900" alt="What each page of the bench cost Jev"></p>

## What is measured

**The pages.** 36, in three splits. `tune` (21) is where every threshold was set. `test` (8) never set one. `authored` (7) are texts written for this project whose writer judged every sentence before any model saw the page.

**The references.** A blind LLM teacher (`gpt-6-luna` through the Codex CLI, never shown anything Jev did) annotated each page. A second blind pass of the same teacher says how far it agrees with itself: that is the **ceiling**, the nearest anyone can ask Jev to come to it.

**The score.** Jev's agreement with the teacher (F1, or ARI for groupings, or the share of the same lead), divided by the teacher's agreement with itself, on the pages that never set a threshold (`test` and `authored`). 100% means as near to the teacher as the teacher is to itself. Over 100% is noise in the teacher's second pass.

**The lines.** Every threshold Jev's answers are read by lives in `lib/lines.js` and comes from here: a line is a number in `lib/` only when it comes from `score.mjs`, which sets it on the `tune` pages and tries it on the others.

## Reading the charts

- Jev is near the teacher on the structural decisions (what is apparatus, what stands alone, which heading is a subject, where a sentence is filed) and further from it on **what is essential: 41%**. That is the weakest decision and it is in the chart.
- A page costs a median of **$0.0099** and from $0.0016 to $0.098. The dear pages are the long ones: cost follows the tokens read, not the quality of the answer.
- A request is answered in **347 ms** at the median and 585 ms at the 90th percentile (6,042 answers kept).

## What is not measured

**Jev against an LLM on cost and speed.** An LLM was the reference for quality, through the teacher. How much it would cost, or how long it would take, to answer the same questions page by page was not measured here, so this repository claims nothing about it. What it does measure is Jev's own bill and latency, above.

**Pages without headings.** Four pages of the bench have none, and Jev's subjects there are far from the teacher's (and the teacher is far from itself). Too few to tune on.

## Every page

| page | split | requests | questions | tokens read | cost |
| --- | --- | ---: | ---: | ---: | ---: |
| imperio-azteca | test | 223 | 2,520 | 2,339,103 | $0.098 |
| civil-disobedience | tune | 75 | 6,230 | 2,192,617 | $0.092 |
| iss-breakthroughs | tune | 161 | 2,461 | 1,590,479 | $0.067 |
| mycorrhiza | test | 182 | 2,050 | 1,417,310 | $0.060 |
| authored-http-caching | authored | 174 | 1,613 | 971,919 | $0.041 |
| http-caching | tune | 162 | 1,548 | 861,129 | $0.036 |
| sourdough | test | 104 | 1,369 | 651,650 | $0.027 |
| pg-growth | test | 68 | 1,918 | 629,579 | $0.026 |
| web-crawler | tune | 114 | 1,266 | 557,966 | $0.023 |
| authored-dont-scale | authored | 85 | 1,337 | 512,882 | $0.022 |
| cors | test | 108 | 1,232 | 510,017 | $0.021 |
| dont-scale | tune | 85 | 1,303 | 499,033 | $0.021 |
| ciberpunk | tune | 69 | 1,106 | 447,763 | $0.019 |
| using-fetch | tune | 95 | 1,160 | 420,440 | $0.018 |
| rfc9309 | tune | 103 | 799 | 339,222 | $0.014 |
| cyberpunk | tune | 90 | 775 | 292,515 | $0.012 |
| deep-sea | tune | 63 | 715 | 261,981 | $0.011 |
| hn-dropbox | tune | 21 | 1,628 | 234,676 | $0.0099 |
| mozilla-terms | tune | 69 | 579 | 234,459 | $0.0098 |
| authored-hn-dropbox | authored | 15 | 1,471 | 195,114 | $0.0082 |
| who-diabetes | test | 73 | 622 | 191,147 | $0.0080 |
| climate-evidence | tune | 82 | 432 | 176,084 | $0.0074 |
| authored-climate-evidence | authored | 77 | 409 | 166,925 | $0.0070 |
| dark-majority | tune | 52 | 520 | 138,984 | $0.0058 |
| marie-curie | tune | 53 | 456 | 130,412 | $0.0055 |
| fairphone | tune | 79 | 486 | 120,231 | $0.0050 |
| authored-checkout-outage | authored | 52 | 319 | 103,373 | $0.0043 |
| authored-frictionless | authored | 42 | 344 | 101,269 | $0.0043 |
| register-to-vote | tune | 51 | 308 | 87,607 | $0.0037 |
| pancakes | tune | 53 | 250 | 86,261 | $0.0036 |
| authored-four-day-week | authored | 49 | 268 | 83,665 | $0.0035 |
| readability-readme | tune | 47 | 267 | 80,784 | $0.0034 |
| tacos-al-pastor | tune | 38 | 185 | 68,977 | $0.0029 |
| python-venv | test | 35 | 228 | 64,295 | $0.0027 |
| cqrs | test | 13 | 365 | 49,928 | $0.0021 |
| green-tea | tune | 18 | 202 | 37,707 | $0.0016 |

## Reproduce it

```sh
npm install
npm run bench -- stats --pages all     # replays the kept answers: asks Jev nothing, costs $0
npm run report -- stats                # this page's numbers and the two charts
npm run score -- stats                 # the score of each decision against the teacher and the ceiling
```

The kept answers are in each set's `judgements/`. A question that is not kept is given a made-up answer and counted, and the run says what asking it would cost; it asks Jev only with `--live` and a key, up to `JEV_LIMIT` dollars.
