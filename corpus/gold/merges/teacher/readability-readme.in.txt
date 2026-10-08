DOCUMENT: mozilla/readability: A standalone version of the readability lib


THEME "parse()"
  s0 Returns an object containing the following properties:
  s1 content: HTML string of processed article content;
  s2 textContent: text content of the article, with all the HTML tags removed;

THEME "isProbablyReaderable"
  s3 A quick-and-dirty way of figuring out if it's plausible that the contents of a given document are suitable for processing with Readability.
  s4 The reason it exists is to avoid bogging down a time-sensitive process (like loading and showing the user a webpage) with the complex logic in the core of Readability.
  s5 The function returns a boolean corresponding to whether or not we suspect Readability.parse() will succeed at returning an article object.

THEME "Security"
  s6 If you're going to use Readability with untrusted input (whether in HTML or DOM form), we strongly recommend you use a sanitizer library like DOMPurify to avoid script injection when you use the output of Readability.
  s7 We would also recommend using CSP to add further defense-in-depth restrictions to what you allow the resulting content to do.
  s8 Sanitizing unsafe content out of the input is explicitly not something we aim to do as part of Readability itself - there are other good sanitizer libraries out there, use them!

THEME "Node.js usage"
  s9 jsdom has the ability to run the scripts included in the HTML and fetch remote resources.
  s10 For security reasons these are disabled by default, and we strongly recommend you keep them that way.

THEME "mozilla/readability: A standalone version of the readability lib"
  s11 [LEAD] A standalone version of the readability library used for Firefox Reader View.

THEME "Installation"
  s12 You can then require() it, or for web-based projects, load the Readability.js script from your webpage.

THEME "Basic usage"
  s13 To parse a document, you must create a new Readability object from a DOM document object, and then call the parse() method.