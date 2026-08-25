import fs from 'node:fs'
import path from 'node:path'

/** 定位运行中的 @deepseek-ai/dsh 安装根目录（含 package.json 的目录） */
export function findDshRoot(): string | null {
  const entry = process.argv[1]
  if (!entry) return null
  let d = path.dirname(path.resolve(entry))
  for (let i = 0; i < 4; i++) {
    const pj = path.join(d, 'package.json')
    if (fs.existsSync(pj)) {
      try {
        if (JSON.parse(fs.readFileSync(pj, 'utf-8')).name === '@deepseek-ai/dsh') return d
      } catch {
        // 继续向上
      }
    }
    d = path.dirname(d)
  }
  return null
}

// 编译后形态稳定：ctx.tools.register(defineTool({\n name: "write",
const REGISTER_PAT = /register\(\s*defineTool\(\{\s*name:\s*["']([^"']+)["']/g

/** 扫描已安装的插件子包，生成 工具名 → 包名 映射。与用户实际安装的 DSH 版本自动对齐。 */
export function scanInstalledTools(dshRoot: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!dshRoot) return out
  const nm = path.join(dshRoot, 'node_modules', '@deepseek-ai')
  let dirs: string[] = []
  try {
    dirs = fs.readdirSync(nm)
  } catch {
    return out
  }
  for (const dir of dirs) {
    const lib = path.join(nm, dir, 'lib')
    try {
      if (!fs.statSync(lib).isDirectory()) continue
    } catch {
      continue
    }
    let files: string[] = []
    try {
      files = fs.readdirSync(lib).filter((f) => f.endsWith('.js'))
    } catch {
      continue
    }
    for (const f of files) {
      let text = ''
      try {
        text = fs.readFileSync(path.join(lib, f), 'utf-8')
      } catch {
        continue
      }
      if (!text.includes('defineTool')) continue
      const pkg = `@deepseek-ai/${dir}`
      for (const m of text.matchAll(REGISTER_PAT)) {
        // 双归属（persistent 变体）优先非 persistent 包
        const prev = out[m[1]]
        if (!prev || (prev.endsWith('-persistent') && !pkg.endsWith('-persistent'))) out[m[1]] = pkg
      }
    }
  }
  return out
}
