import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;
const KEY  = process.env.REALTYAPI_KEY || '';
const BASE = 'https://zillow.realtyapi.io';

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ─── Core fetch helper ────────────────────────────────────────────────────────
async function rapi(path, params = {}) {
  if (!KEY) throw new Error('REALTYAPI_KEY not set in .env');
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)));
  console.log('[RealtyAPI →]', url.toString());
  const res = await fetch(url.toString(), {
    headers: { 'x-realtyapi-key': KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  const data = await res.json();
  console.log('[RealtyAPI ←]', path, JSON.stringify(data).slice(0, 200));
  if (data?.error && !data?.zpid && !data?.address) {
    throw new Error(`RealtyAPI: ${data.error} (path: ${path})`);
  }
  return data;
}

function wrap(fn) {
  return async (req, res) => {
    try {
      res.json({ ok: true, data: await fn(req) });
    } catch (err) {
      console.error('[ERROR]', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  };
}

// ─── Config endpoint — browser uses this to get the key, then calls API directly ─
app.get('/api/config', (req, res) => {
  res.json({ key: KEY, hasKey: !!KEY });
});

// ─── API key status ───────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => res.json({ realtyapi: !!KEY }));

// ─── Combined property lookup ─────────────────────────────────────────────────
// Fires 6 calls in parallel. Uses confirmed working RealtyAPI endpoints.
app.get('/api/lookup', wrap(async (req) => {
  const { address } = req.query;
  if (!address) throw new Error('address required');

  // All parallel — use correct param names
  const [propR, similarR, rentR, mktR, rentalMktR, taxR, priceR] = await Promise.allSettled([
    // 1. Full property details (zestimate lives here)
    rapi('/pro/byaddress', { propertyaddress: address }),
    // 2. Similar/sold homes = sale comps
    rapi('/similar', { byaddress: address }),
    // 3. Rental listings nearby = rental comps
    rapi('/search/byaddress', { location: address, status: 'ForRent' }),
    // 4. Housing market stats (use city/state extracted from address, or ZIP)
    rapi('/housing_market', { search_query: address }),
    // 5. Rental market stats
    rapi('/rental_market', { search_query: address }),
    // 6. Tax / county records
    rapi('/taxinfo', { byaddress: address }),
    // 7. Price history
    rapi('/pricehistory', { byaddress: address }),
  ]);

  const ok  = r => r.status === 'fulfilled' ? r.value  : null;
  const err = r => r.status === 'rejected'  ? r.reason.message : null;

  const prop      = ok(propR);
  const similar   = ok(similarR);
  const rentList  = ok(rentR);
  const mkt       = ok(mktR);
  const rentalMkt = ok(rentalMktR);
  const tax       = ok(taxR);
  const price     = ok(priceR);

  // ── Property + zestimate
  // /pro/byaddress returns a rich object; key fields vary but commonly include:
  // zpid, address, bedrooms, bathrooms, livingArea, yearBuilt, price,
  // zestimate, rentZestimate, taxHistory, homeType, lastSoldPrice, lastSoldDate
  const property = prop ? {
    address:       prop.address   ?? address,
    city:          prop.city,
    state:         prop.state,
    zip:           prop.zipcode   ?? prop.zip,
    beds:          prop.bedrooms  ?? prop.beds,
    baths:         prop.bathrooms ?? prop.baths,
    sqft:          prop.livingArea ?? prop.sqft,
    yearBuilt:     prop.yearBuilt,
    propertyType:  prop.homeType  ?? prop.propertyType,
    lotSize:       prop.lotAreaValue ?? prop.lotSize,
    zpid:          prop.zpid,
    zillowUrl:     prop.hdpUrl    ?? prop.url,
    lastSoldPrice: prop.lastSoldPrice ?? prop.price,
    lastSoldDate:  prop.lastSoldDate,
    _raw: prop,
  } : null;

  // Zestimate — lives inside /pro/byaddress response
  const zestimate = prop ? {
    value: prop.zestimate ?? prop.zestimateLow ?? null,
    low:   prop.zestimateLow  ?? null,
    high:  prop.zestimateHigh ?? null,
    rent:  prop.rentZestimate ?? null,
  } : null;

  // Rent estimate — from rental market OR rent zestimate in property
  const rentEstimate = {
    estimated: prop?.rentZestimate ?? rentalMkt?.averageRent ?? null,
    low:       rentalMkt?.rentRangeLow ?? null,
    high:      rentalMkt?.rentRangeHigh ?? null,
  };

  // ── Sale comps — from /similar
  // similar returns array or { results: [] }
  const saleArr = Array.isArray(similar) ? similar
    : (similar?.results ?? similar?.comps ?? similar?.homes ?? []);
  const saleComps = {
    comps: saleArr.slice(0, 10).map(c => ({
      address:      c.address ?? c.streetAddress,
      beds:         c.bedrooms ?? c.beds,
      baths:        c.bathrooms ?? c.baths,
      sqft:         c.livingArea ?? c.sqft,
      price:        c.price ?? c.soldPrice ?? c.unformattedPrice,
      soldDate:     c.dateSold ?? c.soldDate ?? c.lastSoldDate,
      daysOnMarket: c.daysOnMarket ?? c.dom,
      distance:     c.distance,
      pricePerSqft: c.pricePerSqft ?? (c.livingArea && c.price
                      ? Math.round(c.price / c.livingArea) : null),
    })),
  };

  // ── Rental comps — from /search/byaddress?status=ForRent
  const rentArr = Array.isArray(rentList) ? rentList
    : (rentList?.results ?? rentList?.listings ?? rentList?.homes ?? []);
  const rentComps = {
    comps: rentArr.slice(0, 10).map(c => ({
      address:      c.address ?? c.streetAddress,
      beds:         c.bedrooms ?? c.beds,
      baths:        c.bathrooms ?? c.baths,
      sqft:         c.livingArea ?? c.sqft,
      rent:         c.price ?? c.unformattedPrice ?? c.rentPrice,
      daysOnMarket: c.daysOnMarket ?? c.dom,
      status:       c.listingStatus ?? c.status ?? 'Active',
      distance:     c.distance,
    })),
  };

  // ── Market stats — combine housing_market + rental_market
  const market = (mkt || rentalMkt) ? {
    avgPrice:      mkt?.averageListPrice ?? mkt?.medianListPrice,
    medianPrice:   mkt?.medianListPrice,
    avgPsf:        mkt?.averagePricePerSqFt,
    avgDom:        mkt?.averageDaysOnMarket ?? mkt?.medianDaysOnMarket,
    medianDom:     mkt?.medianDaysOnMarket,
    avgRent:       rentalMkt?.averageRent ?? rentalMkt?.medianRent,
    medianRent:    rentalMkt?.medianRent,
    totalListings: mkt?.totalListings,
    _rawMkt:    mkt,
    _rawRental: rentalMkt,
  } : null;

  // ── Tax / county records
  // /taxinfo returns array of yearly records or single object
  const taxArr = Array.isArray(tax) ? tax : (tax?.taxHistory ?? [tax]).filter(Boolean);
  const taxHistory = taxArr.length ? {
    records: taxArr.slice(0, 5).map(t => ({
      year:          t.taxYear ?? t.year,
      amount:        t.taxPaid ?? t.taxAmount ?? t.amount,
      assessedValue: t.assessedValue ?? t.value,
    })),
  } : null;

  // ── Price history (for last sold price / county records display)
  const priceArr = Array.isArray(price) ? price : (price?.priceHistory ?? []);
  const lastSale = priceArr.find(p => p.event === 'Sold' || p.type === 'Sold');

  return {
    property,
    zestimate,
    rentEstimate,
    saleComps,
    rentComps,
    market,
    taxHistory,
    lastSale: lastSale ? {
      price: lastSale.price ?? lastSale.soldPrice,
      date:  lastSale.date  ?? lastSale.soldDate,
    } : null,
    errors: {
      property:   err(propR),
      similar:    err(similarR),
      rent:       err(rentR),
      market:     err(mktR),
      rentalMkt:  err(rentalMktR),
      tax:        err(taxR),
      price:      err(priceR),
    },
  };
}));

// ─── Debug probe: GET /api/probe?path=/byaddress&propertyaddress=... ──────────
app.get('/api/probe', wrap(async (req) => {
  const { path: p = '/autocomplete', ...params } = req.query;
  return await rapi(p, params);
}));

app.get('*', (req, res) => res.sendFile(join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n🏠 ProRental running at http://localhost:${PORT}`);
  console.log(`   RealtyAPI: ${KEY ? '✓ key loaded' : '✗ missing REALTYAPI_KEY'}\n`);
});
