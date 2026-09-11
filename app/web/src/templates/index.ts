import type { Template } from "./schema";
import { promoHero } from "./promoHero";
import { saleSquare } from "./saleSquare";

// Register every template here. To add a new one:
//   1. create a file like promoHero.ts with a Template object
//   2. import it and add it to this array
export const templates: Template[] = [promoHero, saleSquare];

export function getTemplate(id: string): Template | undefined {
  return templates.find((t) => t.id === id);
}
