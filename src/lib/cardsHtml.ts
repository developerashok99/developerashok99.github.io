/**
 * Every interview question of the super-detailed notes with its answer, rendered to HTML (build time).
 * Used by the Revision page's flashcards and by the mock interview (interview.json).
 */
import { getLessons, knownIds, readNote } from "./content";
import { renderMarkdown } from "./markdown";
import { lessonPath, withBase } from "./routes";
import { findSection, parseQuestions } from "./revision";
import { cardId } from "./srs";

export interface RenderedCard {
  id: string;
  /** section id and title, lesson id and label */
  s: string;
  d: string;
  lid: string;
  l: string;
  /** the lesson's self-test */
  href: string;
  /** question (inline HTML) and answer (HTML), copied unchanged from the notes */
  q: string;
  a: string;
}

const cache = new Map<string, Promise<{ cards: RenderedCard[]; perLesson: Map<string, number> }>>();
export function renderedCards(base: string) {
  if (!cache.has(base)) cache.set(base, build(base));
  return cache.get(base)!;
}

async function build(base: string) {
  const known = knownIds();
  const inline = async (text: string, sid: string) =>
    (await renderMarkdown(text, { kind: "super", sid, base, known })).html.replace(/^<p>|<\/p>\s*$/g, "");
  const cards: RenderedCard[] = [];
  const perLesson = new Map<string, number>();
  for (const l of getLessons()) {
    const q = findSection(readNote(l.id, "super"), /interview question|questions discussed/i);
    const qs = q ? parseQuestions(q.body) : [];
    perLesson.set(l.id, qs.length);
    for (const x of qs) {
      cards.push({
        id: cardId(l.id, x.question),
        s: l.sectionId,
        d: l.sectionTitle,
        lid: l.id,
        l: l.label,
        href: withBase(base, lessonPath(l.id, "revise")) + "#rv-selftest",
        q: await inline(x.question, l.id),
        a: (await renderMarkdown(x.answer, { kind: "super", sid: l.id, base, known })).html,
      });
    }
  }
  return { cards, perLesson };
}
