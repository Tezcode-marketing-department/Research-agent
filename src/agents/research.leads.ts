/**
 * Research Agent topgan nomzodlarni bazaga yozadi.
 *
 * Grafga `research.web.ts`dagi `ResearchLookup` kabi INJECT qilinadi — shu
 * sabab test DB'siz, soxta store bilan ishlaydi. Maydon shakllari
 * `src/mcp/server.ts`dagi lead_add/fact_add/pain_add/lead_handoff bilan bir
 * xil: ikki tizim bitta bazani ishlatadi, kelajakda birlashsa mos kelsin.
 */
import { PrismaService } from '../db/prisma.service';

export type FactKind = 'site' | 'vacancy' | 'instagram' | 'maps' | 'telegram' | 'news' | 'other';
export type PainConfidence = 'past' | 'orta' | 'yuqori';
export type LeadSource = 'linkedin' | 'instagram' | 'maps' | 'vacancy' | 'telegram' | 'manual';

export interface ResearchCandidateInput {
  company: string;
  person?: string;
  role?: string;
  source: LeadSource;
  sourceUrl: string;
  fact: { kind: FactKind; text: string; sourceUrl: string; quote?: string };
  pain: { claim: string; confidence: PainConfidence; evidence: { sourceUrl: string; quote?: string }[] };
  note: string;
}

export interface PersistedLead {
  leadId: string;
  company: string;
  isNew: boolean;
}

/** DB yozuv qatlami — graf shu interfeys orqali ishlaydi, Prisma'ni bilmaydi. */
export interface ResearchLeadStore {
  ensureProject(input: { slug: string; name: string }): Promise<{ id: string }>;
  persistCandidate(projectId: string, agent: string, candidate: ResearchCandidateInput): Promise<PersistedLead>;
}

export function createPrismaResearchLeadStore(prisma: PrismaService): ResearchLeadStore {
  return {
    async ensureProject({ slug, name }) {
      const project = await prisma.project.upsert({
        where: { slug },
        create: { slug, name },
        update: {},
      });
      return { id: project.id };
    },

    async persistCandidate(projectId, agent, candidate) {
      const existing = await prisma.lead.findUnique({
        where: { projectId_company: { projectId, company: candidate.company } },
      });
      const isNew = !existing;

      const lead = await prisma.$transaction(async (tx) => {
        const savedLead = await tx.lead.upsert({
          where: { projectId_company: { projectId, company: candidate.company } },
          create: {
            projectId,
            company: candidate.company,
            person: candidate.person,
            role: candidate.role,
            source: candidate.source,
            sourceUrl: candidate.sourceUrl,
            status: 'new',
          },
          update: {
            person: candidate.person,
            role: candidate.role,
            source: candidate.source,
            sourceUrl: candidate.sourceUrl,
          },
        });

        await tx.fact.create({
          data: {
            leadId: savedLead.id,
            kind: candidate.fact.kind,
            text: candidate.fact.text,
            sourceUrl: candidate.fact.sourceUrl,
            quote: candidate.fact.quote,
            agent,
          },
        });

        await tx.pain.create({
          data: {
            leadId: savedLead.id,
            claim: candidate.pain.claim,
            confidence: candidate.pain.confidence,
            evidence: candidate.pain.evidence,
            agent,
          },
        });

        return tx.lead.update({
          where: { id: savedLead.id },
          data: { status: 'researched', note: candidate.note },
        });
      });

      return { leadId: lead.id, company: lead.company, isNew };
    },
  };
}
