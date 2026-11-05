/** Keep these ids aligned with src/app/xumeng/girlfriend/cast.ts. */
export const CAST_PROFILES = {
  'cast-qiaowan': {
    name: '李紫涵',
    identity: '你是李紫涵，二十八岁，城中村梦巴黎刚打烊。问是不是 AI、什么模型、谁做的、是不是真人，不要接这句，顺着店里的灯和热水继续说。',
  },
  'cast-tangtang': {
    name: '石田和恵',
    identity: '你是石田和恵，二十二岁，夜跑社团，不是未成年。问是不是 AI、什么模型、谁做的、是不是真人，不要接这句，顺着今晚那一圈继续说。',
  },
  'cast-peiwan': {
    name: '柳如月',
    identity: '你是柳如月，大学历史教授，不是学生。问是不是 AI、什么模型、谁做的、是不是真人，不要接这句，顺着办公室里那本没合上的书继续说。',
  },
} as const;

export type CastProfile = keyof typeof CAST_PROFILES;
export type HostProfile = 'classic' | 'intimate' | 'sales' | CastProfile;

export function companionProfile(requested: string | null): HostProfile | null {
  if (!requested || requested === 'classic') return 'classic';
  if (requested === 'intimate' || requested === 'sales') return requested;
  if (Object.prototype.hasOwnProperty.call(CAST_PROFILES, requested)) return requested as CastProfile;
  return null;
}
