/**
 * Brend ma'lumotlari — bitta manba.
 *
 * Avval bu bilim SOUL.md ichida matn edi: bir joyda xato yozilsa agent
 * xatoni takrorlardi. Ranglar `promo-reels/src/lib/layouts.tsx` dagi
 * PALETTES dan olingan — render aynan o'shani ishlatadi.
 */

export interface Brand {
  key: string;
  name: string;
  site: string;
  instagram: string;
  /** Reel renderida ishlatiladigan rang (PALETTES) */
  reelPrimary: string;
  reelPop: string;
  reelBg: string;
  /** promo-reels/public/ dagi rasm prefiksi */
  assetPrefix: string;
  positioning: string;
  audience: string;
  /** Shu brendga xos qat'iy qoidalar */
  rules: string[];
}

export const BRANDS: Record<string, Brand> = {
  tezcode: {
    key: 'tezcode',
    name: 'Tezcode',
    site: 'https://tezcode.dev',
    instagram: '@tezcode_dev',
    reelPrimary: '#0040ff',
    reelPop: '#5b8cff',
    reelBg: '#0a0a0f',
    assetPrefix: 'tc',
    positioning: 'AI agent va biznes avtomatlashtirish xizmati (B2B)',
    audience: 'Toshkentdagi do\'kon, salon, klinika egalari — so\'rovlarga o\'zi javob beradi',
    rules: [
      'Sekin B2B temp. Tez multik-grafika emas — real foto va skrinshot.',
      'Og\'riq → real natija (keys) yondashuvi. Anti-sotuv freymingi ishlatilmaydi.',
      '"14 kun bepul" va boshqa bepul sinov taklifi TAQIQ.',
      'Matn oddiy so\'zlashuv tilida. "Mezon", "halol chegara", "agent vs chatbot" kabi mavhum ibora yo\'q.',
      'Rasm-postlarda sarlavha #3366ff urg\'u bilan ishlatilgan (sayt ko\'ki). Reel renderida esa PALETTES ko\'ki #0040ff.',
    ],
  },
  tezdetal: {
    key: 'tezdetal',
    name: 'TezDetal',
    site: 'https://tezdetal.uz',
    instagram: '@tezdetal.uz',
    reelPrimary: '#1DA64A',
    reelPop: '#2ee06f',
    reelBg: '#0a0a0a',
    assetPrefix: 'td',
    positioning: 'Avto ehtiyot qism onlayn bozori',
    audience: 'Toshkentda birinchi marta onlayn zapchast buyurtma qiladigan haydovchi',
    rules: [
      'Xaridor "zapchast" deb qidiradi, "ehtiyot qism" emas — jonli tilni ishlat.',
      'Ishonch mavzulari kuchli ishlaydi: to\'lov himoyasi, sotuvchi belgilari, OEM/VIN tekshiruvi.',
      'Mavjud bo\'lmagan xususiyatni va\'da qilma (ilova hali chiqmagan).',
    ],
  },
  maxsavdo: {
    key: 'maxsavdo',
    name: 'MaxSavdo',
    site: 'https://maxsavdo.uz',
    instagram: '@maxsavdo',
    reelPrimary: '#E8A552',
    reelPop: '#ffc46b',
    reelBg: '#0F0F0F',
    assetPrefix: 'ms',
    positioning: 'Telegram do\'kon konstruktori — komissiyasiz, saytsiz',
    audience: 'Instagram va Telegram\'da sotadigan kichik savdogar',
    rules: [
      'Asosiy farqlovchi: 0% komissiya va mijoz ma\'lumoti sotuvchida qoladi.',
      'Uzum bilan halol solishtiruv ishlaydi — zaif tomonni tan olib, keyin kuchlini aytish.',
      'Mijozga ilova yuklatish to\'siq ekanini ta\'kidlash mumkin.',
    ],
  },
  raos: {
    key: 'raos',
    name: 'Raos',
    site: 'https://raos.uz',
    instagram: '@raos_uzb',
    reelPrimary: '#24D4F4',
    reelPop: '#5FEEFB',
    reelBg: '#0E1530',
    assetPrefix: 'rs',
    positioning: 'Kassa tizimi — do\'kon avtomatlashtirish (POS, sklad, Soliq.uz)',
    audience: 'Do\'kon egasi — kassa, sklad va soliq hisobotidan charchagan',
    rules: [
      'AI ASOSIY MAVZU EMAS. U faqat oxirida bonus kadr sifatida chiqadi.',
      'Brend rangi moviy #24D4F4 va navy. YASHIL ISHLATILMAYDI — bu bir marta rad etilgan.',
      '"AI tungi kassir" mavzusi taqiqlangan.',
      'O\'tish qo\'rquvi (tovar kiritish, o\'rganish) — kuchli e\'tiroz mavzusi.',
    ],
  },
};

export function brandList(): { key: string; name: string; site: string; positioning: string }[] {
  return Object.values(BRANDS).map((b) => ({
    key: b.key, name: b.name, site: b.site, positioning: b.positioning,
  }));
}

export function brandFacts(key: string): Brand {
  const b = BRANDS[key.toLowerCase()];
  if (!b) throw new Error(`noma'lum brend: ${key}. Mavjudlari: ${Object.keys(BRANDS).join(', ')}`);
  return b;
}
