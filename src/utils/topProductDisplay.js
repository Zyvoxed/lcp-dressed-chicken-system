export function formatTopSellerNames(products) {
  return products.map((product) => product.product_name).join(' · ')
}
