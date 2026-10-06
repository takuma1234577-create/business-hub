import pool from './agentNames.json'

// 担当ごとの日本人名。IDから決まる固定の名前（再読み込みしても変わらない）。重なったら次の組み合わせへずらす
export function buildNames(ids: string[]): Map<string, string> {
  const used = new Set<string>()
  const out = new Map<string, string>()
  const F = pool.family.length, G = pool.given.length
  for (const id of [...ids].sort()) {
    let h = 2166136261
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0
    for (let k = 0; k < F * G; k++) {
      const n = (h + k * 7919) % (F * G)
      const name = `${pool.family[n % F]} ${pool.given[Math.floor(n / F) % G]}`
      if (!used.has(name)) { used.add(name); out.set(id, name); break }
    }
  }
  return out
}
