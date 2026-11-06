function SkeletonBlock({ className = "" }) {
  return <span className={`page-skeleton-block ${className}`} aria-hidden="true" />;
}

function SkeletonHeader({ action = false }) {
  return (
    <div className="page-skeleton-header" aria-hidden="true">
      <SkeletonBlock className="page-skeleton-header-icon" />
      <div className="page-skeleton-header-copy">
        <SkeletonBlock className="page-skeleton-line page-skeleton-title" />
        <SkeletonBlock className="page-skeleton-line page-skeleton-description" />
      </div>
      {action && <SkeletonBlock className="page-skeleton-button" />}
    </div>
  );
}

function SkeletonStats({ count = 4 }) {
  return (
    <div className="page-skeleton-stats" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="page-skeleton-stat" key={index}>
          <div className="page-skeleton-stat-heading">
            <SkeletonBlock className="page-skeleton-line page-skeleton-label" />
            <SkeletonBlock className="page-skeleton-icon" />
          </div>
          <SkeletonBlock className="page-skeleton-line page-skeleton-value" />
        </div>
      ))}
    </div>
  );
}

function SkeletonControls({ filters = 2, buttons = 1 }) {
  return (
    <div className="page-skeleton-controls" aria-hidden="true">
      {Array.from({ length: filters }, (_, index) => (
        <SkeletonBlock className="page-skeleton-input" key={`filter-${index}`} />
      ))}
      {Array.from({ length: buttons }, (_, index) => (
        <SkeletonBlock className="page-skeleton-button" key={`button-${index}`} />
      ))}
    </div>
  );
}

