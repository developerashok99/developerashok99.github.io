import type { APIRoute } from "astro";
import { renderedCards } from "../lib/cardsHtml";

/** Every interview question with its answer, for the mock interview (src/client/interview.ts); loaded when an interview starts. */
export const GET: APIRoute = async () => {
  const { cards } = await renderedCards(import.meta.env.BASE_URL);
  return new Response(JSON.stringify(cards), { headers: { "Content-Type": "application/json" } });
};
