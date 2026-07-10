// Rivals weapon SKINS + skin cases. A skin is a material override applied to a
// weapon's gun mesh (client). A case costs ClaudeBux and drops 3 skins for 3
// random weapons (server rolls). Owned/equipped skins live on the platform user.

export const SKIN_WEAPONS = ['ar', 'handgun', 'sniper', 'scythe'];
export const CASE_PRICE = 5;   // ClaudeBux per case (3 skins)

// mat: applied as a MeshStandardMaterial override on every part of the gun.
const S = (id, weapon, name, rarity, mat) => ({ id, weapon, name, rarity, mat });
export const SKINS = [
  // ---- AR ----
  S('ar-carbon',  'ar', 'Carbon Fibre', 'common', { color: '#15171d', metalness: 0.6, roughness: 0.5 }),
  S('ar-desert',  'ar', 'Desert',       'common', { color: '#b89a63', metalness: 0.3, roughness: 0.7 }),
  S('ar-crimson', 'ar', 'Crimson',      'rare',   { color: '#c02233', metalness: 0.5, roughness: 0.35 }),
  S('ar-toxic',   'ar', 'Toxic',        'rare',   { color: '#4dff6a', emissive: '#149a2a', emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.4 }),
  S('ar-glacier', 'ar', 'Glacier',      'epic',   { color: '#a6e8ff', emissive: '#279fd0', emissiveIntensity: 0.4, metalness: 0.7, roughness: 0.2 }),
  S('ar-midas',   'ar', 'Midas',        'legendary', { color: '#e8bf5a', emissive: '#3a2600', emissiveIntensity: 0.25, metalness: 1, roughness: 0.22 }),
  // ---- Handgun ----
  S('hg-steel',   'handgun', 'Brushed Steel', 'common', { color: '#aeb6c4', metalness: 0.9, roughness: 0.32 }),
  S('hg-shadow',  'handgun', 'Shadow',        'common', { color: '#0c0e14', metalness: 0.5, roughness: 0.6 }),
  S('hg-royal',   'handgun', 'Royal',         'rare',   { color: '#3a4bd0', metalness: 0.6, roughness: 0.3 }),
  S('hg-neon',    'handgun', 'Neon',          'epic',   { color: '#ff4aa0', emissive: '#c01070', emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.35 }),
  S('hg-gold',    'handgun', 'Golden Deagle', 'legendary', { color: '#e8bf5a', emissive: '#3a2600', emissiveIntensity: 0.25, metalness: 1, roughness: 0.22 }),
  // ---- Sniper ----
  S('sn-wood',    'sniper', 'Woodland',   'common', { color: '#5a6a3a', metalness: 0.2, roughness: 0.75 }),
  S('sn-urban',   'sniper', 'Urban',      'common', { color: '#6b7078', metalness: 0.5, roughness: 0.5 }),
  S('sn-flame',   'sniper', 'Inferno',    'rare',   { color: '#ff6a1a', emissive: '#c0300a', emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.35 }),
  S('sn-void',    'sniper', 'Void',       'epic',   { color: '#6a2aff', emissive: '#3a0f9a', emissiveIntensity: 0.5, metalness: 0.6, roughness: 0.3 }),
  S('sn-gold',    'sniper', 'Golden Barrel', 'legendary', { color: '#e8bf5a', emissive: '#3a2600', emissiveIntensity: 0.25, metalness: 1, roughness: 0.22 }),
  // ---- Scythe (blade) ----
  S('sc-obsidian','scythe', 'Obsidian',   'common', { color: '#1a1020', metalness: 0.7, roughness: 0.3 }),
  S('sc-plasma',  'scythe', 'Plasma',     'epic',   { color: '#4dffff', emissive: '#10a0c0', emissiveIntensity: 0.85, metalness: 0.5, roughness: 0.2 }),
  S('sc-gold',    'scythe', 'Golden Edge','legendary', { color: '#e8bf5a', emissive: '#3a2600', emissiveIntensity: 0.3, metalness: 1, roughness: 0.2 }),
];
export const SKIN_BY_ID = Object.fromEntries(SKINS.map((s) => [s.id, s]));
export const SKINS_BY_WEAPON = SKIN_WEAPONS.reduce((o, w) => { o[w] = SKINS.filter((s) => s.weapon === w); return o; }, {});
export const RARITY_COLOR = { common: '#9aa4b8', rare: '#4a9eff', epic: '#b46bff', legendary: '#ffbf3a' };
const RARITY_WEIGHT = { common: 55, rare: 28, epic: 13, legendary: 4 };

function weightedPick(pool, rand) {
  const total = pool.reduce((s, x) => s + (RARITY_WEIGHT[x.rarity] || 10), 0);
  let r = rand() * total;
  for (const x of pool) { r -= (RARITY_WEIGHT[x.rarity] || 10); if (r <= 0) return x; }
  return pool[pool.length - 1];
}
// 3 skins for 3 DISTINCT random weapons (weighted by rarity)
export function rollCase(rand = Math.random) {
  const weps = [...SKIN_WEAPONS].sort(() => rand() - 0.5).slice(0, 3);
  return weps.map((w) => weightedPick(SKINS_BY_WEAPON[w], rand).id);
}
