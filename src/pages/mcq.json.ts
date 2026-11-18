import type { APIRoute } from "astro";
import { getLessons, knownIds } from "../lib/content";
import { renderMarkdown } from "../lib/markdown";
import { lessonPath, withBase } from "../lib/routes";
import { studyFor } from "../lib/study";

/**
 * Every lesson's multiple-choice questions (from the notes repo), rendered, for the MCQ tests (src/client/mcq.ts).
 * [{ id, q, o: [options], a: right index, e: explanation, lid, l: lesson label, s/d: section id/title, href }]
 */
export const GET: APIRoute = async () => {
  const base = import.meta.env.BASE_URL;
  const known = knownIds();
  const inline = async (t: string, sid: string) => (await renderMarkdown(t, { kind: "super", sid, base, known })).html.replace(/^<p>|<\/p>\s*$/g, "");
  const out = [];
  for (const l of getLessons()) {
    for (const q of studyFor(l.id).quiz) {
      out.push({
        id: q.id,
        q: await inline(q.q, l.id),
        o: await Promise.all(q.options.map((o) => inline(o, l.id))),
        a: q.answer,
        e: q.explain ? await inline(q.explain, l.id) : "",
        lid: l.id,
        l: l.label,
        s: l.sectionId,
        d: l.sectionTitle,
        href: withBase(base, lessonPath(l.id, "revise")),
      });
    }
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
};
