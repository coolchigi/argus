// Pulls the readable policy text out of a canada.ca page.
//
// canada.ca pages carry roughly 10 KB of head, skip links, menus and
// breadcrumbs before `<main>`. The agents only read the first few thousand
// characters of `rule_content`, so we store the text of `<main>` (falling
// back to `<body>`), with section navigation and the page-details footer
// removed. Block elements become line breaks so headings, paragraphs, list
// items and table rows stay readable.

const DROP_ELEMENTS = ['script', 'style', 'noscript', 'template', 'svg', 'nav', 'iframe', 'button', 'form'];

const HEADING_PREFIX: Record<string, string> = { h1: '# ', h2: '## ', h3: '### ', h4: '#### ', h5: '##### ', h6: '###### ' };

const BLOCK_TAGS = new Set([
  'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'body',
  'ul', 'ol', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'caption',
  'details', 'summary', 'blockquote', 'figure', 'figcaption', 'pre', 'hr', 'br',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·',
  laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', deg: '°',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  agrave: 'à', acirc: 'â', ccedil: 'ç', icirc: 'î', iuml: 'ï',
  ocirc: 'ô', ucirc: 'û', ugrave: 'ù', uuml: 'ü',
  Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç',
  shy: '', zwnj: '', zwj: '',
};

export function extractMainText(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, '');
  s = sliceElement(s, 'main') ?? sliceElement(s, 'body') ?? s;

  for (const tag of DROP_ELEMENTS) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), ' ');
  }
  // The "Page details" footer inside <main> holds the feedback widget and
  // the date-modified stamp. Dropping it keeps a date bump from reading as
  // a rule change.
  s = s.replace(/<section\b[^>]*class="[^"]*\bpagedetails\b[^"]*"[\s\S]*?<\/section\s*>/gi, ' ');

  // Source newlines carry no meaning in HTML. Collapse them first so the
  // only line breaks left are the ones the tags below produce.
  s = s.replace(/\s+/g, ' ');

  // Flatten each table cell to one run of text so a row reads as one line.
  s = s.replace(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_m, _tag, inner: string) => ` ${inner.replace(/<[^>]*>/g, ' ')} | `);

  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g, (tagText, rawName: string) => {
    const name = rawName.toLowerCase();
    const closing = tagText.startsWith('</');
    if (HEADING_PREFIX[name]) return closing ? '\n\n' : `\n\n${HEADING_PREFIX[name]}`;
    if (name === 'p') return '\n\n';
    if (name === 'li') return closing ? '' : '\n- ';
    if (BLOCK_TAGS.has(name)) return '\n';
    return '';
  });

  s = decodeEntities(s);

  const lines = s.split('\n').map((line) => line.replace(/[ \t\f\v ]+/g, ' ').trim().replace(/\s*\|$/, ''));
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // A list item that wraps a <p> leaves a bare "-" line. Pull the item's
    // text up onto it.
    if (line === '-') {
      let j = i + 1;
      while (j < lines.length && lines[j] === '') j++;
      if (j >= lines.length || lines[j].startsWith('- ') || lines[j].startsWith('#')) continue;
      line = `- ${lines[j]}`;
      i = j;
    }
    if (/^#+$/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function sliceElement(html: string, tag: string): string | null {
  const open = new RegExp(`<${tag}\\b[^>]*>`, 'i').exec(html);
  if (!open) return null;
  const start = open.index + open[0].length;
  const closeIdx = html.toLowerCase().lastIndexOf(`</${tag}>`);
  return closeIdx > start ? html.slice(start, closeIdx) : html.slice(start);
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      return code === 0xa0 ? ' ' : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}
