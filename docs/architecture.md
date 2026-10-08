# Reference

The technical notes behind [Spidi](../README.md). A web crawler you can watch. The window is two halves: the text on the left,
the crawler's web on the right. A spider eats the sentences worth keeping,
letter by letter, leaving their ghosts on the page, and files each one on the
web under the subject it is about. What it eats and where it files it is
decided before it moves, by Jev and by no language model.

## Run

```sh
npm install
npm start          # http://127.0.0.1:4317/
npm run corpus     # after changing what Jev is asked or adding a page: asks again what was not asked before, keeps every answer (going back to a question costs nothing), rewrites the plans of the corpus and the trials, and names the pages that break a rule
npm run gold       # Jev against a reader on the gold pages: what it keeps, calls essential and files, with what it left out and what it kept in excess
npm run bench -- <run> [--root <checkout>] [--pages <split|ids>] [--live <kinds>|all]   # plans every page the blind teacher annotated with the code at --root; asks Jev nothing unless --live, and says what asking would cost
npm run score -- <run> [--against <run>] [--pages] [--save]   # each decision against the teacher and the writer, beside the teacher against itself (the ceiling), and the lines
```

Tuning Jev goes through the bench (`corpus/bench/`): change a question or a line in a worktree, `npm run bench -- try --root <worktree>` to see what it would ask and cost with every answer already kept reused question by question, `--live <kinds> --pages <a few>` to pay for those questions on a few pages, then `npm run score -- try --against base` for what changed and whether it is more than chance across pages. A question is paid for once: answers are kept by the question and the state it was asked about, whatever else shared its request.

Restart `node server.mjs` after changing `server.mjs` or `lib/`. The server answers only this machine's own window (a request from another site or under another host name gets 403), and says which checkout it serves; if its port is taken it says so: `PORT=4400 npm start`. The layout holds from 1280 px wide; narrower than 1180 the web goes under the text.

Spending is capped per run: `npm run corpus` and `npm run gold` stop at $0.25 of questions not yet kept, the server at $0.50 until it is restarted, and each says what it spent. Changing a question, or what reaches a later question (the kept sentences, the subjects), asks it again for every page: a full `npm run corpus` after such a change costs about $1. Raise the cap on purpose with `JEV_LIMIT=2 npm run corpus`.

Jev is TypeSafe's typed decision model, reached through Vercel's AI Gateway
(`typesafe-ai/jev`) with `AI_GATEWAY_API_KEY` (environment or `.env.local`). It answers typed questions
with probabilities and writes nothing: every word on the web is a word of the
page. Its answers are kept on disk (`corpus/judgements/` for the corpus,
`.cache/judgements/` for any other page, whose fetched page, HTML or PDF, is kept in `.cache/pages/`; PDFs are read from their text layer, never by OCR; delete a file there to read the page anew), so a judged page needs neither key nor network. A question that changes is asked again; one that does not costs nothing.

## Files

