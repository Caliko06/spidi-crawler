DOCUMENT: mozilla/readability: A standalone version of the readability lib

§0 (under the title)
S0 A standalone version of the readability library used for Firefox Reader View.

§1 Installation
S1 Readability is available on npm:
S2 You can then require() it, or for web-based projects, load the Readability.js script from your webpage.

§2 Basic usage
S3 To parse a document, you must create a new Readability object from a DOM document object, and then call the parse() method.
S4 Here's an example:
S5 If you use Readability in a web browser, you will likely be able to use a document reference from elsewhere (e.g. fetched via XMLHttpRequest, in a same-origin <iframe> you have access to, etc.).
S6 In Node.js, you can use an external DOM library.

§3 new Readability(document, options)
S7 The options object accepts a number of properties, all optional:
S8 debug (boolean, default false): whether to enable logging.
S9 maxElemsToParse (number, default 0 i.e. no limit): the maximum number of elements to parse.
S10 nbTopCandidates (number, default 5): the number of top candidates to consider when analysing how tight the competition is among candidates.
S11 charThreshold (number, default 500): the number of characters an article must have in order to return a result.
S12 classesToPreserve (array): a set of classes to preserve on HTML elements when the keepClasses options is set to false.
S13 keepClasses (boolean, default false): whether to preserve all classes on HTML elements.
S14 When set to false only classes specified in the classesToPreserve array are kept.
S15 disableJSONLD (boolean, default false): when extracting page metadata, Readability gives precedence to Schema.org fields specified in the JSON-LD format.
S16 Set this option to true to skip JSON-LD parsing.
S17 serializer (function, default el => el.innerHTML) controls how the content property returned by the parse() method is produced from the root DOM element.
S18 It may be useful to specify the serializer as the identity function (el => el) to obtain a DOM element instead of a string for content if you plan to process it further.
S19 allowedVideoRegex (RegExp, default undefined ): a regular expression that matches video URLs that should be allowed to be included in the article content.
S20 If undefined, the default regex is applied.
S21 linkDensityModifier (number, default 0): a number that is added to the base link density threshold during the shadiness checks.
S22 This can be used to penalize nodes with a high link density or vice versa.

§4 parse()
S23 Returns an object containing the following properties:
S24 title: article title;
S25 content: HTML string of processed article content;
S26 textContent: text content of the article, with all the HTML tags removed;
S27 length: length of an article, in characters;
S28 excerpt: article description, or short excerpt from the content;
S29 byline: author metadata;
S30 dir: content direction;
S31 siteName: name of the site;
S32 lang: content language;
S33 publishedTime: published time;
S34 The parse() method works by modifying the DOM.
S35 This removes some elements in the web page, which may be undesirable.
S36 You can avoid this by passing the clone of the document object to the Readability constructor:

§5 isProbablyReaderable(document, options)
S37 A quick-and-dirty way of figuring out if it's plausible that the contents of a given document are suitable for processing with Readability.
S38 It is likely to produce both false positives and false negatives.
S39 The reason it exists is to avoid bogging down a time-sensitive process (like loading and showing the user a webpage) with the complex logic in the core of Readability.
S40 Improvements to its logic (while not deteriorating its performance) are very welcome.
S41 The options object accepts a number of properties, all optional:
S42 minContentLength (number, default 140): the minimum node content length used to decide if the document is readerable;
S43 minScore (number, default 20): the minimum cumulated 'score' used to determine if the document is readerable;
S44 visibilityChecker (function, default isNodeVisible): the function used to determine if a node is visible;
S45 The function returns a boolean corresponding to whether or not we suspect Readability.parse() will succeed at returning an article object.
S46 Here's an example:

§6 Node.js usage
S47 Since Node.js does not come with its own DOM implementation, we rely on external libraries like jsdom.
S48 Here's an example using jsdom to obtain a DOM document object:
S49 Remember to pass the page's URI as the url option in the JSDOM constructor (as shown in the example above), so that Readability can convert relative URLs for images, hyperlinks, etc. to their absolute counterparts.
S50 jsdom has the ability to run the scripts included in the HTML and fetch remote resources.
S51 For security reasons these are disabled by default, and we strongly recommend you keep them that way.

§7 Security
S52 If you're going to use Readability with untrusted input (whether in HTML or DOM form), we strongly recommend you use a sanitizer library like DOMPurify to avoid script injection when you use the output of Readability.
S53 We would also recommend using CSP to add further defense-in-depth restrictions to what you allow the resulting content to do.
S54 The Firefox integration of reader mode uses both of these techniques itself.
S55 Sanitizing unsafe content out of the input is explicitly not something we aim to do as part of Readability itself - there are other good sanitizer libraries out there, use them!

§8 Contributing
S56 Please see our Contributing document.
