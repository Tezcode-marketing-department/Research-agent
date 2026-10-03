/**
 * Tezcode Agents — MCP server.
 *
 * Uchala Hermes agenti (sales, research, content) shu server orqali BITTA
 * bazaga murojaat qiladi. Ajratish `projectId` bo'yicha, baza darajasida emas —
 * shunda Sales topgan bilimni Content ham ko'radi.
 *
 * Ishga tushirish: node dist/mcp/server.js   (stdio)
 * Muhit: DATABASE_URL, AGENT_NAME (kim yozayotgani jurnalga tushadi)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import {
  browserStatus,
  linkedinProfile,
  linkedinSearch,
  linkedinThread,
  linkedinTypeDraft,
} from './linkedin.js';
import { getThreadHistory, resolveLeadPeer, sendToLead } from '../sales/outreach.js';
import { proposeMeetingToCeo } from '../sales/ceo-approval.js';
import { ceoInbox, notifyCeos } from '../sales/ceo-contacts.js';
import { imageGenerate, reelCompress, reelRender } from './media.js';
import { publicImages, reelKnowledge, specSave } from './reels.js';
import { rankOf, seoAudit, serpTop } from './seo.js';
import { siteCrawl, discoverQueries } from './crawler.js';
import { repoSeoScan } from './repo-seo.js';
import { knowledgeList, knowledgeRead, knowledgeSearch } from './knowledge.js';
import { inboxList, inboxRead } from './inbox.js';
import { contentMemory, contentMemoryTopics } from './content-memory.js';
import { brandFacts, brandList } from './brands.js';
import { IG_ACCOUNTS, instagramCheck, instagramPublish } from './instagram.js';
import {
  codeCommit, codeDiff, codeEdit, codeRead, codeRepos,
  codeRevert, codeSearch, codeStatus, codeTree, codeVerify,
} from './code.js';

const prisma = new PrismaClient();
const AGENT = process.env.AGENT_NAME ?? 'noma\'lum';

const server = new McpServer({ name: 'tezcode-agents', version: '0.1.0' });

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const json = (value: unknown) => ok(JSON.stringify(value, null, 2));


/**
 * Har agent FAQAT o'z tool'larini ko'radi.
 * Sabab: hamma bitta MCP serverga ulangan — filtrsiz SEO agenti reel
 * render tool'ini ko'rib, o'zini kontentga ham mas'ul deb o'ylaydi.
 */
const SHARED = [
  'inbox_list', 'inbox_read',
  'project_list', 'project_create',
  'insight_add', 'insight_list',
  'lesson_list', 'lesson_add',
  'blocker_add', 'blocker_list', 'blocker_resolve',
];

const TOOLSETS: Record<string, string[]> = {
  sales: [
    ...SHARED,
    'lead_add', 'lead_list', 'lead_get', 'lead_status', 'lead_handoff',
    'fact_add', 'pain_add', 'draft_save', 'draft_status',
    'browser_status', 'linkedin_search', 'linkedin_profile',
    'linkedin_thread', 'linkedin_type_draft',
    'telegram_resolve_lead', 'telegram_send', 'telegram_thread', 'ceo_propose_meeting',
    'sales_notify_ceo', 'sales_ceo_inbox',
  ],
  research: [
    ...SHARED,
    'lead_add', 'lead_list', 'lead_get', 'lead_handoff', 'fact_add',
    'browser_status', 'linkedin_search', 'linkedin_profile',
  ],
  content: [
    ...SHARED,
    'brand_list', 'brand_facts',
    'code_repos', 'code_tree', 'code_read', 'code_search',
    'content_memory', 'content_memory_topics',
    'image_generate', 'reel_render', 'reel_compress',
    'instagram_check', 'instagram_publish', 'reel_knowledge', 'public_images', 'spec_save',
  ],
  seo: [
    ...SHARED,
    'brand_list', 'brand_facts',
    'seo_site_add', 'seo_site_list', 'seo_audit',
    'site_crawl', 'query_discover', 'seo_knowledge', 'seo_knowledge_search',
    'seo_query_add', 'rank_check', 'rank_history', 'competitor_scan',
    'seo_task_add', 'seo_task_list', 'seo_task_status', 'seo_digest',
    'browser_status',
    'code_repos', 'code_tree', 'code_read', 'code_search', 'repo_seo_scan',
    'code_edit', 'code_diff', 'code_revert', 'code_verify',
    'code_status', 'code_commit',
  ],
};

const allowedTools = TOOLSETS[AGENT.toLowerCase()] ?? null; // noma'lum agent — hammasi

/**
 * `registerTool` imzosini saqlab qoladi — aks holda handler argumentlari
 * tipini yo'qotadi. Ruxsat etilmagan tool shunchaki ro'yxatdan o'tmaydi.
 */
const reg = ((name: string, ...rest: unknown[]) => {
  if (allowedTools && !allowedTools.includes(name)) return undefined;
  return (server.registerTool as unknown as (...a: unknown[]) => unknown)(name, ...rest);
}) as unknown as typeof server.registerTool;

async function projectIdBySlug(slug: string): Promise<string> {
  const project = await prisma.project.findUnique({ where: { slug } });
  if (!project) throw new Error(`loyiha topilmadi: ${slug} (project_list bilan ko'ring)`);
  return project.id;
}

// ─────────────────────────────── loyihalar ───────────────────────────────

