import { productCategories } from '../../utils/constants.js'

function CategoryFilter({ category, onCategory }) {
  return (
    <div className="pill-row">
      {productCategories.map((item) => (
        <button
          key={item}
          className={category === item ? 'selected' : ''}
          type="button"
          onClick={() => onCategory(item)}
        >
          {item}
        </button>
      ))}
    </div>
  )
}

export default CategoryFilter
