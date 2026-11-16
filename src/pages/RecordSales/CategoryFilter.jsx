import { productCategories } from '../../utils/constants.js'

function CategoryFilter({ category, onCategory, counts }) {
  return (
    <div className="pos-category-row pill-row" role="group" aria-label="Product categories">
      {productCategories.map((item) => {
        const count = counts ? counts[item] ?? 0 : null
        const isSelected = category === item
        return (
          <button
            key={item}
            className={`pos-category-pill ${isSelected ? 'selected' : ''}`}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onCategory(item)}
          >
            <span>{item}</span>
            {count !== null && (
              <span className="category-pill-count">
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default CategoryFilter