reg(
  'project_list',
  {
    title: 'Loyihalar ro\'yxati',
    description: 'Barcha loyihalarni qaytaradi. Ish boshlashdan oldin qaysi loyihada ishlayotganingni aniqla.',
    inputSchema: {},
  },
  async () => json(
    await prisma.project.findMany({
      select: { slug: true, name: true, status: true, note: true, _count: { select: { leads: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ),
);

reg(
  'project_create',
  {
    title: 'Loyiha yaratish',
    description: 'Yangi loyiha ochadi. Slug — qisqa lotin nom (masalan "bomond").',
    inputSchema: {
      slug: z.string().regex(/^[a-z0-9-]+$/, 'faqat kichik lotin, raqam va tire'),
      name: z.string(),
      note: z.string().optional(),
    },
  },
  async ({ slug, name, note }) => {
    const project = await prisma.project.upsert({
      where: { slug },
      create: { slug, name, note },
      update: { name, note },
    });
    return ok(`Loyiha tayyor: ${project.name} (${project.slug})`);
  },
);

// ───────────────────────────────── leadlar ─────────────────────────────────

reg(
  'lead_add',
  {
    title: 'Lead qo\'shish',
    description: 'Loyihaga yangi lead (potentsial mijoz) qo\'shadi. Bir kompaniya bir loyihada bir marta.',
    inputSchema: {
      project: z.string().describe('loyiha slugi'),
      company: z.string(),
      person: z.string().optional(),
      role: z.string().optional(),
      source: z.enum(['linkedin', 'instagram', 'maps', 'vacancy', 'telegram', 'manual']).default('manual'),
      sourceUrl: z.string().optional(),
      site: z.string().optional(),
      note: z.string().optional(),
    },
  },
  async ({ project, company, ...rest }) => {
    const projectId = await projectIdBySlug(project);
    const lead = await prisma.lead.upsert({
      where: { projectId_company: { projectId, company } },
      create: { projectId, company, ...rest },
      update: { ...rest },
    });
    return ok(`Lead: ${lead.company} (id: ${lead.id}, holat: ${lead.status})`);
  },
);

reg(
  'lead_list',
  {
    title: 'Leadlar ro\'yxati',
    description: 'Loyihadagi leadlarni qaytaradi. Holat bo\'yicha filtrlash mumkin.',
    inputSchema: {
      project: z.string(),
      status: z.string().optional().describe('new | researched | diagnosed | drafted | sent | replied | meeting | won | lost | dead'),
      limit: z.number().int().min(1).max(100).default(20),
    },
  },
  async ({ project, status, limit }) => {
    const projectId = await projectIdBySlug(project);
    return json(
      await prisma.lead.findMany({
        where: { projectId, ...(status ? { status } : {}) },
        select: {
          id: true, company: true, person: true, status: true, source: true, site: true,
          _count: { select: { facts: true, pains: true, drafts: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      }),
    );
  },
);

reg(
  'lead_get',
  {
    title: 'Lead tafsiloti',
    description: 'Leadning barcha faktlari, og\'riqlari va draftlari bilan to\'liq ko\'rinishi.',
    inputSchema: { leadId: z.string() },
  },
  async ({ leadId }) => {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        facts: { orderBy: { createdAt: 'asc' } },
        pains: { orderBy: { createdAt: 'desc' } },
        drafts: { orderBy: { createdAt: 'desc' }, take: 5 },
        project: { select: { slug: true, name: true } },
      },
    });
    if (!lead) throw new Error(`lead topilmadi: ${leadId}`);
    return json(lead);
  },
);

reg(
  'lead_status',
  {
    title: 'Lead holatini o\'zgartirish',
    description: 'Lead holatini yangilaydi (masalan sent, replied, meeting, dead).',
    inputSchema: {
      leadId: z.string(),
      status: z.enum(['new', 'researched', 'diagnosed', 'drafted', 'approved', 'sent', 'replied', 'meeting', 'won', 'lost', 'dead']),
      note: z.string().optional(),
    },
  },
  async ({ leadId, status, note }) => {
    const lead = await prisma.lead.update({ where: { id: leadId }, data: { status, note } });
    return ok(`${lead.company} → ${lead.status}`);
  },
);

// ──────────────────────────── dossier va og'riq ────────────────────────────

reg(
  'fact_add',
  {
    title: 'Dossierga fakt qo\'shish',
    description:
      'Lead haqida DALILLI fakt saqlaydi. sourceUrl majburiy — manbasiz fakt qabul qilinmaydi. O\'ylab topilgan ma\'lumot yozma.',
    inputSchema: {
      leadId: z.string(),
      kind: z.enum(['site', 'vacancy', 'instagram', 'maps', 'telegram', 'news', 'other']),
      text: z.string().describe('faktning qisqa bayoni'),
      sourceUrl: z.string().describe('havola — majburiy'),
      quote: z.string().optional().describe('manbadan aynan iqtibos'),
    },
  },
  async ({ leadId, ...rest }) => {
    const fact = await prisma.fact.create({ data: { leadId, agent: AGENT, ...rest } });
    return ok(`Fakt saqlandi (${fact.kind}): ${fact.text}`);
  },
);

reg(
  'pain_add',
  {
    title: 'Og\'riq gipotezasi qo\'shish',
    description:
      'Leadning biznesidagi kamchilikni saqlaydi. Har gipoteza kamida bitta dalil bilan bo\'lishi shart.',
    inputSchema: {
      leadId: z.string(),
      claim: z.string().max(200).describe('bitta aniq gap'),
      confidence: z.enum(['past', 'orta', 'yuqori']).default('orta'),
      evidence: z
        .array(z.object({ sourceUrl: z.string(), quote: z.string().optional() }))
        .min(1, 'dalilsiz og\'riq qabul qilinmaydi'),
    },
  },
  async ({ leadId, claim, confidence, evidence }) => {
    const pain = await prisma.pain.create({
      data: { leadId, claim, confidence, evidence, agent: AGENT },
    });
    await prisma.lead.update({ where: { id: leadId }, data: { status: 'diagnosed' } });
    return ok(`Og'riq saqlandi (${pain.confidence}): ${pain.claim}`);
  },
);

// ───────────────────────────────── draftlar ─────────────────────────────────

reg(
  'draft_save',
  {
    title: 'Xabar draftini saqlash',
    description:
      'Leadga yoziladigan xabar draftini saqlaydi. Draft O\'ZI YUBORILMAYDI — Sardor tasdiqlagandan keyin u qo\'lda yuboradi.',
    inputSchema: {
      leadId: z.string(),
      text: z.string(),
      channel: z.enum(['linkedin', 'telegram', 'email', 'instagram']).default('linkedin'),
    },
  },
  async ({ leadId, text, channel }) => {
    const draft = await prisma.draft.create({ data: { leadId, text, channel, agent: AGENT } });
    await prisma.lead.update({ where: { id: leadId }, data: { status: 'drafted' } });
    return ok(`Draft saqlandi (id: ${draft.id}, holat: pending). Sardor tasdiqlashi kerak.`);
  },
);

reg(
  'draft_status',
  {
    title: 'Draft qarorini yozish',
    description:
      'Sardorning draft haqidagi qarorini saqlaydi. Bu ayni paytda ML uchun yorliq bo\'lib yoziladi.',
    inputSchema: {
      draftId: z.string(),
      status: z.enum(['approved', 'edited', 'rejected', 'sent']),
      note: z.string().optional().describe('Sardorning izohi yoki tuzatishi'),
    },
  },
  async ({ draftId, status, note }) => {
    const draft = await prisma.draft.update({ where: { id: draftId }, data: { status } });
    const lead = await prisma.lead.findUnique({ where: { id: draft.leadId }, select: { projectId: true } });
    await prisma.outcome.create({
      data: {
        projectId: lead?.projectId,
        subjectType: 'draft',
        subjectId: draftId,
        label: status,
        source: 'sardor',
        note,
      },
    });
    return ok(`Draft ${status}. Yorliq ML uchun yozildi.`);
  },
);

// ──────────────────────── Telegram outreach (Sales user akkaunt) ────────────────────────
// Bot API'dan farqli — bu HAQIQIY Telegram akkaunt, leadga BIRINCHI bo'lib
// yoza oladi. `pnpm sales:login` bilan bir martalik ulanadi (SALES_TG_SESSION).

reg(
  'telegram_resolve_lead',
  {
    title: 'Leadni Telegram\'da topish',
    description:
      'Lead\'ning telefon raqamidan Telegram foydalanuvchisini topadi (kontakt sifatida import qilib) va thread\'ga bog\'laydi. Topilmasa xato qaytaradi — demak kanal Telegram emas, boshqasini (sayt, Instagram) sina.',
    inputSchema: {
      leadId: z.string(),
      phone: z.string().describe('xalqaro formatda, masalan +998901234567'),
      displayName: z.string().optional(),
    },
  },
  async ({ leadId, phone, displayName }) => {
    const peerId = await resolveLeadPeer(prisma, leadId, phone, displayName ?? '');
    return ok(`Topildi va bog'landi (peer: ${peerId}). Endi telegram_send bilan yozishing mumkin.`);
  },
);

reg(
  'telegram_send',
  {
    title: 'Leadga Telegram orqali yozish',
    description:
      'Shaxsiy Telegram akkauntdan (Sales) leadga to\'g\'ridan-to\'g\'ri xabar yuboradi — bot emas, DRAFT emas, DARHOL YETADI. Avval telegram_resolve_lead bilan topilgan bo\'lishi shart. Suhbat qoidasi: bitta xabar = bitta fikr/savol, uzun matn yubormang.',
    inputSchema: {
      leadId: z.string(),
      text: z.string().max(1000),
    },
  },
  async ({ leadId, text }) => {
    await sendToLead(prisma, leadId, text);
    return ok('Yuborildi.');
  },
);

reg(
  'telegram_thread',
  {
    title: 'Telegram yozishma tarixi',
    description:
      'Shu lead bilan Telegram orqali bo\'lgan butun yozishmani (kim, qachon, nima yozgan) qaytaradi — javob yozishdan oldin albatta o\'qing, exchangeCount 6 dan oshsa uchrashuv taklif qilish vaqti.',
    inputSchema: { leadId: z.string() },
  },
  async ({ leadId }) => {
    const thread = await getThreadHistory(prisma, leadId);
    if (!thread) return ok("Hali yozishma yo'q — avval telegram_resolve_lead.");
    return json({
      state: thread.state,
      exchangeCount: thread.exchangeCount,
      proposedTime: thread.proposedTime,
      messages: thread.messages.map((m) => ({ direction: m.direction, text: m.text, at: m.createdAt })),
    });
  },
);

reg(
  'ceo_propose_meeting',
  {
    title: "Uchrashuv vaqtini CEO'larga tasdiqqa yuborish",
    description:
      "Lead uchrashuv vaqtini qabul qilgach chaqiriladi. Ikkala CEO'ga ham (Telegram, Research bot orqali, `CEO_CHAT_ID` ichidagi har bir chatga) Accept/Decline tugmali xabar boradi — ikkisidan BIRI bossa yetarli. Qabul qilinsa — leadga avtomatik tasdiq xabari ketadi. Rad etilsa — leadga boshqa vaqt so'rab xabar ketadi. Bu DETERMINISTIK — siz javobni kutmaysiz, davom etavering.",
    inputSchema: {
      leadId: z.string(),
      proposedTime: z.string().describe('ISO sana-vaqt, masalan 2026-10-05T15:00:00+05:00'),
    },
  },
  async ({ leadId, proposedTime }) => {
    const botToken = process.env.TG_BOT_TOKEN_RESEARCH;
    const ceoChatIds = (process.env.CEO_CHAT_ID ?? '').split(',').map((id) => id.trim()).filter(Boolean);
    if (!botToken || !ceoChatIds.length) {
      throw new Error("TG_BOT_TOKEN_RESEARCH yoki CEO_CHAT_ID .env'da yo'q (CEO_CHAT_ID bir yoki bir nechta chat ID, vergul bilan ajratilgan).");
    }
    await proposeMeetingToCeo(prisma, leadId, new Date(proposedTime), { botToken, ceoChatIds });
    return ok("Ikkala CEO'ga ham yuborildi, javobini kutmoqda. Mijozga hali xabar yubormang — kim avval bossa, qarori leadga avtomatik ketadi.");
  },
);

reg(
  'sales_notify_ceo',
  {
    title: "CEO'larga xabar yuborish (Sales shaxsiy akkaunti orqali)",
    description:
      "Sales Telegram USER akkaunti orqali `SALES_CEO_CONTACTS` ichidagi HAR BIR qaror qabul qiluvchiga (Sardor, boshqa CEO) BIR XIL matnni yuboradi. Bot-tugma ISHLATILMAYDI (shaxsiy akkaunt callback_data biriktira olmaydi) — shuning uchun variant tanlash kerak bo'lsa matnni o'zing A) B) C) kabi harfli ro'yxat qilib yoz, CEO harf bilan javob beradi. Masalan: navbatdagi leadlardan qaysi biriga yozishni so'rash uchun ishlatiladi. Javobni keyin `sales_ceo_inbox` bilan o'qi.",
    inputSchema: {
      text: z.string().max(2000),
    },
  },
  async ({ text }) => {
    const notified = await notifyCeos(prisma, text);
    return ok(`Yuborildi: ${notified.map((n) => n.label).join(', ')}. Javobni sales_ceo_inbox bilan tekshir.`);
  },
);

reg(
  'sales_ceo_inbox',
  {
    title: "CEO'lar bilan so'nggi yozishma",
    description:
      "`sales_notify_ceo` bilan yuborilgan savolga (masalan 'qaysi leadga yozay?') CEO'lardan kelgan javobni o'qish uchun. Hamma kontaktlar bo'ylab, vaqt bo'yicha aralash qaytadi — har qatorda kim yozgani (label) va yo'nalishi (in/out) ko'rinadi.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(20),
    },
  },
  async ({ limit }) => json(await ceoInbox(prisma, limit)),
);

// ──────────────────────────── umumiy bilim ────────────────────────────

reg(
  'insight_add',
  {
    title: 'Umumiy bilimga qo\'shish',
    description:
      'Nima ishlaganini saqlaydi — barcha agentlar o\'qiydi. Masalan: Sales "vakansiya og\'rig\'i eng ko\'p javob oladi" deb yozsa, Content shu mavzuda reel yasaydi.',
    inputSchema: {
      kind: z.enum(['pain', 'hook', 'channel', 'format']),
      text: z.string(),
      evidence: z.string().optional().describe('raqam yoki misol'),
      project: z.string().optional().describe('loyiha slugi; umumiy bo\'lsa bo\'sh qoldir'),
      score: z.number().min(0).max(1).optional(),
    },
  },
  async ({ kind, text, evidence, project, score }) => {
    const projectId = project ? await projectIdBySlug(project) : null;
    await prisma.insight.create({ data: { kind, text, evidence, projectId, score, agent: AGENT } });
    return ok(`Bilim saqlandi (${kind}): ${text}`);
  },
);

reg(
  'insight_list',
  {
    title: 'Umumiy bilimni o\'qish',
    description: 'Boshqa agentlar topgan bilimni qaytaradi. Ish boshlashdan oldin o\'qi.',
    inputSchema: {
      kind: z.enum(['pain', 'hook', 'channel', 'format']).optional(),
      project: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(15),
    },
  },
  async ({ kind, project, limit }) => {
    const projectId = project ? await projectIdBySlug(project) : undefined;
    return json(
      await prisma.insight.findMany({
        where: { ...(kind ? { kind } : {}), ...(projectId ? { projectId } : {}) },
        select: { kind: true, text: true, evidence: true, score: true, agent: true, createdAt: true },
        orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
        take: limit,
      }),
    );
  },
);

// ──────────────────────── LinkedIn (Sardor ochgan oynada) ────────────────────────
// Agent brauzer OCHMAYDI — Sardor ochgan va o'zi kirgan oynaga ulanadi.
// Oyna yopilsa kirish tugaydi. Yuborish tooli ataylab YO'Q.

reg(
  'browser_status',
  {
    title: 'Brauzer holati',
    description:
      'LinkedIn oynasi holati. Oyna ochiq bo\'lmasa TOOL O\'ZI OCHADI — Sardordan skript ishga tushirishni SO\'RAMA.',
    inputSchema: {},
  },
  async () => ok(await browserStatus()),
);

reg(
  'linkedin_search',
  {
    title: 'LinkedIn qidiruv',
    description:
      'LinkedIn\'da odam qidiradi. Chrome ochiq bo\'lmasa tool O\'ZI ochadi — Sardordan hech narsa so\'rama, shunchaki chaqir. Qidiruv so\'zini LinkedIn qidiruv qatoriga yozgandek ber (masalan: "klinika asoschisi Tashkent").',
    inputSchema: {
      query: z.string().describe('qidiruv so\'zlari'),
      limit: z.number().int().min(1).max(25).default(10),
    },
  },
  async ({ query, limit }) => json(await linkedinSearch(query, limit)),
);

reg(
  'linkedin_profile',
  {
    title: 'LinkedIn profilini o\'qish',
    description:
      'Bitta profil sahifasining matnini qaytaradi. Undan faktlarni olib `fact_add` bilan saqla — havola sifatida profil manzilini ko\'rsat.',
    inputSchema: { profileUrl: z.string().describe('https://www.linkedin.com/in/...') },
  },
  async ({ profileUrl }) => ok(await linkedinProfile(profileUrl)),
);

// ──────────────────────── rasm va video ────────────────────────
// Hermes'ning o'z image_gen tooli pullik backend talab qiladi. Bu yerda
// Sardorning bepul Gemini web quvuri (gem2.py) va v3 render quvuri ochiladi —
// terminal bermasdan, faqat shu ikki amal.

reg(
  'image_generate',
  {
    title: 'Rasm yasash (Gemini)',
    description:
      'Gemini web sessiyasi orqali rasm yasaydi va promo-reels/public/ ga saqlaydi. Kunlik kvota ~5 rasm — behuda sarflama, avval mavjud rasmni qayta ishlatishni o\'ylab ko\'r. Prompt inglizcha bo\'lsin, rasmda matn bo\'lmasin.',
    inputSchema: {
      prompt: z.string().describe('inglizcha tavsif; rasmda matn so\'ralmasin'),
      name: z.string().describe('fayl nomi, kengaytmasiz (masalan tc12_dashboard)'),
    },
  },
  async ({ prompt, name }) => ok(`Rasm tayyor: ${await imageGenerate(prompt, name)}`),
);

reg(
  'reel_render',
  {
    title: 'Reel render qilish',
    description:
      'Tayyor v3 spec.json faylidan reel yasaydi (rasm → render → musiqa → mux → muqova). Telegram\'ga YUBORMAYDI va jurnalga sinov deb yoziladi — joylash qarori Sardorda. 20 daqiqagacha davom etishi mumkin.',
    inputSchema: {
      specPath: z.string().describe('spec.json to\'liq yo\'li (~/hermes/work/<sana>/<loyiha>/spec.json)'),
    },
  },
  async ({ specPath }) => {
    const { video, log, sizeMb, compressed } = await reelRender(specPath);
    return ok(
      `Video tayyor: ${video}\n` +
        `Hajmi: ${sizeMb.toFixed(1)} MB${compressed ? ' (siqildi — Telegram 50 MB chegarasi)' : ''}\n\n` +
        `Oxirgi log:\n${log}`,
    );
  },
);

// ──────────────── reel bilimi (agent skript yozmaydi) ────────────────

reg(
  'reel_knowledge',
  {
    title: 'Reel bilimi',
    description:
      'Reel yasashdan OLDIN o\'qi. spec — spec.json formati; layouts — mavjud layoutlar katalogi; image_prompt — Gemini prompti qoidalari (isbotlangan).',
    inputSchema: {
      topic: z.enum(['spec', 'layouts', 'image_prompt']),
      search: z.string().optional().describe('layouts uchun: aniq layout nomi'),
    },
  },
  async ({ topic, search }) => ok(reelKnowledge(topic, search)),
);

reg(
  'public_images',
  {
    title: 'Mavjud rasmlar',
    description:
      'promo-reels/public/ dagi rasmlar ro\'yxati. Yangi rasm yasashdan OLDIN shuni ko\'r — kvota ~5/kun, mavjudini qayta ishlatish afzal.',
    inputSchema: { project: z.string().optional().describe('tezdetal | maxsavdo | raos | tezcode') },
  },
  async ({ project }) => json(publicImages(project)),
);

reg(
  'spec_save',
  {
    title: 'Spec saqlash',
    description:
      'Yozgan spec\'ingni ish papkasiga saqlaydi va yo\'lini qaytaradi. Keyin shu yo\'l bilan reel_render chaqiriladi. Sen SKRIPT YOZMAYSAN — faqat spec va promptlarni yozasan.',
    inputSchema: {
      project: z.string().describe('tezdetal | maxsavdo | raos | tezcode'),
      spec: z.record(z.string(), z.unknown()).describe('SPEC.md formatidagi obyekt'),
    },
  },
  async ({ project, spec }) => ok(`Spec saqlandi: ${specSave(project, spec)}`),
);

reg(
  'linkedin_thread',
  {
    title: 'Suhbatni o\'qish',
    description:
      'Shu odam bilan LinkedIn suhbat tarixini qaytaradi. Javob yozishdan OLDIN chaqir — kontekstsiz javob yozma.',
    inputSchema: { profileUrl: z.string().describe('https://www.linkedin.com/in/...') },
  },
  async ({ profileUrl }) => ok(await linkedinThread(profileUrl)),
);

reg(
  'linkedin_type_draft',
  {
    title: 'Xabarni yozib qo\'yish (yubormaydi)',
    description:
      'Matnni LinkedIn xabar maydoniga yozadi, lekin YUBORMAYDI — Send tugmasini Sardor bosadi. Yozishdan oldin `lead_get` bilan dossierni, `linkedin_thread` bilan suhbatni o\'qi. Matn: bitta aniq og\'riq (dalil bilan) → u nimaga turadi → savol. Narx yozma, "14 kun bepul" yozma.',
    inputSchema: {
      profileUrl: z.string(),
      text: z.string().max(1800),
    },
  },
  async ({ profileUrl, text }) => ok(await linkedinTypeDraft(profileUrl, text)),
);

reg(
  'lead_handoff',
  {
    title: 'Leadni Sales\'ga uzatish',
    description:
      'Research ishini tugatgach leadni Sales\'ga uzatadi: holat "researched" bo\'ladi va izoh qo\'shiladi. Sales `lead_list(status: "researched")` bilan ko\'radi.',
    inputSchema: {
      leadId: z.string(),
      note: z.string().describe('Sales uchun qisqa xulosa: eng kuchli og\'riq va nega'),
    },
  },
  async ({ leadId, note }) => {
    const lead = await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'researched', note },
    });
    const facts = await prisma.fact.count({ where: { leadId } });
    return ok(`${lead.company} → Sales'ga uzatildi (${facts} fakt bilan).`);
  },
);

// ──────────────────────── SEO / GEO / AEO ────────────────────────
// Texnik tekshiruvni skript qiladi — "menimcha bor" degan javob bo'lmaydi.

async function siteIdOf(domain: string): Promise<string> {
  const clean = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  const site = await prisma.seoSite.findUnique({ where: { domain: clean } });
  if (!site) throw new Error(`sayt ro'yxatda yo'q: ${clean} (avval seo_site_add)`);
  return site.id;
}

reg(
  'seo_site_add',
  {
    title: 'Saytni kuzatuvga qo\'shish',
    description: 'Saytni ro\'yxatga oladi. Pozitsiya va auditlar shu saytga bog\'lanadi.',
    inputSchema: { domain: z.string(), name: z.string(), note: z.string().optional() },
  },
  async ({ domain, name, note }) => {
    const clean = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    const site = await prisma.seoSite.upsert({
      where: { domain: clean }, create: { domain: clean, name, note }, update: { name, note },
    });
    return ok(`Sayt kuzatuvda: ${site.name} (${site.domain})`);
  },
);

reg(
  'site_crawl',
  {
    title: 'Sayt sahifalarini topish',
    description:
      'Domenni beradi — sahifalarni O\'ZI topadi: avval sitemap.xml va robots.txt dagi sitemap\'lar, ' +
      'ular yo\'q bo\'lsa bosh sahifadan ichki havolalar bo\'ylab yuradi. Har sahifadan title, description, ' +
      'H1, H2, til, so\'z soni, noindex o\'qiladi va bazaga yoziladi. Notanish sayt bilan ish SHU YERDAN ' +
      'boshlanadi — sahifalar ro\'yxatini Sardordan so\'rama.',
    inputSchema: {
      domain: z.string().describe('masalan tezcode.dev'),
      limit: z.number().min(1).max(200).default(40),
    },
  },
  async ({ domain, limit }) => {
    const clean = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    const site = await prisma.seoSite.upsert({
      where: { domain: clean }, create: { domain: clean, name: clean }, update: {},
    });
    const res = await siteCrawl(domain, limit);
    if (!res.pages.length) {
      throw new Error(`Sahifa topilmadi: ${res.root}. Sayt ochilmayapti yoki so'rovlar rad etildi.`);
    }
    for (const p of res.pages) {
      const data = {
        status: p.status, title: p.title, description: p.description, h1: p.h1,
        h2: p.h2.join('\n'), lang: p.lang, words: p.words, noindex: p.noindex,
        text: p.text, source: p.source,
      };
      await prisma.seoPage.upsert({
        where: { siteId_url: { siteId: site.id, url: p.url } },
        create: { siteId: site.id, url: p.url, ...data },
        update: data,
      });
    }
    const langs = new Map<string, number>();
    for (const p of res.pages) langs.set(p.lang, (langs.get(p.lang) ?? 0) + 1);
    const cnt = (f: (p: (typeof res.pages)[number]) => boolean) => res.pages.filter(f).length;
    const lines = res.pages.slice(0, 40).map(
      (p) => `${p.url.replace(res.root, '') || '/'} — ${p.words} so'z, ${p.lang}` +
        `${p.noindex ? ', NOINDEX' : ''}${p.title ? '' : ', title yo\'q'}${p.h1 ? '' : ', H1 yo\'q'}`,
    );
    return ok(
      `${res.pages.length} sahifa topildi (${res.source})\n` +
      `tillar: ${[...langs].map(([l, n]) => `${l}=${n}`).join(', ')}\n` +
      `title yo'q: ${cnt((p) => !p.title)} · description yo'q: ${cnt((p) => !p.description)} · ` +
      `H1 yo'q: ${cnt((p) => !p.h1)} · noindex: ${cnt((p) => p.noindex)} · ` +
      `300 so'zdan kam: ${cnt((p) => p.words < 300)}\n` +
      (res.errors.length ? `ochilmadi: ${res.errors.length} ta\n` : '') +
      `\n${lines.join('\n')}` +
      (res.pages.length > 40 ? `\n… yana ${res.pages.length - 40} ta` : ''),
    );
  },
);

reg(
  'query_discover',
  {
    title: 'Qidiruv so\'rovi nomzodlari',
    description:
      'Crawl qilingan sahifalardan 2-4 so\'zli ibora nomzodlarini chiqaradi. Sarlavha va H1 dagi ibora ' +
      'matn ichidagidan og\'irroq vaznlanadi. Bu NOMZOD ro\'yxati — bazaga o\'zi yozmaydi. Qaysi biri ' +
      'haqiqiy mijoz so\'rovi ekanini sen hal qilasan va `seo_query_add` bilan yozasan.',
    inputSchema: {
      domain: z.string(),
      limit: z.number().min(5).max(60).default(25),
    },
  },
  async ({ domain, limit }) => {
    const siteId = await siteIdOf(domain);
    const rows = await prisma.seoPage.findMany({ where: { siteId } });
    if (!rows.length) throw new Error('Bu sayt uchun crawl yo\'q — avval site_crawl chaqir.');
    const cands = discoverQueries(
      rows.map((r) => ({
        url: r.url, status: r.status, title: r.title ?? '', description: r.description ?? '',
        h1: r.h1 ?? '', h2: (r.h2 ?? '').split('\n').filter(Boolean), lang: r.lang ?? 'uz',
        words: r.words, noindex: r.noindex, text: r.text ?? '', source: 'sitemap' as const,
      })),
      limit,
    );
    if (!cands.length) return ok('Nomzod topilmadi — sahifalarda matn juda kam.');
    const lines = cands.map(
      (c, i) => `${i + 1}. "${c.phrase}" [${c.locale}] · ball ${c.score} · ` +
        `${c.pages} sahifada · eng kuchli joyi: ${c.strongest}`,
    );
    return ok(
      `${rows.length} sahifadan ${cands.length} nomzod:\n\n${lines.join('\n')}\n\n` +
      'Eslatma: bular saytning O\'Z so\'zlari. Mijoz boshqacha yozishi mumkin — ' +
      'tanlashdan oldin shuni o\'ylab ko\'r, kerak bo\'lsa o\'zgartirib yoz.',
    );
  },
);

reg(
  'repo_seo_scan',
  {
    title: 'Loyiha kodini SEO bo\'yicha tekshirish',
    description:
      'Repo NOMINI beradi (domen emas) — kodni o\'qib SEO/GEO/AEO holatini o\'lchaydi: framework, ' +
      'har route\'da metadata bormi, JSON-LD, sitemap, robots, llms.txt, canonical, hreflang, ' +
      'FAQPage, i18n tillari. Sayt hali chiqmagan bo\'lsa ham ishlaydi. `seo_audit` SABABINI shu yerdan ' +
      'topasan: sahifada title yo\'q bo\'lsa — qaysi faylda yo\'qligini shu ko\'rsatadi. ' +
      'Repolar ro\'yxati: `code_repos`.',
    inputSchema: { repo: z.string().describe('code_repos dagi nom, masalan tezcode-landing yoki raos') },
  },
  async ({ repo }) => {
    const entry = codeRepos().find((r) => r.repo === repo);
    if (!entry) {
      throw new Error(`"${repo}" yo'q. Mavjudlari: ${codeRepos().map((r) => r.repo).join(', ')}`);
    }
    const r = await repoSeoScan(repo, entry.path);
    const order = { muhim: 0, "o'rta": 1, past: 2 } as Record<string, number>;
    const fs = [...r.findings].sort((a, b) => order[a.level] - order[b.level]);
    const factLines = Object.entries(r.facts).map(([k, v]) => `${k}: ${v}`).join(' · ');
    const routeLines = r.routes.length
      ? r.routes.slice(0, 30).map(
          (x) => `${x.hasMetadata ? '+' : '-'}meta ${x.hasJsonLd ? '+' : '-'}ld  ${x.path}`,
        ).join('\n')
      : '(route aniqlanmadi)';
    return ok(
      `${repo} (${entry.writable ? 'tahrir mumkin' : 'faqat o\'qish'})\n${factLines}\n\n` +
      `TOPILMALAR (${fs.length}):\n` +
      (fs.length ? fs.map((f) => `[${f.level}] ${f.what}${f.where !== '-' ? ` — ${f.where}` : ''}`).join('\n') : 'yo\'q') +
      `\n\nROUTE'LAR (${r.routes.length}):\n${routeLines}` +
      (r.routes.length > 30 ? `\n… yana ${r.routes.length - 30} ta` : ''),
    );
  },
);

reg(
  'seo_knowledge',
  {
    title: 'Loyihalar tajribasi',
    description:
      'Bizning loyihalarimizda SEO/GEO/AEO bo\'yicha NIMA QILINGAN va NIMA ISHLAMAGAN. ' +
      'Loyihalar: tezcode, clinicago, maxsavdo, tezdetal, raos. ' +
      'Argumentsiz — ro\'yxat va bo\'limlar. `project` bilan — o\'sha loyihaning bo\'limlari. ' +
      '`project` + `section` bilan — bo\'lim matni. ' +
      'Tezcode ustida ishlashdan OLDIN `seo_knowledge("tezcode")` ni o\'qi — nol nuqtadan boshlama.',
    inputSchema: {
      project: z.string().optional().describe('tezcode | clinicago | maxsavdo | tezdetal | raos'),
      section: z.string().optional().describe('bo\'lim sarlavhasi yoki uning bir qismi'),
    },
  },
  async ({ project, section }) => {
    if (!project) {
      const list = knowledgeList();
      return ok(
        `Bilim bazasi — ${list.length} loyiha:\n\n` +
        list.map((x) => `## ${x.project} (${x.lines} qator)\n${x.sections.join('\n')}`).join('\n\n'),
      );
    }
    return ok(knowledgeRead(project, section));
  },
);

reg(
  'seo_knowledge_search',
  {
    title: 'Tajribadan qidirish',
    description:
      'Barcha loyihalar tarixi bo\'ylab so\'z qidiradi. "Bu muammoni avval kim ko\'rgan?" degan ' +
      'savolga javob beradi — masalan "hreflang", "llms.txt", "backlink", "alt", "LCP", "doorway". ' +
      'Xato qilishdan oldin shu yerdan qara: ehtimol bu xato allaqachon qilingan.',
    inputSchema: { term: z.string(), limit: z.number().min(3).max(50).default(20) },
  },
  async ({ term, limit }) => {
    const hits = knowledgeSearch(term, limit);
    if (!hits.length) return ok(`"${term}" bo'yicha hech narsa yo'q.`);
    return ok(
      `"${term}" — ${hits.length} topilma:\n\n` +
      hits.map((h) => `[${h.project} › ${h.section}]\n${h.line}`).join('\n\n'),
    );
  },
);

reg(
  'seo_audit',
  {
    title: 'Texnik audit',
    description:
      'Sahifani o\'lchaydi: robots va AI botlar, sitemap, llms.txt, title/description, indexable, canonical, hreflang, JSON-LD turlari, AEO (savol shaklidagi H2), RU sahifada "ИИ". Natija bazaga yoziladi, ball (0-100) qaytadi.',
    inputSchema: { url: z.string(), domain: z.string().optional().describe('kuzatuvdagi sayt; berilsa natija saqlanadi') },
  },
  async ({ url, domain }) => {
    const res = await seoAudit(url);
    if (domain) {
      await prisma.seoAudit.create({
        data: { siteId: await siteIdOf(domain), url: res.url, result: res.checks as object, score: res.score },
      });
    }
    const lines = Object.entries(res.checks).map(([k, v]) => `${v.ok ? '+' : '-'} ${k}: ${v.detail}`);
    return ok(`${res.url}\nBall: ${res.score}/100\n\n${lines.join('\n')}`);
  },
);

reg(
  'seo_query_add',
  {
    title: 'Target so\'rov qo\'shish',
    description: 'Kuzatiladigan qidiruv so\'rovini qo\'shadi. Odam aynan nima yozsa — shuni yoz, rasmiy atama emas.',
    inputSchema: {
      domain: z.string(),
      query: z.string(),
      locale: z.enum(['uz', 'ru', 'en']).default('uz'),
      category: z.string().optional(),
      priority: z.number().int().min(1).max(5).default(3),
    },
  },
  async ({ domain, query, locale, category, priority }) => {
    const siteId = await siteIdOf(domain);
    await prisma.seoQuery.upsert({
      where: { siteId_query_locale: { siteId, query, locale } },
      create: { siteId, query, locale, category, priority },
      update: { category, priority },
    });
    return ok(`So'rov qo'shildi: "${query}" (${locale}, ustuvorlik ${priority})`);
  },
);

reg(
  'rank_check',
  {
    title: 'Pozitsiyani tekshirish',
    description:
      'Google\'da so\'rov bo\'yicha saytning o\'rnini o\'lchaydi va TARIXGA yozadi. Top 10 ni ham qaytaradi — raqobatchini shundan ko\'rasan. Kuniga 30 tekshiruv chegarasi bor.',
    inputSchema: { domain: z.string(), query: z.string(), locale: z.enum(['uz', 'ru', 'en']).default('uz') },
  },
  async ({ domain, query, locale }) => {
    const siteId = await siteIdOf(domain);
    const q = await prisma.seoQuery.upsert({
      where: { siteId_query_locale: { siteId, query, locale } },
      create: { siteId, query, locale },
      update: {},
    });
    const { position, url, top } = await rankOf(query, domain);
    await prisma.rankCheck.create({
      data: { queryId: q.id, position, url, top: top as object },
    });
    const prev = await prisma.rankCheck.findFirst({
      where: { queryId: q.id, id: { not: undefined } },
      orderBy: { checkedAt: 'desc' }, skip: 1,
    });
    const move = prev?.position && position ? ` (oldin ${prev.position})` : '';
    return ok(
      `"${query}" → ${position ? `${position}-o'rin${move}` : 'top 20 da yo\'q'}\n` +
        (url ? `${url}\n` : '') +
        `\nTop 10:\n${top.map((t) => `${t.position}. ${t.title}\n   ${t.url}`).join('\n')}`,
    );
  },
);

reg(
  'rank_history',
  {
    title: 'Pozitsiya tarixi',
    description: 'Sayt bo\'yicha kuzatilayotgan so\'rovlar va ularning oxirgi o\'rinlari — qayerdan qayerga siljigani.',
    inputSchema: { domain: z.string() },
  },
  async ({ domain }) => {
    const siteId = await siteIdOf(domain);
    const queries = await prisma.seoQuery.findMany({
      where: { siteId },
      orderBy: { priority: 'asc' },
      include: { ranks: { orderBy: { checkedAt: 'desc' }, take: 3 } },
    });
    return json(
      queries.map((q) => ({
        query: q.query, locale: q.locale, priority: q.priority,
        oxirgi: q.ranks.map((r) => ({ orin: r.position, sana: r.checkedAt.toISOString().slice(0, 10) })),
      })),
    );
  },
);

reg(
  'competitor_scan',
  {
    title: 'Raqobatchilarni ko\'rish',
    description: 'So\'rov bo\'yicha Google top 10 ni qaytaradi. Top 1 ga chiqish uchun avval kim turganini bilish kerak.',
    inputSchema: { query: z.string(), limit: z.number().int().min(3).max(20).default(10) },
  },
  async ({ query, limit }) => json(await serpTop(query, limit)),
);

// ──────────── o'z-o'zini rivojlantirish va to'siqlar ────────────

reg(
  'lesson_list',
  {
    title: 'Saboqlarni o\'qish',
    description:
      'HAR ISH BOSHIDA chaqir. Oldingi xatolardan chiqqan qoidalar. Bularni buzish — o\'sha xatoni takrorlash demak.',
    inputSchema: {
      scope: z.string().optional().describe('seo | content | sales | research | umumiy; bo\'sh bo\'lsa hammasi'),
    },
  },
  async ({ scope }) => {
    const rows = await prisma.lesson.findMany({
      where: { active: true, ...(scope ? { OR: [{ scope }, { scope: 'umumiy' }] } : {}) },
      orderBy: [{ source: 'asc' }, { createdAt: 'desc' }],
      take: 60,
    });
    if (!rows.length) return ok('Saboq yo\'q — bu birinchi ish.');
    await prisma.lesson.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { hits: { increment: 1 } } });
    return ok(
      rows
        .map((r) => `[${r.scope}] ${r.trigger}\n  → ${r.rule}${r.evidence ? `\n  (sabab: ${r.evidence})` : ''}`)
        .join('\n\n'),
    );
  },
);

reg(
  'lesson_add',
  {
    title: 'Saboq yozish',
    description:
      'Xato qilganingda yoki Sardor tuzatganda DARHOL yoz. Qoida aniq va bajariladigan bo\'lsin — "ehtiyot bo\'l" emas, "X holatda Y qil". Shu saboq keyingi safar o\'qiladi va xato takrorlanmaydi.',
    inputSchema: {
      scope: z.string().describe('seo | content | sales | research | umumiy'),
      trigger: z.string().max(200).describe('qachon eslash kerak'),
      rule: z.string().max(400).describe('nima qilish kerak'),
      evidence: z.string().max(400).optional().describe('nima xato bo\'ldi yoki Sardor nima dedi'),
      source: z.enum(['sardor', 'ozi']).default('ozi'),
    },
  },
  async ({ scope, trigger, rule, evidence, source }) => {
    const l = await prisma.lesson.create({
      data: { agent: AGENT, scope, trigger, rule, evidence, source },
    });
    return ok(`Saboq yozildi (${l.scope}): ${l.rule}`);
  },
);

reg(
  'blocker_add',
  {
    title: 'To\'siqni qayd qilish',
    description:
      'O\'zing bajara olmaydigan ishga duch kelsang yoz: nima qilmoqchi eding, nega qila olmading, insondan AYNAN nima kerak. Yozgach Sardorga chatda ham ayt — jimgina to\'xtab qolma.',
    inputSchema: {
      what: z.string().max(300),
      why: z.string().max(300),
      need: z.string().max(300).describe('insondan aniq nima kerak: kirish, ruxsat, qaror, ma\'lumot'),
    },
  },
  async ({ what, why, need }) => {
    const b = await prisma.blocker.create({ data: { agent: AGENT, what, why, need } });
    return ok(`To'siq qayd qilindi (id: ${b.id}). Endi Sardorga chatda ayt: nima kerakligini aniq yoz.`);
  },
);

reg(
  'blocker_list',
  {
    title: 'Ochiq to\'siqlar',
    description: 'Hali hal qilinmagan to\'siqlar. Ish boshida ko\'r — balki allaqachon so\'ralgan.',
    inputSchema: { status: z.enum(['open', 'resolved', 'wontfix']).default('open') },
  },
  async ({ status }) =>
    json(
      await prisma.blocker.findMany({
        where: { status },
        select: { id: true, agent: true, what: true, need: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
    ),
);

reg(
  'blocker_resolve',
  {
    title: 'To\'siqni yopish',
    description: 'Sardor javob bergach yoki yo\'l topilgach yop.',
    inputSchema: {
      id: z.string(),
      answer: z.string().max(400),
      status: z.enum(['resolved', 'wontfix']).default('resolved'),
    },
  },
  async ({ id, answer, status }) => {
    await prisma.blocker.update({ where: { id }, data: { status, answer, resolvedAt: new Date() } });
    return ok('To\'siq yopildi.');
  },
);

// ──────────── SEO vazifalari: tavsiya emas, kuzatiladigan ish ────────────

reg(
  'seo_task_add',
  {
    title: 'SEO vazifa qo\'shish',
    description:
      'Tavsiyani vazifaga aylantiradi. `detail` shunday yozilsinki, buni boshqa odam o\'qib, savol bermasdan bajara olsin. "FAQ qo\'shing" emas — qaysi sahifaga, qaysi savollar, qaysi schema, javob uzunligi qancha.',
    inputSchema: {
      domain: z.string(),
      title: z.string().max(120),
      detail: z.string().max(1500),
      target: z.string().optional().describe('sahifa URL yoki fayl yo\'li'),
      impact: z.number().int().min(1).max(5).default(3),
      effort: z.number().int().min(1).max(5).default(3),
      owner: z.string().optional(),
    },
  },
  async ({ domain, ...rest }) => {
    const t = await prisma.seoTask.create({ data: { siteId: await siteIdOf(domain), ...rest } });
    return ok(`Vazifa qo'shildi: ${t.title} (foyda ${t.impact}, kuch ${t.effort})`);
  },
);

reg(
  'seo_task_list',
  {
    title: 'SEO vazifalar',
    description:
      'Vazifalar ro\'yxati. Ustuvorlik bo\'yicha saralangan: foyda yuqori, kuch past bo\'lganlar tepada — avval shularni qil.',
    inputSchema: {
      domain: z.string(),
      status: z.enum(['open', 'doing', 'done', 'dropped']).default('open'),
    },
  },
  async ({ domain, status }) => {
    const rows = await prisma.seoTask.findMany({
      where: { siteId: await siteIdOf(domain), status },
      orderBy: [{ impact: 'desc' }, { effort: 'asc' }, { createdAt: 'asc' }],
      take: 40,
    });
    if (!rows.length) return ok(`"${status}" holatida vazifa yo'q.`);
    return ok(
      rows
        .map((t) => `[${t.id.slice(0, 6)}] foyda ${t.impact}/kuch ${t.effort} — ${t.title}` +
          (t.target ? `\n    ${t.target}` : '') + `\n    ${t.detail.slice(0, 200)}`)
        .join('\n\n'),
    );
  },
);

reg(
  'seo_task_status',
  {
    title: 'Vazifa holatini yangilash',
    description: 'Vazifa bajarilgan yoki tashlab yuborilganini belgilaydi.',
    inputSchema: {
      id: z.string().describe('to\'liq id yoki boshlanishi'),
      status: z.enum(['open', 'doing', 'done', 'dropped']),
      note: z.string().max(400).optional(),
    },
  },
  async ({ id, status, note }) => {
    const task = await prisma.seoTask.findFirst({ where: { id: { startsWith: id } } });
    if (!task) throw new Error(`vazifa topilmadi: ${id}`);
    await prisma.seoTask.update({
      where: { id: task.id },
      data: { status, note, doneAt: status === 'done' ? new Date() : null },
    });
    return ok(`${task.title} → ${status}`);
  },
);

reg(
  'seo_digest',
  {
    title: 'Sayt holati — qisqa xulosa',
    description:
      'Bitta chaqiruvda hamma narsa: oxirgi audit bali, kuzatilayotgan so\'rovlar va ularning siljishi, ochiq vazifalar. Haftalik hisobot uchun shuni ishlat.',
    inputSchema: { domain: z.string() },
  },
  async ({ domain }) => {
    const siteId = await siteIdOf(domain);
    const [site, audit, queries, tasks] = await Promise.all([
      prisma.seoSite.findUnique({ where: { id: siteId } }),
      prisma.seoAudit.findFirst({ where: { siteId }, orderBy: { createdAt: 'desc' } }),
      prisma.seoQuery.findMany({
        where: { siteId },
        orderBy: { priority: 'asc' },
        include: { ranks: { orderBy: { checkedAt: 'desc' }, take: 2 } },
        take: 25,
      }),
      prisma.seoTask.groupBy({ by: ['status'], where: { siteId }, _count: true }),
    ]);

    const lines: string[] = [`${site?.name} (${site?.domain})`];
    lines.push(
      audit
        ? `Audit: ${audit.score}/100 — ${audit.createdAt.toISOString().slice(0, 10)}`
        : 'Audit: hali qilinmagan',
    );

    if (queries.length) {
      lines.push('', 'So\'rovlar:');
      for (const q of queries) {
        const [now, prev] = q.ranks;
        const cur = now?.position ?? null;
        const before = prev?.position ?? null;
        let move = '';
        if (cur && before) move = cur < before ? ` (+${before - cur})` : cur > before ? ` (-${cur - before})` : ' (=)';
        lines.push(`  ${cur ? `${cur}-o'rin${move}` : 'top 20 da yo\'q'} — "${q.query}" [${q.locale}]`);
      }
    } else {
      lines.push('', 'Kuzatilayotgan so\'rov yo\'q.');
    }

    const counts = Object.fromEntries(tasks.map((t) => [t.status, t._count]));
    lines.push('', `Vazifalar: ochiq ${counts.open ?? 0}, jarayonda ${counts.doing ?? 0}, bajarilgan ${counts.done ?? 0}`);
    return ok(lines.join('\n'));
  },
);

reg(
  'seo_site_list',
  {
    title: 'Kuzatuvdagi saytlar',
    description: 'Barcha kuzatilayotgan saytlar. Jadval bo\'yicha ishlaganda shundan boshla.',
    inputSchema: {},
  },
  async () =>
    json(
      await prisma.seoSite.findMany({
        select: {
          domain: true, name: true,
          _count: { select: { queries: true, tasks: true, audits: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ),
);

// ──────────────────────── kod tahriri (faqat oq ro'yxat) ────────────────────────
// Push tooli YO'Q. Commit uchun avval Sardordan ruxsat so'rash SHART.

reg(
  'code_repos',
  {
    title: 'Ruxsat etilgan repolar',
    description: 'Qaysi repoga kira olishingni ko\'rsatadi. Boshqasiga umuman kirib bo\'lmaydi.',
    inputSchema: {},
  },
  async () => json(codeRepos()),
);

reg(
  'code_tree',
  {
    title: 'Fayl tuzilmasi',
    description: 'Repodagi papka va fayllar ro\'yxati. Tahrirlashdan oldin tuzilmani ko\'r.',
    inputSchema: {
      repo: z.string(),
      path: z.string().default('.'),
      depth: z.number().int().min(1).max(4).default(2),
    },
  },
  async ({ repo, path, depth }) => ok(await codeTree(repo, path, depth)),
);

reg(
  'code_read',
  {
    title: 'Faylni o\'qish',
    description: 'Fayl mazmunini qaytaradi. Tahrirlashdan OLDIN majburiy — find matnini shundan aniq ko\'chirasan.',
    inputSchema: { repo: z.string(), path: z.string() },
  },
  async ({ repo, path }) => ok(codeRead(repo, path)),
);

reg(
  'code_search',
  {
    title: 'Kodda qidirish',
    description: 'Matn yoki naqsh bo\'yicha qidiradi. Masalan meta tegni yoki schema blokini topish uchun.',
    inputSchema: {
      repo: z.string(),
      pattern: z.string(),
      include: z.string().optional().describe('masalan *.tsx'),
    },
  },
  async ({ repo, pattern, include }) => ok(await codeSearch(repo, pattern, include)),
);

reg(
  'code_edit',
  {
    title: 'Faylni tahrirlash',
    description:
      'Aniq matnni almashtiradi. `find` faylda AYNAN BIR MARTA uchrashi shart — aks holda xato qaytadi va hech narsa o\'zgarmaydi. Avval code_read bilan o\'qib, matnni aynan ko\'chir. Tahrirdan keyin code_verify chaqirish SHART.',
    inputSchema: {
      repo: z.string(),
      path: z.string(),
      find: z.string().describe('almashtiriladigan aniq matn'),
      replace: z.string().describe('yangi matn'),
      taskId: z.string().optional().describe('qaysi SEO vazifa uchun'),
    },
  },
  async ({ repo, path, find, replace, taskId }) => {
    const res = codeEdit(repo, path, find, replace);
    await prisma.toolCall.create({
      data: {
        node: 'code_edit', tool: `${repo}:${path}`,
        input: { find: find.slice(0, 500), replace: replace.slice(0, 500), taskId, agent: AGENT } as object,
        output: { result: res } as object,
      },
    });
    return ok(`${res}\n\nEndi code_verify chaqir — build buzilmaganini tekshir.`);
  },
);

reg(
  'code_diff',
  {
    title: 'O\'zgarishlarni ko\'rish',
    description: 'Commit qilinmagan o\'zgarishlar. Sardorga ko\'rsatishdan oldin shuni ol.',
    inputSchema: { repo: z.string(), path: z.string().optional() },
  },
  async ({ repo, path }) => ok(await codeDiff(repo, path)),
);

reg(
  'code_revert',
  {
    title: 'O\'zgarishni bekor qilish',
    description: 'Fayldagi commit qilinmagan o\'zgarishlarni orqaga qaytaradi.',
    inputSchema: { repo: z.string(), path: z.string() },
  },
  async ({ repo, path }) => ok(await codeRevert(repo, path)),
);

reg(
  'code_verify',
  {
    title: 'Tekshirish (type-check)',
    description:
      'Tahrirdan keyin MAJBURIY. O\'tmasa o\'zgarishing yaroqsiz — code_revert bilan qaytar yoki tuzat. Buzilgan kod tuzatilmagan koddan yomon.',
    inputSchema: { repo: z.string() },
  },
  async ({ repo }) => {
    const { ok: passed, output } = await codeVerify(repo);
    return ok(`${passed ? 'O\'TDI' : 'O\'TMADI'}\n\n${output}`);
  },
);

reg(
  'code_status',
  {
    title: 'Git holati',
    description: 'Qaysi fayllar o\'zgargan va qaysi branchdasan.',
    inputSchema: { repo: z.string() },
  },
  async ({ repo }) => ok(await codeStatus(repo)),
);

reg(
  'code_commit',
  {
    title: 'Lokal commit',
    description:
      'DIQQAT: buni chaqirishdan OLDIN Sardordan ruxsat so\'rashing SHART. Avval code_diff bilan o\'zgarishni ko\'rsat, u "ha" desagina commit qil. Push YO\'Q — uni Sardor o\'zi qiladi. type-check o\'tmasa commit bo\'lmaydi.',
    inputSchema: {
      repo: z.string(),
      message: z.string().max(200).describe('inglizcha, conventional commit uslubida'),
    },
  },
  async ({ repo, message }) => ok(await codeCommit(repo, message)),
);

// ──────────── Sardor yuborgan fayllar (Telegram biriktirmalari) ────────────

reg(
  'inbox_list',
  {
    title: 'Yuborilgan fayllar',
    description:
      'Sardor Telegram orqali yuborgan fayllar ro\'yxati, yangisidan boshlab. U "faylni o\'qi" desa shundan boshla.',
    inputSchema: { limit: z.number().int().min(1).max(50).default(15) },
  },
  async ({ limit }) => json(inboxList(limit)),
);

reg(
  'inbox_read',
  {
    title: 'Yuborilgan faylni o\'qish',
    description:
      'Sardor yuborgan matn faylini o\'qiydi (md, txt, json, csv, kod). Yo\'lni inbox_list dan ol yoki xabarda ko\'rsatilgan to\'liq yo\'lni ber. Rasm uchun vision_analyze ishlat.',
    inputSchema: { path: z.string() },
  },
  async ({ path }) => ok(inboxRead(path)),
);

// ──────────── Hermes kontent xotirasi (tirik fayllar) ────────────

reg(
  'content_memory_topics',
  {
    title: 'Kontent xotirasi — mavzular',
    description: 'Qaysi bilim manbalari borligini ko\'rsatadi va har biri nima uchun kerakligini aytadi.',
    inputSchema: {},
  },
  async () => json(contentMemoryTopics()),
);

reg(
  'content_memory',
  {
    title: 'Kontent xotirasini o\'qish',
    description:
      'Hermes kontent quvurining tirik bilimi. Mavzular: saboqlar (Sardor qoidalari, eng ustun), priyomlar (usullar P1-P10), referenslar (R-saboqlar), tekshiruv (yuborishdan oldingi ro\'yxat), jurnal (oldingi videolar — takrorlamaslik uchun), plan_log (qarorlar), metrics (Instagram statistikasi), mavzular (g\'oyalar banki).',
    inputSchema: {
      topic: z.enum(['saboqlar', 'priyomlar', 'referenslar', 'tekshiruv', 'jurnal', 'plan_log', 'metrics', 'mavzular']),
    },
  },
  async ({ topic }) => ok(contentMemory(topic)),
);

// ──────────── brend ma'lumotlari (bitta manba) ────────────

reg(
  'brand_list',
  {
    title: 'Brendlar ro\'yxati',
    description: 'Qaysi brendlar bor va har biri nima qiladi.',
    inputSchema: {},
  },
  async () => json(brandList()),
);

reg(
  'brand_facts',
  {
    title: 'Brend ma\'lumoti',
    description:
      'Bitta brend haqida hamma narsa: sayt, Instagram, reel ranglari (PALETTES dan), rasm prefiksi, pozitsiya, auditoriya va SHU BRENDGA XOS QAT\'IY QOIDALAR. Kontent yozishdan oldin chaqir — ranglarni yoki qoidalarni xotiradan yozma.',
    inputSchema: { brand: z.string().describe('tezcode | tezdetal | maxsavdo | raos') },
  },
  async ({ brand }) => json(brandFacts(brand)),
);

reg(
  'reel_compress',
  {
    title: 'Videoni siqish',
    description:
      'Videoni berilgan hajmgacha siqadi (bitrate davomiylikdan hisoblanadi). Instagram uchun siqish SHART EMAS — u to\'g\'ridan-to\'g\'ri Meta\'ga yuklanadi. Bu tool Telegram orqali yuborish uchun kerak: Telegram bot 50 MB dan kattasini yubormaydi.',
    inputSchema: {
      path: z.string().describe('.mp4 to\'liq yo\'li'),
      targetMb: z.number().min(5).max(45).default(45).describe('maqsadli hajm, MB'),
    },
  },
  async ({ path, targetMb }) => {
    const r = await reelCompress(path, targetMb);
    return ok(
      r.path === path
        ? `Siqish shart emas — ${r.before.toFixed(1)} MB`
        : `Siqildi: ${r.before.toFixed(1)} MB → ${r.after.toFixed(1)} MB\n${r.path}`,
    );
  },
);

// ──────────── Instagram (qaytarib bo'lmaydigan, ommaviy) ────────────

reg(
  'instagram_check',
  {
    title: 'Instagram ulanishini tekshirish',
    description: 'Token ishlayaptimi va qaysi akkauntga ulanganini ko\'rsatadi. Xavfsiz — hech narsa joylamaydi.',
    inputSchema: { account: z.enum(IG_ACCOUNTS as [string, ...string[]]).default('tezcode') },
  },
  async ({ account }) => ok(await instagramCheck(account)),
);

reg(
  'instagram_publish',
  {
    title: 'Instagram\'ga Reels joylash',
    description:
      'DIQQAT: bu OMMAVIY va QAYTARIB BO\'LMAYDIGAN amal. `dryRun` sukut bo\'yicha true — bu holda faqat tekshiradi, joylamaydi. Haqiqatan joylash uchun Sardor aniq "joyla" deyishi SHART, keyin dryRun: false. Muqova majburiy. Videoni LOKAL yo\'l bilan ber — asl .mp4 bo\'lsa ham bo\'ladi, hajm muhim emas: 19 MB dan kattasini tool o\'zi ffmpeg bilan siqadi. Siqishni Sardordan SO\'RAMA va skript so\'rama.',
    inputSchema: {
      account: z.enum(IG_ACCOUNTS as [string, ...string[]]),
      video: z.string().describe('.mp4 to\'liq yo\'li'),
      cover: z.string().describe('muqova png/jpg — 1080x1920'),
      caption: z.string().min(20).describe('opisaniya, 40-60 so\'z'),
      story: z.boolean().default(false),
      dryRun: z.boolean().default(true).describe('true — sinov; false — HAQIQATAN joylaydi'),
    },
  },
  async ({ account, video, cover, caption, story, dryRun }) => {
    const res = await instagramPublish({ account, video, cover, caption, story, dryRun });
    await prisma.toolCall.create({
      data: {
        node: 'instagram_publish',
        tool: account,
        input: { video, cover, caption: caption.slice(0, 500), story, dryRun, agent: AGENT } as object,
        output: { result: res.slice(0, 1000) } as object,
      },
    });
    return ok(res);
  },
);

async function main(): Promise<void> {
  await prisma.$connect();
  await server.connect(new StdioServerTransport());
}

void main().catch((err) => {
  console.error('MCP server xatosi:', err);
  process.exit(1);
});