function SkeletonTable({ columns = 6, rows = 7 }) {
  return (
    <div className="page-skeleton-table-wrap" aria-hidden="true">
      <div className="page-skeleton-table" style={{ "--skeleton-columns": columns }}>
        <div className="page-skeleton-table-row page-skeleton-table-head">
          {Array.from({ length: columns }, (_, index) => (
            <SkeletonBlock className="page-skeleton-table-cell" key={index} />
          ))}
        </div>
        {Array.from({ length: rows }, (_, row) => (
          <div className="page-skeleton-table-row" key={row}>
            {Array.from({ length: columns }, (_, column) => (
              <SkeletonBlock
                className={`page-skeleton-table-cell page-skeleton-cell-${column % 4}`}
                key={column}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="page-skeleton-table-footer">
        <SkeletonBlock className="page-skeleton-line page-skeleton-footer-copy" />
        <div className="page-skeleton-pagination" aria-hidden="true">
          <SkeletonBlock className="page-skeleton-pagination-button" />
          <SkeletonBlock className="page-skeleton-pagination-current" />
          <SkeletonBlock className="page-skeleton-pagination-button" />
        </div>
      </div>
    </div>
  );
}

function SkeletonPanel({ className = "", children }) {
  return <section className={`page-skeleton-panel ${className}`}>{children}</section>;
}

function SkeletonChart({ className = "" }) {
  return (
    <SkeletonPanel className={`page-skeleton-chart-panel ${className}`}>
      <div className="page-skeleton-panel-heading" aria-hidden="true">
        <SkeletonBlock className="page-skeleton-line page-skeleton-panel-title" />
        <SkeletonBlock className="page-skeleton-line page-skeleton-panel-subtitle" />
      </div>
      <SkeletonChartBody />
    </SkeletonPanel>
  );
}

function SkeletonChartBody() {
  return (
    <div className="page-skeleton-chart" aria-hidden="true">
      <div className="page-skeleton-chart-grid" />
      <SkeletonBlock className="page-skeleton-chart-line" />
      <div className="page-skeleton-chart-axis">
        {Array.from({ length: 5 }, (_, index) => (
          <SkeletonBlock className="page-skeleton-axis-label" key={index} />
        ))}
      </div>
    </div>
  );
}

function SkeletonForm({ fields = 3, buttons = 1 }) {
  return (
    <SkeletonPanel className="page-skeleton-form">
      <SkeletonBlock className="page-skeleton-line page-skeleton-panel-title" />
      {Array.from({ length: fields }, (_, index) => (
        <div className="page-skeleton-form-field" key={index}>
          <SkeletonBlock className="page-skeleton-line page-skeleton-label" />
          <SkeletonBlock className="page-skeleton-input" />
        </div>
      ))}
      {Array.from({ length: buttons }, (_, index) => (
        <SkeletonBlock className="page-skeleton-button" key={`submit-${index}`} />
      ))}
    </SkeletonPanel>
  );
}

function SkeletonList({ rows = 5 }) {
  return (
    <SkeletonPanel className="page-skeleton-list">
      <div className="page-skeleton-panel-heading" aria-hidden="true">
        <SkeletonBlock className="page-skeleton-line page-skeleton-panel-title" />
      </div>
      <div className="page-skeleton-list-rows" aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div className="page-skeleton-list-row" key={index}>
            <SkeletonBlock className="page-skeleton-icon" />
            <SkeletonBlock className="page-skeleton-line page-skeleton-list-copy" />
            <SkeletonBlock className="page-skeleton-line page-skeleton-list-value" />
          </div>
        ))}
      </div>
    </SkeletonPanel>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <SkeletonHeader />
      <SkeletonStats />
      <div className="page-skeleton-grid page-skeleton-dashboard-primary">
        <SkeletonChart />
        <SkeletonList rows={5} />
      </div>
      <div className="page-skeleton-grid page-skeleton-two-column">
        <SkeletonList rows={4} />
        <SkeletonList rows={4} />
      </div>
      <div className="page-skeleton-grid page-skeleton-two-column">
        <SkeletonList rows={4} />
        <SkeletonList rows={4} />
      </div>
    </>
  );
}

function AnalyticsSkeleton() {
  return (
    <>
      <SkeletonHeader />
      <SkeletonStats />
      <div className="page-skeleton-grid page-skeleton-dashboard-primary">
        <SkeletonChart />
        <SkeletonList rows={5} />
      </div>
      <div className="page-skeleton-grid page-skeleton-two-column">
        <SkeletonList rows={5} />
        <SkeletonList rows={5} />
      </div>
      <SkeletonPanel className="page-skeleton-insights">
        <SkeletonBlock className="page-skeleton-line page-skeleton-panel-title" />
        <SkeletonBlock className="page-skeleton-line page-skeleton-description" />
        <SkeletonBlock className="page-skeleton-line page-skeleton-description" />
      </SkeletonPanel>
    </>
  );
}

function SalesEntrySkeleton() {
  return <SkeletonTable columns={5} rows={8} />;
}

function InventoryProductsSkeleton() {
  return (
    <div className="page-skeleton-stack">
      <SkeletonControls filters={3} buttons={0} />
      <SkeletonTable columns={7} />
    </div>
  );
}

function InventoryOptionsSkeleton() {
  return (
    <div className="page-skeleton-inventory-options" aria-hidden="true">
      {[0, 1].map((index) => (
        <div className="page-skeleton-form-field" key={index}>
          <SkeletonBlock className="page-skeleton-line page-skeleton-label" />
          <SkeletonBlock className="page-skeleton-input" />
        </div>
      ))}
    </div>
  );
}

function CustomerCreditsSkeleton() {
  return (
    <div className="page-skeleton-grid page-skeleton-two-column">
      <SkeletonPanel>
        <SkeletonControls filters={1} buttons={0} />
        <SkeletonList rows={7} />
      </SkeletonPanel>
      <div className="page-skeleton-stack">
        <SkeletonPanel>
          <SkeletonBlock className="page-skeleton-line page-skeleton-panel-title" />
          <SkeletonList rows={3} />
        </SkeletonPanel>
        <SkeletonForm fields={3} />
      </div>
    </div>
  );
}

function SupplierDirectorySkeleton() {
  return (
    <div className="page-skeleton-supplier-grid" aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => (
        <SkeletonPanel className="page-skeleton-supplier-card" key={index}>
          <SkeletonBlock className="page-skeleton-line page-skeleton-product-title" />
          <SkeletonBlock className="page-skeleton-line page-skeleton-description" />
          <SkeletonBlock className="page-skeleton-line page-skeleton-description" />
        </SkeletonPanel>
      ))}
    </div>
  );
}

function CustomerLedgerSkeleton() {
  return (
    <div className="page-skeleton-grid page-skeleton-two-column">
      <SkeletonForm fields={3} />
      <SkeletonList rows={5} />
    </div>
  );
}

function SupplierLedgerSkeleton() {
  return (
    <>
      <SkeletonControls filters={1} buttons={0} />
      <SkeletonTable columns={6} rows={6} />
    </>
  );
}

function ReportSkeleton({ variant }) {
  return (
    variant === "report-receivables" ? (
      <>
        <SkeletonStats count={2} />
        <div className="page-skeleton-grid page-skeleton-receivables">
          <SkeletonPanel>
            <SkeletonBlock className="page-skeleton-line page-skeleton-panel-title" />
            <SkeletonControls filters={1} buttons={0} />
            <SkeletonTable columns={7} rows={7} />
          </SkeletonPanel>
          <SkeletonForm fields={2} buttons={2} />
        </div>
      </>
    ) : variant === "report-inventory" ? (
      <>
        <SkeletonStats count={5} />
        <div className="page-skeleton-grid page-skeleton-report-inventory">
          <SkeletonPanel>
            <SkeletonBlock className="page-skeleton-line page-skeleton-panel-title" />
            <SkeletonTable columns={6} rows={6} />
          </SkeletonPanel>
          <SkeletonChart />
        </div>
      </>
    ) : (
      <>
        <SkeletonStats count={4} />
        <div className="page-skeleton-grid page-skeleton-report-sales">
          <SkeletonPanel>
            <SkeletonBlock className="page-skeleton-line page-skeleton-panel-title" />
            <SkeletonControls filters={2} buttons={0} />
            <SkeletonTable columns={7} rows={7} />
          </SkeletonPanel>
          <SkeletonForm fields={4} />
        </div>
      </>
    )
  );
}

function ActivitySkeleton() {
  return (
    <>
      <SkeletonHeader />
      <SkeletonControls filters={3} buttons={1} />
      <SkeletonPanel><SkeletonTable columns={5} rows={8} /></SkeletonPanel>
    </>
  );
}

function UserAccountsSkeleton() {
  return (
    <>
      <SkeletonHeader action />
      <SkeletonStats count={3} />
      <SkeletonPanel>
        <SkeletonControls filters={2} buttons={0} />
        <SkeletonTable columns={5} rows={7} />
      </SkeletonPanel>
    </>
  );
}

function AuthenticationSkeleton() {
  return (
    <div className="page-skeleton-auth-card">
      <SkeletonBlock className="page-skeleton-auth-logo" />
      <SkeletonBlock className="page-skeleton-line page-skeleton-auth-title" />
      <SkeletonBlock className="page-skeleton-line page-skeleton-auth-description" />
      <div className="page-skeleton-form-field">
        <SkeletonBlock className="page-skeleton-line page-skeleton-label" />
        <SkeletonBlock className="page-skeleton-input" />
      </div>
      <div className="page-skeleton-form-field">
        <SkeletonBlock className="page-skeleton-line page-skeleton-label" />
        <SkeletonBlock className="page-skeleton-input" />
      </div>
      <SkeletonBlock className="page-skeleton-button" />
    </div>
  );
}

const skeletons = {
  dashboard: DashboardSkeleton,
  analytics: AnalyticsSkeleton,
  "record-sales-catalog": SalesEntrySkeleton,
  "inventory-stats": () => <SkeletonStats count={3} />,
  "customer-credit-stats": () => <SkeletonStats count={3} />,
  "inventory-products": InventoryProductsSkeleton,
  "inventory-form": InventoryOptionsSkeleton,
  "inventory-inflow": () => <SkeletonTable columns={6} rows={7} />,
  "customer-credits": CustomerCreditsSkeleton,
  "customer-ledger": CustomerLedgerSkeleton,
  "supplier-directory": SupplierDirectorySkeleton,
  "supplier-chart": SkeletonChartBody,
  "supplier-ledger": SupplierLedgerSkeleton,
  "report-sales": ReportSkeleton,
  "report-inventory": ReportSkeleton,
  "report-receivables": ReportSkeleton,
  activity: ActivitySkeleton,
  users: UserAccountsSkeleton,
  authentication: AuthenticationSkeleton,
};

function PageSkeleton({ variant, label = "page" }) {
  const Skeleton = skeletons[variant];

  if (!Skeleton) {
    throw new Error(`Unknown page skeleton variant: ${variant}`);
  }

  return (
    <div
      className={`page-skeleton page-skeleton-${variant}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="page-skeleton-sr-only">Loading {label}</span>
      <div className="page-skeleton-content" aria-hidden="true">
        <Skeleton variant={variant} />
      </div>
    </div>
  );
}

export default PageSkeleton;
