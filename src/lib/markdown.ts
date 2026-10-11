// Copilot の返答(Markdown)を、HTML を差し込まずに描画するための小さな解析器。
// 対応: 見出し・段落・箇条書き(番号つき含む)・表・コードブロック・太字・リンク・URL・インラインコード

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'code'; text: string }

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string }

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

export function parseBlocks(src: string): Block[] {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    if (line.trim().startsWith('```')) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++])
      i++
      out.push({ type: 'code', text: body.join('\n') })
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) { out.push({ type: 'heading', level: h[1].length, text: h[2].trim() }); i++; continue }
    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const header = cells(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]))
      out.push({ type: 'table', header, rows })
      continue
    }
    const li = line.match(/^\s*([-*]|\d+[.)])\s+(.*)$/)
    if (li) {
      const ordered = /\d/.test(li[1])
      const items: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*]|\d+[.)])\s+(.*)$/)
        if (!m || /\d/.test(m[1]) !== ordered) break
        items.push(m[2]); i++
      }
      out.push({ type: 'list', ordered, items })
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*([-*]|\d+[.)])\s|\s*\|)/.test(lines[i])) para.push(lines[i++])
    if (!para.length) para.push(lines[i++])
    out.push({ type: 'paragraph', text: para.join('\n') })
  }
  return out
}

const safeHref = (href: string) => /^https?:\/\//i.test(href)

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)<>）」]+)/g
  let last = 0
  let m: RegExpExecArray | null
  const pushText = (t: string) => {
    if (!t) return
    const prev = out[out.length - 1]
    if (prev && prev.type === 'text') prev.text += t
    else out.push({ type: 'text', text: t })
  }
  while ((m = re.exec(src))) {
    pushText(src.slice(last, m.index))
    if (m[1] != null) out.push({ type: 'bold', text: m[1] })
    else if (m[2] != null) out.push({ type: 'code', text: m[2] })
    else if (m[3] != null) {
      if (safeHref(m[4])) out.push({ type: 'link', text: m[3], href: m[4] })
      else pushText(m[0])
    } else if (m[5] != null) out.push({ type: 'link', text: m[5], href: m[5] })
    last = re.lastIndex
  }
  pushText(src.slice(last))
  return out
}
