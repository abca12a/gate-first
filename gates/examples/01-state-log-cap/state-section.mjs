/**
 * `docs/STATE.md` 的「当前动作」节：**边界与行数上限的唯一来源**。
 *
 * 为什么单独抽成一个零副作用模块：
 * 状态读取脚本（打印给人/Agent 读）与门禁检查脚本（超限 exit 1）必须共用同一个阈值与同一套切片边界。
 * 各写一份 `120` 迟早会漂移成「一边报超了、一边判通过」且两边测试各自全绿。
 */
export const HEADING = '## 当前动作'

/**
 * 「当前动作」节行数上限。
 * 挡的不是文档体积本身，而是开工状态入口被历史流水账淹没（实测无门禁时 8 天长到 569 行 / 104 KB）。
 */
export const LINE_LIMIT = 120

/**
 * 取行首「## 当前动作」标题到下一个行首 `## ` 之间（不含下一个二级标题）。
 * 必须按行首锚定匹配，防止顶部说明引用块中提及「## 当前动作」字面量时错切区间。
 * 找不到该节时返回 `section: null` —— 空或缺失一律按错误处理，不解释成「没有下一步」。
 */
export function readCurrentAction(text) {
  const normalized = text.replace(/\r\n/g, '\n')
  const headingMatch = /^## 当前动作[ \t]*$/m.exec(normalized)
  if (!headingMatch) return { section: null, lineCount: 0 }

  const start = headingMatch.index
  const rest = normalized.slice(start)
  const nextHeading = rest.indexOf('\n## ', 1)
  const section = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim()
  return { section, lineCount: section.split('\n').length }
}

/**
 * 去掉 `> ` 引用说明行之后的正文。仅留标题和引用块视为空正文。
 */
export function currentActionBody(section) {
  return section
    .split('\n')
    .filter((line) => !line.startsWith('> '))
    .join('\n')
    .trim()
}
