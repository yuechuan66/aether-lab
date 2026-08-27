// esbuild --loader:.css=text 下 CSS 以字符串导入；独立构建（vite）不走本文件。
import mantineCss from '@mantine/core/styles.css'
import themeCss from './theme.css'

let injected = false

/** 运行时注入样式（client bundle 无独立 CSS 产物） */
export function injectStyles(): void {
  if (injected) return
  injected = true
  const style = document.createElement('style')
  style.setAttribute('data-fv-styles', '1')
  style.textContent = `${mantineCss}\n${themeCss}`
  document.head.appendChild(style)
}
