import { products } from '../../data/products.js'

function RestockChecklist() {
  return (
    <article className="panel restock-panel">
      <h2>RESTOCK CHECKLIST REQUIREMENTS</h2>
      {products
        .filter((product) => product[4] !== 'Ready')
        .map(([name, , stock]) => (
          <div className="restock-row" key={name}>
            <div>
              <strong>{name}</strong>
              <p>Stock Level: {stock} kg</p>
            </div>
            <button type="button">RESTOCK</button>
          </div>
        ))}
    </article>
  )
}

export default RestockChecklist
