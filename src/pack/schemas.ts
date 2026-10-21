// 월드 팩·세이브 백업 안의 JSON 모양. 가져올 때 하나하나 검사한다.
import { z } from 'zod';

export const PACK_FORMAT = 'my-gacha-world';
export const BACKUP_FORMAT = 'my-gacha-backup';
export const FORMAT_VERSION = 1;

const id = z.string().min(1).max(200);
const iso = z.string().max(64);
const text = (max = 20000) => z.string().max(max);

export const imageEntrySchema = z.object({
  file: z.string().min(1).max(300),
  assetId: id,
  mime: z.enum(['image/webp', 'image/png', 'image/jpeg']),
  width: z.number().int().nonnegative().max(20000),
  height: z.number().int().nonnegative().max(20000),
  prompt: text().optional(),
  negativePrompt: text().optional(),
  seed: z.number().optional(),
});

export const manifestSchema = z.object({
  format: z.string(),
  formatVersion: z.number().int(),
  schemaVersion: z.number().int(),
  worldName: text(500),
  author: text(500).optional(),
  createdAt: iso,
  includes: z.object({ story: z.boolean() }),
  characters: z.number().int().nonnegative(),
  images: z.array(imageEntrySchema).max(5000),
  /** 백업에만 */
  saves: z.number().int().nonnegative().optional(),
});
export type Manifest = z.infer<typeof manifestSchema>;

const strList = z.array(text(200)).max(200);

export const worldFileSchema = z.object({
  id,
  schemaVersion: z.number().int(),
  name: text(500),
  language: text(20),
  description: text(),
  scenario: text(),
  directives: text(),
  tags: z.object({ position: strList, role: strList, element: strList, trait: strList }),
  currency: z.object({ pull: text(100), shop: text(100) }),
  art: z.object({ positiveTags: text(4000), negativeTags: text(4000) }),
  author: text(500).optional(),
  gachaOverrides: z.record(z.unknown()).optional(),
  createdAt: iso,
  updatedAt: iso,
});
export type WorldFile = z.infer<typeof worldFileSchema>;

const rarity = z.union([z.literal(3), z.literal(4), z.literal(5), z.literal(6)]);

export const characterSchema = z.object({
  id,
  worldId: z.string().optional(),
  name: text(500),
  rarity,
  tags: z.object({ position: text(200), role: strList, element: text(200), trait: strList }),
  appearance: text(),
  imageTags: text(4000),
  imageNegative: text(4000).optional(),
  personality: text(),
  background: text(),
  quotes: z.array(text(2000)).max(100),
  portraitId: id.optional(),
  stats: z
    .object({ hp: z.number(), atk: z.number(), def: z.number(), spd: z.number(), range: z.number(), block: z.number() })
    .optional(),
  detail: z.enum(['full', 'light']),
  createdAt: iso,
  updatedAt: iso,
});

export const bannerSchema = z.object({
  id,
  worldId: z.string().optional(),
  kind: z.enum(['standard', 'limited']),
  name: text(500),
  featured6: z.array(id).max(100),
  featured5: z.array(id).max(100),
  pool: z.array(id).max(5000).optional(),
  startsAt: iso.optional(),
  endsAt: iso.optional(),
  artId: id.optional(),
  createdAt: iso,
});

export const saveSchema = z.object({
  id,
  worldId: z.string().optional(),
  name: text(200),
  wallet: z.object({ pull: z.number(), shop: z.number() }),
  owned: z.record(z.object({ characterId: id, potential: z.number().int(), obtainedAt: iso })),
  pity: z.record(z.object({ sinceSix: z.number().int().nonnegative() })),
  banners: z.record(
    z.object({ pulls: z.number().int().nonnegative(), firstTenSatisfied: z.boolean(), sparkPoints: z.number().nonnegative() }),
  ),
  freeMode: z.boolean(),
  rngState: z.number(),
  featuredCharacterId: id.optional(),
  lastDailyClaim: z.string().max(20).optional(),
  createdAt: iso,
  updatedAt: iso,
});

export const pullRecordSchema = z.object({
  saveId: id,
  bannerId: id,
  characterId: id,
  rarity,
  pityBefore: z.number().int().nonnegative(),
  isNew: z.boolean(),
  at: iso,
});

export const pullsFileSchema = z.array(pullRecordSchema).max(1_000_000);
