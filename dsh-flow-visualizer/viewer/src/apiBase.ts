let base = ''

/** 独立 Viewer 用相对路径；原生 tab 嵌入时指向插件服务（http://127.0.0.1:<port>） */
export function setApiBase(b: string): void {
  base = b.replace(/\/$/, '')
}

export function getApiBase(): string {
  return base
}
