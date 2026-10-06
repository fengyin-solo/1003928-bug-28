/** 动作留痕存的是 ISO 时间，页面统一在这里格式化成「YYYY-MM-DD HH:mm」。 */
export function formatTime(value: string | number | undefined): string {
  if (value === undefined || value === null || value === '') {
    return '—'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }
  const pad = (part: number) => String(part).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}
