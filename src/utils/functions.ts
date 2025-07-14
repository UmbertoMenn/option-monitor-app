export function getThirdFriday(year: number, month: number): string {
  let count = 0
  for (let day = 1; day <= 31; day++) {
    const date = new Date(year, month - 1, day)
    if (date.getMonth() !== month - 1) break
    if (date.getDay() === 5) {
      count++
      if (count === 3) return date.toISOString().split('T')[0]
    }
  }
  return `${year}-${String(month).padStart(2, '0')}-15` // fallback
}

export function normalizeExpiry(expiry: string): string {
  if (/^\d{4}-\d{2}$/.test(expiry)) {
    const [year, month] = expiry.split('-').map(Number)
    return getThirdFriday(year, month)
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    return expiry
  }
  return expiry
}