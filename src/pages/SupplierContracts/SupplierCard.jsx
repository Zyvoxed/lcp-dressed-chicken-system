import { Archive, Building2, MapPin, PackageCheck, Pencil, Phone, RotateCcw, User, Wallet } from 'lucide-react'
import { peso } from '../../utils/currency.js'
import { formatQuantityWithUnit, sumQuantitiesByUnit } from '../../utils/unitAwareMetrics.js'

function SupplierCard({ supplier, records = [], archived = false, isAdmin = false, onEdit, onArchive, onRestore }) {
  const totalSpend = records.reduce((sum, record) => sum + Number(record.total_cost || 0), 0)
  const quantitiesByUnit = sumQuantitiesByUnit(records, (record) => record.quantity_received)
  const quantitySummary = quantitiesByUnit.map(({ unit, quantity }) => formatQuantityWithUnit(quantity, unit, 1)).join(' · ')

  return (
    <article className={`supplier-card${archived ? ' is-archived' : ''}`}>
      <header className="supplier-card-header">
        <div className="supplier-card-id-row">
          <span className="supplier-id-badge">SUP-{supplier.supplier_id}</span>
          <span className={`supplier-status-pill ${archived ? 'archived' : 'active'}`}>
            <span className="status-indicator-dot" />
            {archived ? 'Archived' : 'Active Partner'}
          </span>
        </div>
        <div className="supplier-card-title-row">
          <div className="supplier-avatar-icon">
            <Building2 size={17} aria-hidden="true" />
          </div>
          <h3 title={supplier.supplier_name}>{supplier.supplier_name}</h3>
        </div>
      </header>

      <div className="supplier-card-contacts">
        <div className="supplier-contact-item">
          <User size={13} className="contact-icon" aria-hidden="true" />
          <div className="contact-info">
            <span className="contact-label">Contact Person</span>
            <strong className="contact-value">{supplier.contact_person || 'Not specified'}</strong>
          </div>
        </div>

        <div className="supplier-contact-item">
          <Phone size={13} className="contact-icon" aria-hidden="true" />
          <div className="contact-info">
            <span className="contact-label">Phone Number</span>
            <strong className="contact-value">{supplier.contact_number || 'Not specified'}</strong>
          </div>
        </div>

        <div className="supplier-contact-item full-width">
          <MapPin size={13} className="contact-icon" aria-hidden="true" />
          <div className="contact-info">
            <span className="contact-label">Facility / Address</span>
            <strong className="contact-value address-text">{supplier.address || 'No address provided'}</strong>
          </div>
        </div>
      </div>

      <div className="supplier-card-stats-grid">
        <div className="supplier-stat-card">
          <div className="stat-label-wrap">
            <PackageCheck size={13} aria-hidden="true" />
            <span>Deliveries</span>
          </div>
          <strong className="stat-number">{records.length.toLocaleString('en-PH')}</strong>
          <small className="stat-sub">
            {quantitySummary || 'No quantity received yet'}
          </small>
        </div>

        <div className="supplier-stat-card">
          <div className="stat-label-wrap">
            <Wallet size={13} aria-hidden="true" />
            <span>Total Spend</span>
          </div>
          <strong className="stat-number spend-value">{peso.format(totalSpend)}</strong>
          <small className="stat-sub">Confirmed costs</small>
        </div>
      </div>

      {isAdmin && (
        <footer className="supplier-card-footer">
          {archived ? (
            <button
              className="secondary-action slim supplier-action-btn"
              type="button"
              onClick={() => onRestore(supplier)}
            >
              <RotateCcw size={13} aria-hidden="true" />
              <span>Restore Supplier</span>
            </button>
          ) : (
            <>
              <button
                className="secondary-action slim supplier-action-btn"
                type="button"
                onClick={() => onEdit(supplier)}
              >
                <Pencil size={13} aria-hidden="true" />
                <span>Edit Supplier</span>
              </button>
              <button
                className="secondary-action slim supplier-action-btn danger"
                type="button"
                onClick={() => onArchive(supplier)}
              >
                <Archive size={13} aria-hidden="true" />
                <span>Archive Supplier</span>
              </button>
            </>
          )}
        </footer>
      )}
    </article>
  )
}

export default SupplierCard
