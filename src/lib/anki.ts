import type { Candidate } from './selection';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = (s: string) => esc(s).replace(/\r?\n/g, '<br>');
const csvField = (s: string) => `"${s.replace(/"/g, '""')}"`;
const tag = (s: string) => s.trim().replace(/\s+/g, '_');

/**
 * Anki-importable CSV (File → Import). The header lines tell Anki 2.1.55+ the
 * separator, that fields are HTML, the note type, deck, and which column holds tags.
 *   Front = stem + options · Back = answer + explanation + takeaway + source
 */
export function ankiCsv(cands: readonly Candidate[], deck = 'Q-Bank'): string {
  const lines = [
    '#separator:Comma',
    '#html:true',
    '#notetype:Basic',
    `#deck:${deck.replace(/[\r\n]/g, ' ')}`,
    '#tags column:3',
    '#columns:Front,Back,Tags',
  ];
  for (const { q, lecture } of cands) {
    const options = q.options.map((o) => `<b>${o.id}.</b> ${html(o.text)}`).join('<br>');
    const front = `${html(q.stem)}<br><br>${options}`;
    const correct = q.options.find((o) => o.id === q.correct_option);
    const source = [lecture?.title ?? q.lecture_id, `slides ${q.source.slides}`, lecture?.day_label].filter(Boolean).map((s) => esc(String(s))).join(' · ');
    const back = [
      `<b>Answer: ${q.correct_option}. ${html(correct?.text ?? '')}</b>`,
      html(q.explanation),
      `<i>Key takeaway:</i> ${html(q.key_takeaway)}`,
      `<small>${source}</small>`,
    ].join('<br><br>');
    const tags = [
      'qbank',
      lecture ? `qbank::${tag(lecture.course)}::W${lecture.week}` : '',
      `qbank::${tag(q.lecture_id)}`,
      ...q.tags.map(tag),
    ].filter(Boolean);
    lines.push([front, back, [...new Set(tags)].join(' ')].map(csvField).join(','));
  }
  return lines.join('\n') + '\n';
}
