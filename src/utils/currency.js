export const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
})

export const quantity = new Intl.NumberFormat('en-PH', {
  maximumFractionDigits: 3,
})

export const wholeNumber = new Intl.NumberFormat('en-PH', {
  maximumFractionDigits: 0,
})
