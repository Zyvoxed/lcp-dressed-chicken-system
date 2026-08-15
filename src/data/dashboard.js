export const adminStats = [
  ['Sales Revenue (Net)', 21550, 'Today'],
  ['Low/Out Stock Warnings', '3 items', 'Immediate review'],
  ['Credit Ledger Debts', 4650, 'Open balances'],
  ['Wholesale Procurement Spend', 163100, 'This month'],
]

export const employeeStats = [
  ['My Sales Revenue', 8350, 'Today'],
  ['Low/Out Stock Warnings', '3 items', 'Immediate review'],
  ['Credit Ledger Debts', 4650, 'Open balances'],
  ['My Collected Payments', 6200, 'Posted today'],
]

export const salesPerformance = {
  weekly: [
    { label: 'Week 1', sales: 48200, orders: 156 },
    { label: 'Week 2', sales: 53600, orders: 174 },
    { label: 'Week 3', sales: 61500, orders: 198 },
    { label: 'Week 4', sales: 58800, orders: 187 },
    { label: 'Week 5', sales: 67400, orders: 214 },
  ],
  monthly: [
    { label: 'January', sales: 218000, orders: 692 },
    { label: 'February', sales: 236500, orders: 741 },
    { label: 'March', sales: 229800, orders: 718 },
    { label: 'April', sales: 258400, orders: 802 },
    { label: 'May', sales: 284200, orders: 864 },
    { label: 'June', sales: 301600, orders: 912 },
  ],
  quarterly: [
    { label: 'Q1', sales: 684300, orders: 2151 },
    { label: 'Q2', sales: 844200, orders: 2578 },
    { label: 'Q3', sales: 928500, orders: 2812 },
    { label: 'Q4', sales: 1014600, orders: 3096 },
  ],
}

export const productAnalytics = [
  {
    product: 'Chicken Breast Fillet',
    unitsSold: 520,
    revenue: 82500,
    profit: 24750,
    currentStock: 18,
    trend: 'Increasing',
    status: 'Best Seller',
    movement: [82, 96, 108, 114, 120],
  },
  {
    product: 'Chicken Wings',
    unitsSold: 430,
    revenue: 67800,
    profit: 20340,
    currentStock: 8,
    trend: 'Increasing',
    status: 'Restock Priority',
    movement: [58, 68, 82, 95, 127],
  },
  {
    product: 'Chicken Thighs',
    unitsSold: 385,
    revenue: 59000,
    profit: 17100,
    currentStock: 31,
    trend: 'Stable',
    status: 'Healthy Demand',
    movement: [76, 78, 77, 80, 79],
  },
  {
    product: 'Chicken Drumsticks',
    unitsSold: 340,
    revenue: 52400,
    profit: 15180,
    currentStock: 27,
    trend: 'Increasing',
    status: 'Growing',
    movement: [54, 61, 65, 72, 88],
  },
  {
    product: 'Regular Dressed Chicken',
    unitsSold: 315,
    revenue: 47100,
    profit: 13200,
    currentStock: 86,
    trend: 'Stable',
    status: 'Stable Demand',
    movement: [68, 70, 66, 71, 69],
  },
  {
    product: 'Chicken Gizzard',
    unitsSold: 58,
    revenue: 8900,
    profit: 2200,
    currentStock: 0,
    trend: 'Decreasing',
    status: 'Out',
    movement: [18, 14, 12, 9, 5],
  },
  {
    product: 'Chicken Liver',
    unitsSold: 23,
    revenue: 3500,
    profit: 760,
    currentStock: 120,
    trend: 'Decreasing',
    status: 'Low Demand',
    movement: [12, 9, 6, 4, 3],
  },
]

export const productTrendLabels = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5']

export const productTrendSeries = [
  {
    name: 'Breast Fillet',
    product: 'Chicken Breast Fillet',
    color: '#38bdf8',
  },
  {
    name: 'Wings',
    product: 'Chicken Wings',
    color: '#f97316',
  },
  {
    name: 'Drumsticks',
    product: 'Chicken Drumsticks',
    color: '#22c55e',
  },
  {
    name: 'Whole Chicken',
    product: 'Regular Dressed Chicken',
    color: '#a78bfa',
  },
]
