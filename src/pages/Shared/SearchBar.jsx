import { Search } from 'lucide-react'

function SearchBar({ className = '', placeholder, value, onChange }) {
  return (
    <label className={`search-field ${className}`}>
      <Search size={16} aria-hidden="true" />
      <input placeholder={placeholder} value={value} onChange={onChange} />
    </label>
  )
}

export default SearchBar
