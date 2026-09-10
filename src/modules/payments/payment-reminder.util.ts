const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'

type CalendarParts = { year: number; month: number; day: number }

function calendarParts(date: Date): CalendarParts {
  if (Number.isNaN(date.getTime())) throw new Error('INVALID_DATE')
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = new Map(parts.map(part => [part.type, part.value]))
  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
  }
}

export function vietnamDateKey(date: Date): string {
  const { year, month, day } = calendarParts(date)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function reminderDateKey(dueDate: Date): string {
  const { year, month, day } = calendarParts(dueDate)
  const reminderDate = new Date(Date.UTC(year, month - 1, day - 7))
  return reminderDate.toISOString().slice(0, 10)
}