| File | Concern |
| --- | --- |
| `server.mjs` | Serves the reader; `/api/corpus`, `/api/document`, `/api/plan` with `?id=` or `?url=`, and `/api/watch`, the plan made again as a stream of Jev's questions and decisions, kept answers given at the pace Jev first gave them. |
| `lib/crawl.js` | Fetch, the document, and Jev's plan for it. |
| `lib/extract.js` | A fetched page → title (its one `h1` when the `<title>` holds it) and plain-text blocks, a bold line alone being a heading (Readability, jsdom); beside the text, never in it: the ranges that are links, emphasis or code, lists by kind and depth, figures and tables of data with where they stood, and what the page says of itself (byline, date, description, language). |
| `lib/segment.js` | Blocks → sentences, addressed by offsets into their block. |
| `lib/triage.js` | What is kept: Jev's survey of the sections, its reading of each passage, what repeats, what is essential. |
| `lib/subjects.js` | What it is filed under: Jev's names, subjects, filing, and how subjects bear on one another. |
| `lib/remarks.js` | What the crawler points out as it eats: the sentences that would surprise a reader who knows the subject only in general, and the figures worth remembering. |
| `lib/topics.js` | The terms a sentence can be named by, in any language. |
| `lib/jev.js` | Jev through Vercel's AI Gateway, answers kept on disk with how long Jev took over them, many questions a request at a time. |
| `lib/questions.js` | The shapes of what Jev is asked (`boolean`, `choice`, `score`, quoted runs): an answer is kept under the question as written, so they do not change without asking Jev again. |
| `corpus/bench/` | The bench Jev is tuned on: `pages.mjs` the pages the blind teacher annotated (`corpus/gold/page/teacher`, a second pass in `teacher2`), by split, with their references; `run.mjs` plans them with any checkout's code into `.cache/bench/<run>`; `score.mjs` sets each decision against its reference and ceiling, and two runs against each other; `scorecard.json` the score of the code in force. |
| `corpus/gold/` | Seven pages (three written for this project, four real) with a reader's verdict on every sentence (`src/`, tags `{0..3}`, `*` essential, `^` the lead) and a second reader's subjects and themes (`topics/`), both made without seeing Jev. `compare.mjs` sets what Jev keeps, calls essential and files against them; `skeleton.mjs <id>` writes a page of the corpus out to be annotated. |
| `corpus/` | Real pages as fetched, Jev's answers for them, what it made of each (`plans/`, compared with `git diff corpus/plans`), and the script that asks. |
| `corpus/trials/` | Pages of every other kind (recipe, terms, product, API docs, forum, README, biography, Spanish, health blog, government service), offered by the reader after the corpus: how Jev does with what it has not met. Same layout as the corpus. |
| `src/main.js` | Wires the pieces and runs the frame loop. |
| `src/dom.js` | Small helpers for building the console's elements, and ranges of a block's text across the links and emphasis in it. |
| `src/watch.js`, `src/console.js` | Watching Jev make the plan: on the text, the passages it reads and the ink it gives them; where the web will be, a console of Jev's verdicts: each request on a track per stage, each subject against the line it has to clear, and of every request the question Jev was least sure of, as an if, a pick or a rating with its gauge. |
| `src/voice.js` | What Jev says as it works (on the page and in the console's stages, verdicts and sums) in the language of the text: Spanish for Spanish, English otherwise; the instrument around it keeps English. |
| `src/page.js` | The document as the page it was (masthead, links and emphasis, lists, figures, tables, colophon), Jev's triage of it, where the words to eat are, their ghosts. |
| `src/flight.js` | The letters of an eaten word on their way into the mouth. |
| `src/web.js` | The web: a graph of subjects and sentences laid out by d3-force round the title, and the drawer with a subject's page or the summary. Cmd+Z undoes the last fusion. |
| `src/route.js` | Route planning. Pure geometry. |
| `src/thread.js` | A thread with weight (a Verlet chain, ends held from outside): the web's strands, the crawler's thread, cord and dragline. |
| `src/util.js` | The clamp, the random value between two and the padded count that more than one module needs. |
| `src/crawler.js`, `src/crawler-view.js`, `src/overlay.js` | The spider: its body in motion and what it does of its own accord, its pose, its three.js canvas and the threads it spins. |
| `src/heed.js` | What the crawler makes of the reader's pointer: notices it, flinches, threatens, swats, strikes, stalks or inspects it; a click startles it into a leap away or a pounce. `crawler.js` carries out what it decides (`heed`, `poke`, `jostle` for the hand scrolling). |
| `src/agency.js` | What the crawler makes of the reader's work on the web: watches a subject held (wary, or reared when it would fall in), bites a merge, taps a subject left alone, spits a fusion back, goes down the summary touching each essential sentence. `web.js` tells it (`hand`, `told`, `drawer`, `hover`); `crawler.js` carries it out (`web`, `hold`). |
| `src/moves.js`, `src/temper.js`, `src/clips.js` | The catalog of small moves it draws from, what drives it and how it takes what it eats, and the clips keyed in Blender (`art/clips.py` → `assets/clips.json`). |
| `art/spidi.py` → `assets/spidi.glb` | The spider, built in Blender: `/Applications/Blender.app/Contents/MacOS/Blender -b -P art/spidi.py`. |

## The plan (`/api/plan`)

`{ apparatus, passed, topics, parents, links, kept, pulls }`, made before the spider
moves. Every decision is an answer of Jev's; no number says how much is kept
or how many subjects there are.

1. **Survey.** Per headed section: text or apparatus (references, links, legal). Apparatus is ruled out.
2. **Reading.** Per passage of the rest, a paragraph with the list it opens: a four-level score for every sentence, judged against how the document opens, and for every sentence which earlier one it needs, unless Jev is at least as likely as not to say it needs none.
3. **Kept.** A sentence whose score reaches `KEY` (1.65, a little past key), with what it needs and so on back. No number says how much is kept: a document that says much in few words keeps more of its sentences than one that says little at length.
4. **Naming.** Per kept sentence: which of its own terms, or its heading's, names what it is about.
5. **Subjects.** A page with headings has filed its sentences already, and that outline agrees with a careful editor far more than names found sentence by sentence (against the blind teacher: ARI .68 tuning, .63 held out, where names alone gave .41 and .27; two passes of the teacher agree at .75 and .66). Per heading the kept sentences come under (and per heading over headings that hold them): is it a subject a reader would look up by that name, or does it only frame the text ("Overview", "Summary"). A heading Jev takes is a subject; its sentences are filed under it, those of a heading it does not take under the heading above. Per name: is it a subject the document explains; a name that is a heading's is that heading's subject. Per two subjects that share a word (one word holding the other, as "recruit" and "recruiting"), and per subject with the title: do they name the same subject; what is the same as the same is one, as in entity resolution, and Jev picks which name heads it. The title is always a subject.
6. **Filing.** Per kept sentence, shown the heading it comes under and the sentence before it if of the same section: which subject, the title aside, it is mainly about, then, for the three likeliest, whether it belongs on that subject's page. A sentence under a heading that is a subject is filed there and the others it belongs under are its `ties`; any other is filed under the first it belongs under, the rest being its `ties`. Of one that belongs under none: is it about the whole document or about the likeliest; the first files it under the title. The lead is always filed under the title.
7. **Repeats.** Per two kept sentences of one subject: do they say the same thing. Of two that do, the lower rated goes, the later of two rated alike, unless another needs it.
8. **Worth.** Jev says how many sentences a reader needs to remember the document by, from two to fifteen, and per kept sentence how likely it is one of them; the likeliest are the `prize`s, the rest `catch`. Among the prizes: which one says the whole document (`lead`).
9. **Relations.** Per subject, the title aside: which other has the most to do with it; the two are joined. Per two joined: how much they have to do with each other, on four levels (`weight`, 0 to 1). These are the `links`.
10. **Themes.** A subject that is a heading has its place by the outline: a heading under no other is a theme, one under another goes under that one's theme. When there are more than seven such themes, and for subjects that are not headings, Jev picks one at a time the pillars the document is built on, at least two and at most seven, and once it has two may say none is left; the title is always one. Per other subject: which theme it belongs under (a heading Jev does not take as a theme carries the headings under it along). The first five are picked before the others are put; then, while a theme gathers four or more and there is room, Jev picks one of them as a theme of its own and those are put again. The title is offered as the document as a whole, for what is part of no other theme. These are the `parents`; a subject put under the title whose strongest bond, at least much, is with another goes under that one's theme, or under it if it is one.

A kept sentence is `{ block, start, end, text, worth, lead, topic, ties }`.

## The reader

- **Jev at work.** The plan is streamed from `/api/watch` and shown as it is made:
  - on the text: brackets on the passages being read, ink by Jev's rating, ticks on what is kept, the naming term underlined, a note per passage ("Keeps 3 of 6", "Passes over") and a line saying the step in words;
  - in the console (where the web will be): what Jev has made of the text (words kept, essential, passed over, ruled out), seconds, questions, Live or Replay, sections always shown (Steps with how Jev is being asked and why it is fast; Subjects against the line they must clear; Verdicts), the share kept as a block beside the figure, per passage a line saying what Jev kept of it (pointing at it marks the passage on the text, a click goes to it), and per request the verdict Jev was least sure of, led by what it came to, with its gauge;
  - the crawler sets off at `early`; the web is spun when the plan is whole; Skip fetches it at once.
- **Bar.** Speed (½× to 4×) and how much of Jev shows (Hide, Dock, Open; J cycles). Open shows every verdict, narrowable to close calls, also after the plan.

- **Text.** Sections ruled out are all but gone; passed-over sentences are dim; sentences to eat have a tick in the margin. An eaten word leaves its ghost; the layout never moves.
- **Spider.** Weaves down the text without crossing it, eats the kept sentences in order, and with sixty words in it walks out to the web to file them. Where it goes is planned; how it goes is its own: it runs in bursts, may leap a long leg of its route with a dragline behind it, strikes at what it feeds on, and standing idle cleans its palps, taps, looks about or rears. Shaking a subject of the web makes it freeze, turn on it and rear.
- **Look.** A dark instrument by default, a Clear ground on a switch in the bar: near-black (or paper), hairlines, cut corners, Plex Mono for the web and readouts, Instrument Sans for the interface, Literata for the text; yellow for the one action and what the crawler points out, rose for what is essential, mint for what is being laid.
- **Web.** A graph, as Obsidian draws one, laid out by d3-force: one monospaced face, hairlines, colour only for what is essential and what is being laid. The title is a node held at the centre, lit from the start, its count all that has been laid. Every other subject is a node as big as what is under it (a theme counts its subjects too), its name under it; it comes up when the crawler first reaches it, its name written out. Each theme is drawn to a distance from the centre, the heavier the nearer; subjects push one another away; a subject under a theme is held near it. A sentence is a small node held to its subject by a hairline: it comes out of the crawler as it is laid, its words read by pointing at it; one that belongs under another subject too, or that Jev says has much to do with one under another, is held to that as well, unseen. A subject keeps as nodes its essential sentences and its latest few others, the older the fainter; older ones sink into its node. When a theme has two subjects of its own on the web, the crawler brings the lighter into it, and the summary and the Markdown keep it as a section of the theme (`### Subject`, linked as `[[Theme#Subject]]`). The only lines are a subject's to its own sentences. Moving a node moves the graph with it; nothing goes round.
- **Double click.** On a sentence of the text, the crawler is taken there, to the next sentence it eats from that point: everything before it is eaten and laid on the web at once, as if it had come at its own pace, and it goes on from there. On what is already eaten it goes back to it and then on to where it was.
- **Pause and read.** The toggle at the foot of the web stops the crawler and gives the graph the window but for a strip of the text, with the summary open beside it.
- **Summary.** Picking a subject opens its page, from the top; "Summary" opens everything laid so far: the lead first, then the title's sentences, then every other subject in the order the document comes to it, however far the crawler has got; "Copy as Markdown" exports it in that order.
