import { productCategories } from '../../utils/constants.js'

function CategoryFilter({ category, onCategory }) {
  return (
    <div className="pill-row" role="group" aria-label="Product categories">
      {productCategories.map((item) => (
        <button
          key={item}
          className={category === item ? 'selected' : ''}
          type="button"
          aria-pressed={category === item}
          onClick={() => onCategory(item)}
        >
          {item}
        </button>
      ))}
    </div>
  )
}

export default CategoryFilter
