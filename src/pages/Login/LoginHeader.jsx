import BrandMark from "../Shared/BrandMark.jsx";

function LoginHeader() {
  return (
    <section className="login-brand-panel" aria-label="LCP Dressed Chicken Trading">
      <div className="login-brand-lockup">
        <BrandMark />
        <div>
          <p className="login-kicker">LCP DRESSED CHICKEN TRADING</p>
          <span>LCP Management System</span>
        </div>
      </div>
      <div className="login-chicken-art" aria-hidden="true">
        <svg viewBox="0 0 360 330" role="presentation" focusable="false">
          <ellipse className="chicken-art-halo" cx="174" cy="181" rx="142" ry="120" />
          <ellipse className="chicken-art-ground" cx="176" cy="294" rx="102" ry="13" />
          <path className="chicken-tail" d="M99 232c-27-8-39-25-31-40 6-12 22-14 39-2-12-19-10-37 3-45 16-9 34 2 42 24l-1 54z" />
          <path className="chicken-silhouette" d="M103 250c-13-13-19-29-14-43 5-13 18-19 34-13-13-23-10-51 7-70 17-18 45-23 68-12 17 8 29 24 34 44 5-18 8-37 8-56 0-13 10-24 23-24 13 0 23 10 24 23l2 25 22 10-22 11c-3 15-15 25-30 24l-2 28c14 20 20 41 15 59-6 23-28 37-64 40-45 4-83-10-105-36z" />
          <path className="chicken-comb" d="M239 81c-8-13-1-26 10-28 8-2 14 3 17 10 5-11 18-12 24-4 5 7 3 15-3 21 10-4 19 2 19 11 0 8-8 13-20 12l-31-4z" />
          <path className="chicken-beak" d="m309 105 24 9-24 9-7-8z" />
          <path className="chicken-wing" d="M131 199c20-23 50-28 72-13 13 9 19 22 17 36-19-11-43-8-59 8-12-9-22-19-30-31z" />
          <circle className="chicken-eye" cx="286" cy="99" r="3.5" />
          <path className="chicken-wattle" d="M292 126c1 10-4 17-10 17-6-1-8-8-5-15z" />
          <path className="chicken-legs" d="M163 276v25m0 0-13 9m13-9 13 9m40-35v26m0 0-13 9m13-9 13 9" />
          <circle className="chicken-detail-dot" cx="74" cy="115" r="5" />
          <circle className="chicken-detail-dot" cx="286" cy="220" r="7" />
          <circle className="chicken-detail-dot" cx="111" cy="75" r="3" />
        </svg>
      </div>
    </section>
  );
}

export default LoginHeader;
