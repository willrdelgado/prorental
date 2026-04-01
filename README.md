# ProRental — Real Estate Investment Calculator

A professional-grade rental property analysis tool with live market data. Analyze cash flow, run BRRRR strategy models, evaluate hard money deals, and compare financing options — all backed by live Zillow data via RealtyAPI.

![ProRental Dashboard](https://img.shields.io/badge/status-active-brightgreen) ![Node](https://img.shields.io/badge/node-%3E%3D18-blue) ![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

- **Live Market Data** — Pulls Zestimate, rent estimates, sale comps, rental comps, and market stats from RealtyAPI (Zillow data)
- **4 Financing Types** — All Cash, Conventional, Hard Money, Portfolio loans
- **Correct Hard Money Math** — Loan based on ARV (up to 90%), covers purchase + rehab, interest-only carry
- **BRRRR Strategy** — Full Buy-Rehab-Rent-Refi-Repeat model with cash recovery %, refi DSCR, equity tracking
- **BRRRR Scoring** — Hard-fails on negative post-refi cash flow; equity pull-out alone does NOT make a good BRRRR
- **Multifamily Support** — 1–20 units with per-unit rent tracking (SFH, duplex, triplex, quad, 5–20 unit)
- **Investment Score** — Weighted 0–100 score with deal/negotiate/pass recommendation
- **5-Year Projection** — Cash flow, appreciation, and total return modeling
- **Market Conditions** — Hot / Moderate / Cool / Custom presets affecting vacancy, DOM, appreciation
- **Buy Price Strategy** — Deal / Market / Custom offer zones with max-offer-for-cash-flow calculator
- **Key Metrics** — Cap Rate, CoC Return, GRM, DSCR, 1% Rule, Price/SqFt, Break-Even Rent

---

## Quick Start

### Prerequisites
- Node.js 18+
- A [RealtyAPI.io](https://realtyapi.io) API key (free tier: 250 req/month)

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/prorental.git
cd prorental

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and add your REALTYAPI_KEY

# 4. Start development server (auto-reloads on save)
npm run dev

# 5. Open in browser
open http://localhost:3000
```

---

## How It Works

The app is a Node.js/Express server that:

1. Serves the single-page frontend from `public/index.html`
2. Exposes `/api/config` — returns the API key to the browser (keeps it out of client source)
3. The **browser** calls RealtyAPI directly (6 parallel requests) — avoids server-side latency

```
Browser → GET /api/config → { key }
Browser → zillow.realtyapi.io (6 parallel calls):
  ├─ /pro/byaddress          → property details, Zestimate, tax history
  ├─ /search/byaddress?Sold  → sale comps
  ├─ /search/byaddress?Rent  → rental comps
  ├─ /housing_market         → median prices, DOM, sale-to-list ratio
  ├─ /rental_market          → rental market trends
  └─ /similar                → similar properties (comp fallback)
```

---

## Project Structure

```
prorental/
├── server.js          # Express server — serves static files + exposes API key
├── public/
│   └── index.html     # Full SPA — all UI, calculations, and API calls
├── .env               # Your secrets (not committed)
├── .env.example       # Template for environment setup
├── package.json
└── README.md
```

---

## Configuration

| Variable | Required | Description |
|---|---|---|
| `REALTYAPI_KEY` | Yes | Your RealtyAPI.io key |
| `PORT` | No | Server port (default: `3000`) |

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Development server with auto-reload (`node --watch`) |
| `npm start` | Production server |

---

## Calculation Reference

### Cash Flow
```
Gross Rent
− Vacancy Loss (% of gross)
= Effective Gross Income (EGI)
− Operating Expenses (tax, insurance, mgmt %, maintenance %)
= Net Operating Income (NOI)
− Debt Service (P&I or interest-only)
= Monthly Cash Flow
```

### Hard Money (ARV-Based)
```
HM Loan     = ARV × LTV%  (max 90%)
Total Proj  = Purchase + Rehab
Cash OOP    = max(0, Total Project − HM Loan) + Points
Monthly I/O = HM Loan × Rate / 12
```

### BRRRR Score (0–100)
| Component | Weight | Notes |
|---|---|---|
| Post-refi cash flow | 35 pts | Hard-capped at 35 if CF ≤ 0 |
| Cash recovery % | 30 pts | cashBack ÷ origCash |
| Refi DSCR | 20 pts | NOI ÷ refi P&I |
| Equity at refi | 15 pts | ARV − refi loan |

> **Important:** Negative post-refi cash flow caps the total score at 35/100 regardless of equity pull. A deal that bleeds cash is not a good BRRRR.

### Key Metrics
| Metric | Formula |
|---|---|
| Cap Rate | Annual NOI ÷ Purchase Price |
| Cash-on-Cash | Annual CF ÷ Total Cash Invested |
| GRM | Purchase Price ÷ (Monthly Rent × 12) |
| DSCR | Monthly NOI ÷ Monthly Debt Service |
| 1% Rule | Monthly Rent ÷ Purchase Price |

---

## License

MIT — see [LICENSE](LICENSE) for details.
