/**
 * What the progress pages need to know about each lesson (build time): how many quiz questions and flashcards it
 * has, for mastery (src/lib/mastery.ts), and where its self-test, notes and video are.
 */
import { cardsFor } from "./cards";
import { getLessons } from "./content";
import { lessonPath, withBase } from "./routes";
import { studyFor } from "./study";

export interface StudyIndexItem {
  id: string;
  label: string;
  title: string;
  section: string;
  questions: number;
  cards: number;
  /** the lesson, its self-test (Revise) and its lecture on the Videos tab ("" when it has none) */
  href: string;
  revise: string;
  video: string;
}

export function studyIndex(base: string): StudyIndexItem[] {
  return getLessons().map((l) => ({
    id: l.id,
    label: l.label,
    title: l.title,
    section: l.sectionTitle,
    questions: studyFor(l.id).quiz.length,
    cards: cardsFor(l.id).length,
    href: withBase(base, lessonPath(l.id)),
    revise: withBase(base, lessonPath(l.id, "revise")),
    video: l.lecture?.youtubeId ? withBase(base, `videos/${l.id}/`) : "",
  }));
}

/** The index as a JSON <script> body, safe to inline. */
export const studyIndexJson = (base: string) => JSON.stringify(studyIndex(base)).replace(/</g, "\\u003c");
