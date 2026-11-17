import "server-only";

import { readDataAgent } from "@/lib/data-agent/database.server";
import { evidenceSchema } from "./assistant-artifacts";

type Passage = {
  id: string; title: string; version: string; locator: string; url: string; passage: string;
  claim_key?: string | null; claim_value?: string | null;
};

const selection = "id,title,version,locator,url,passage";
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });

function evidence(row: Passage, retrievedAt: string) {
  const { id, title, version, locator, url, passage } = row;
  return evidenceSchema.parse({ id, title, version, locator, url, passage, retrievedAt, reviewStatus: "approved" });
}

export async function searchKnowledge(query: string) {
  const tokens = [...new Set([...segmenter.segment(query.normalize("NFKC").toLowerCase())]
    .filter(word => word.isWordLike && word.segment.length >= 2).map(word => word.segment))].slice(0, 12);
  if (!tokens.length) return { evidence: [], conflicts: [] };
  return readDataAgent(async client => {
    const { rows } = await client.query<Passage>(`
      SELECT ${selection},claim_key,claim_value
      FROM knowledge.approved_passage p
      CROSS JOIN LATERAL (
        SELECT sum(CASE WHEN strpos(lower(p.keywords || ' ' || p.title || ' ' || p.locator), keyword) > 0 THEN 3
                        WHEN strpos(lower(p.passage), keyword) > 0 THEN 1 ELSE 0 END) AS score
        FROM unnest($1::text[]) terms(keyword)
      ) scores
      WHERE score > 0 AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
        AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
      ORDER BY score DESC, reviewed_at DESC, id LIMIT 8
    `, [tokens]);
    const findings = new Map<string, Map<string, string[]>>();
    for (const { claim_key, claim_value, id } of rows) {
      if (claim_key === null || claim_key === undefined || claim_value === null || claim_value === undefined) continue;
      const variants = findings.get(claim_key) ?? new Map<string, string[]>();
      variants.set(claim_value, [...variants.get(claim_value) ?? [], id]);
      findings.set(claim_key, variants);
    }
    const retrievedAt = new Date().toISOString();
    return { evidence: rows.map(row => evidence(row, retrievedAt)),
      conflicts: [...findings].filter(([, variants]) => variants.size > 1).map(([key, variants]) => ({
        key, alternatives: [...variants].map(([value, ids]) => ({ value, ids })),
      })) };
  });
}

export async function openEvidence(id: string) {
  return readDataAgent(async client => {
    const { rows: [row] } = await client.query<Passage>(
      `SELECT ${selection} FROM knowledge.approved_passage WHERE id=$1`, [id]);
    return row ? evidence(row, new Date().toISOString()) : undefined;
  });
}
