import { quantity } from './currency.js'

export function formatTopSellersByUnit(products) {
  return products
    .map((product) => `${product.product_name} (${quantity.format(Number(product.quantity_sold))} ${product.unit})`)
    .join(' · ')
}
