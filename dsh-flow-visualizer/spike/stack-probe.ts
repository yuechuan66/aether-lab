import type { Context } from '@deepseek-ai/cordis'

export const name = 'stack-probe'

/** 从调用栈解析 npm 包名：node_modules/@scope/pkg/... 或 node_modules/pkg/... */
function pkgFromStack(stack: string): string | null {
  const m = stack.match(/node_modules[\\/]+((?:@[^/\\\s]+[\\/])?[^/\\\s]+)/)
  return m ? m[1].replace(/[\\/]/g, '/') : null
}

export function apply(ctx: Context) {
  const anyCtx = ctx as any
  const proto = Object.getPrototypeOf(anyCtx)
  console.log('[probe] ctx proto methods:', Object.getOwnPropertyNames(proto).filter((k) => typeof proto[k] === 'function').join(', '))

  // 1. 包装原型 emit：动态触发者归因
  if (typeof proto.emit === 'function') {
    const orig = proto.emit
    proto.emit = function (...args: unknown[]) {
      const pkg = pkgFromStack(new Error().stack ?? '')
      if (pkg) console.log('[probe] emit', String(args[0]), 'by', pkg)
      return orig.apply(this, args as [])
    }
    console.log('[probe] patched Context.prototype.emit')
  }

  // 2. 包装原型 on：真实监听者清单
  if (typeof proto.on === 'function') {
    const orig = proto.on
    proto.on = function (...args: unknown[]) {
      const pkg = pkgFromStack(new Error().stack ?? '')
      if (pkg) console.log('[probe] on', String(args[0]), 'by', pkg)
      return orig.apply(this, args as [])
    }
    console.log('[probe] patched Context.prototype.on')
  }

  // 3. tools 注册表：轮询等服务就绪后包装 register 类方法
  let tries = 0
  const timer = setInterval(() => {
    tries++
    const tools = anyCtx.get?.('tools')
    if (!tools) {
      if (tries > 100) clearInterval(timer)
      return
    }
    clearInterval(timer)
    const tproto = Object.getPrototypeOf(tools)
    const methods = Object.getOwnPropertyNames(tproto).filter((k) => typeof tproto[k] === 'function')
    console.log('[probe] tools service methods:', methods.join(', '))
    for (const m of methods) {
      if (!/register|add|define|set/i.test(m)) continue
      const orig = tproto[m]
      tproto[m] = function (...args: unknown[]) {
        const pkg = pkgFromStack(new Error().stack ?? '')
        const first = args[0]
        const toolName = typeof first === 'string' ? first : (first as any)?.name
        console.log('[probe] tools.' + m, String(toolName), 'by', pkg)
        return orig.apply(this, args as [])
      }
      console.log('[probe] patched tools.' + m)
    }
  }, 50)

  // 4. 结构发现：ctx 自有键
  console.log('[probe] ctx own keys:', Object.keys(anyCtx).join(', '))
}
