import { useState, useMemo, useCallback } from "react";

// ─── COST MATRIX (from Excel) ───
const COST_BUCKETS = [
  "Origin Haulage","Origin Handling","Export Customs Clearance","Export Documentation",
  "Port Terminal Charges (Origin)","Ocean Freight","Marine Insurance","Import Customs Clearance",
  "Import Duty","Import Tariff","Destination Port Charges","Destination Inland Haulage",
  "Destination Handling","Last Mile Delivery","Warehouse Handling","Storage (per period)",
  "Inventory Carrying Cost","Pallet / Packaging","Border Charges","Brokerage / Agency",
  "Inspection / Certification","Miscellaneous Logistics Cost"
];

const INCOTERMS = ["EXW","FCA","FOB","CIF","DAP","DDP","VMI"];

// BUY matrix: True = cost NOT included in buy price (trader must handle)
const BUY_MATRIX = {
  EXW:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  FCA:[1,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  FOB:[0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  CIF:[0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  DAP:[0,0,0,0,0,0,0,0,1,1,0,0,0,0,1,1,1,1,1,1,1,1],
  DDP:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1],
  VMI:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
};

// SELL matrix: True = cost included in sell price (trader must deliver)
const SELL_MATRIX = {
  EXW:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  FCA:[0,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  FOB:[1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  CIF:[1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  DAP:[1,1,1,1,1,1,1,1,0,0,1,1,1,1,0,0,0,0,0,0,0,0],
  DDP:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0],
  VMI:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
};

// ─── FINANCING DEFAULTS ───
const FINANCING_TYPES = [
  { id:"own_equity", name:"Own Equity", advanceRate:0, margin:0.12, usesSalePrice:false, isClean:true },
  { id:"prepayment", name:"Prepayment Finance", advanceRate:0.80, margin:0.0367, usesSalePrice:false, isClean:false },
  { id:"futures", name:"Futures Financing", advanceRate:0, margin:0.03, usesSalePrice:false, isClean:false },
  { id:"supply_copy", name:"Supply Finance (Copy Doc)", advanceRate:0.80, margin:0.0226, usesSalePrice:false, isClean:false },
  { id:"supply_bl", name:"Supply Finance (BL)", advanceRate:0.85, margin:0.0219, usesSalePrice:false, isClean:false },
  { id:"stock_other", name:"Stock Finance Origin Other", advanceRate:0.85, margin:0.0176, usesSalePrice:false, isClean:false },
  { id:"stock_brazil", name:"Stock Finance Origin Brazil", advanceRate:0.80, margin:0.0247, usesSalePrice:false, isClean:false },
  { id:"stock_dest", name:"Stock Finance Destination", advanceRate:0.85, margin:0.0234, usesSalePrice:false, isClean:false },
  { id:"receivable", name:"Receivable Finance", advanceRate:0.90, margin:0.0228, usesSalePrice:true, isClean:false },
  { id:"credit_insured", name:"Credit-insured Receivable", advanceRate:0.95, margin:0.0178, usesSalePrice:true, isClean:false },
];

const DEFAULT_COF = 0.0416;
const EQUITY_RATE = 0.12;

const toClb = (usdMt) => (usdMt / 22.0462 * 100);

// ─── STYLES ───
const COLORS = {
  bg: "#0a0f1a",
  surface: "#111827",
  surfaceAlt: "#1a2234",
  border: "#1e2d44",
  borderLight: "#2a3a54",
  accent: "#c9a55a",
  accentDim: "rgba(201,165,90,0.15)",
  accentText: "#e8d5a0",
  text: "#e2e8f0",
  textDim: "#8494a7",
  textMuted: "#5a6a7e",
  green: "#4ade80",
  greenDim: "rgba(74,222,128,0.12)",
  red: "#f87171",
  redDim: "rgba(248,113,113,0.12)",
  blue: "#60a5fa",
  blueDim: "rgba(96,165,250,0.1)",
};

const fontStack = "'DM Sans', 'Segoe UI', sans-serif";

function App() {
  // ─── STATE ───
  const [activeTab, setActiveTab] = useState(0);

  // Trade setup
  const [trade, setTrade] = useState({
    name: "", commodity: "Sugar", origin: "", destination: "",
    volume: 500, purchasePrice: 470, salePrice: 535, currency: "USD"
  });

  // Incoterms
  const [buyInco, setBuyInco] = useState("EXW");
  const [sellInco, setSellInco] = useState("CIF");

  // Cost buckets
  const [costInputs, setCostInputs] = useState(() => {
    const m = {};
    COST_BUCKETS.forEach(b => { m[b] = { value: 0, enabled: true, note: "" }; });
    return m;
  });

  // Financing stages
  const [stages, setStages] = useState([
    { typeId: "supply_bl", days: 25, advanceRate: null, margin: null, cof: null },
    { typeId: "stock_dest", days: 15, advanceRate: null, margin: null, cof: null },
    { typeId: "receivable", days: 20, advanceRate: null, margin: null, cof: null },
  ]);

  const [bankCOF, setBankCOF] = useState(DEFAULT_COF);

  // ─── DERIVED: Active cost buckets ───
  const activeBuckets = useMemo(() => {
    const buyCol = BUY_MATRIX[buyInco];
    const sellCol = SELL_MATRIX[sellInco];
    return COST_BUCKETS.map((b, i) => ({
      name: b,
      active: buyCol[i] === 1 && sellCol[i] === 1
    }));
  }, [buyInco, sellInco]);

  // ─── DERIVED: Logistics totals ───
  const logisticsTotal = useMemo(() => {
    return activeBuckets.reduce((sum, b) => {
      if (b.active && costInputs[b.name]?.enabled) {
        return sum + (parseFloat(costInputs[b.name]?.value) || 0);
      }
      return sum;
    }, 0);
  }, [activeBuckets, costInputs]);

  // ─── DERIVED: Financing calculations ───
  const finCalcs = useMemo(() => {
    const results = stages.map(s => {
      const ft = FINANCING_TYPES.find(f => f.id === s.typeId);
      if (!ft) return null;
      const ar = s.advanceRate !== null ? s.advanceRate : ft.advanceRate;
      const mg = s.margin !== null ? s.margin : ft.margin;
      const cof = s.cof !== null ? s.cof : bankCOF;
      const base = ft.usesSalePrice
        ? trade.volume * trade.salePrice
        : trade.volume * trade.purchasePrice;
      const bankLoan = base * ar;
      const equity = base * (1 - ar);
      const allInRate = ft.isClean ? EQUITY_RATE : mg + cof;
      const bankInterest = bankLoan * allInRate * s.days / 360;
      const equityCost = equity * EQUITY_RATE * s.days / 360;
      const totalCost = bankInterest + equityCost;
      const annPct = base > 0 && s.days > 0 ? totalCost / base / s.days * 360 : 0;
      return { ...s, ft, ar, mg, cof, base, bankLoan, equity, allInRate, bankInterest, equityCost, totalCost, annPct, days: s.days };
    }).filter(Boolean);

    const totalDays = results.reduce((s, r) => s + r.days, 0);
    const totalCost = results.reduce((s, r) => s + r.totalCost, 0);
    const totalBankOnly = results.reduce((s, r) => s + r.bankInterest, 0);
    const avgEquityPct = totalDays > 0
      ? results.reduce((s, r) => s + r.days * (1 - r.ar), 0) / totalDays : 0;
    const avgEquity = totalDays > 0
      ? results.reduce((s, r) => s + r.days * r.equity, 0) / totalDays : 0;
    const costPerMt = trade.volume > 0 ? totalCost / trade.volume : 0;

    return { results, totalDays, totalCost, totalBankOnly, avgEquityPct, avgEquity, costPerMt };
  }, [stages, trade, bankCOF]);

  // ─── DERIVED: Trade economics ───
  const economics = useMemo(() => {
    const commodityCost = trade.purchasePrice;
    const logCost = logisticsTotal;
    const finCost = finCalcs.costPerMt;
    const totalCost = commodityCost + logCost + finCost;
    const margin = trade.salePrice - totalCost;
    const marginPct = trade.salePrice > 0 ? margin / trade.salePrice * 100 : 0;
    const totalProfit = margin * trade.volume;
    const roe = finCalcs.avgEquity > 0 && finCalcs.totalDays > 0
      ? (totalProfit - finCalcs.totalCost) / finCalcs.avgEquity / finCalcs.totalDays * 360 * 100 : 0;
    return { commodityCost, logCost, finCost, totalCost, margin, marginPct, totalProfit, roe };
  }, [trade, logisticsTotal, finCalcs]);

  // ─── HANDLERS ───
  const updateTrade = useCallback((k, v) => setTrade(p => ({...p, [k]: v})), []);
  const updateCost = useCallback((name, field, val) => {
    setCostInputs(p => ({...p, [name]: {...p[name], [field]: val}}));
  }, []);
  const addStage = useCallback(() => {
    setStages(p => [...p, { typeId: "own_equity", days: 10, advanceRate: null, margin: null, cof: null }]);
  }, []);
  const removeStage = useCallback((i) => {
    setStages(p => p.filter((_, idx) => idx !== i));
  }, []);
  const updateStage = useCallback((i, field, val) => {
    setStages(p => p.map((s, idx) => idx === i ? {...s, [field]: val} : s));
  }, []);

  const tabs = ["Trade Setup", "Incoterms", "Cost Buckets", "Financing", "Economics"];

  return (
    <div style={{
      fontFamily: fontStack,
      background: COLORS.bg,
      color: COLORS.text,
      minHeight: "100vh",
      padding: "0",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, ${COLORS.surface} 0%, ${COLORS.surfaceAlt} 100%)`,
        borderBottom: `1px solid ${COLORS.border}`,
        padding: "20px 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between"
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 6,
              background: `linear-gradient(135deg, ${COLORS.accent}, #a08030)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, fontWeight: 700, color: "#0a0f1a"
            }}>CZ</div>
            <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>Trade Costing Engine</span>
          </div>
          <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 4, marginLeft: 44 }}>
            Commodity trade pricing, financing, and logistics dashboard
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Pill label={`${buyInco} → ${sellInco}`} color={COLORS.accent} />
          <Pill label={`${trade.volume} MT`} color={COLORS.blue} />
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display: "flex", gap: 0,
        background: COLORS.surface,
        borderBottom: `1px solid ${COLORS.border}`,
        padding: "0 20px",
        overflowX: "auto",
      }}>
        {tabs.map((t, i) => (
          <button key={t} onClick={() => setActiveTab(i)} style={{
            padding: "14px 22px",
            background: "none", border: "none", cursor: "pointer",
            color: activeTab === i ? COLORS.accent : COLORS.textDim,
            fontFamily: fontStack,
            fontSize: 13, fontWeight: activeTab === i ? 600 : 500,
            borderBottom: activeTab === i ? `2px solid ${COLORS.accent}` : "2px solid transparent",
            transition: "all 0.2s",
            whiteSpace: "nowrap",
          }}>{i + 1}. {t}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto" }}>
        {activeTab === 0 && <TradeSetup trade={trade} updateTrade={updateTrade} />}
        {activeTab === 1 && <IncotermsPanel buyInco={buyInco} sellInco={sellInco} setBuyInco={setBuyInco} setSellInco={setSellInco} activeBuckets={activeBuckets} />}
        {activeTab === 2 && <CostBuckets activeBuckets={activeBuckets} costInputs={costInputs} updateCost={updateCost} logisticsTotal={logisticsTotal} currency={trade.currency} />}
        {activeTab === 3 && <FinancingPanel stages={stages} addStage={addStage} removeStage={removeStage} updateStage={updateStage} bankCOF={bankCOF} setBankCOF={setBankCOF} finCalcs={finCalcs} trade={trade} />}
        {activeTab === 4 && <EconomicsSummary economics={economics} trade={trade} finCalcs={finCalcs} logisticsTotal={logisticsTotal} buyInco={buyInco} sellInco={sellInco} />}
      </div>
    </div>
  );
}

// ─── COMPONENTS ───

function Pill({ label, color }) {
  return (
    <span style={{
      display: "inline-block", padding: "4px 12px", borderRadius: 20,
      background: `${color}18`, color, fontSize: 12, fontWeight: 600,
      border: `1px solid ${color}30`,
    }}>{label}</span>
  );
}

function Card({ title, children, accent, right }) {
  return (
    <div style={{
      background: COLORS.surface,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 10,
      marginBottom: 20,
      overflow: "hidden",
    }}>
      {title && (
        <div style={{
          padding: "14px 20px",
          borderBottom: `1px solid ${COLORS.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: accent ? `${accent}08` : undefined,
          borderLeft: accent ? `3px solid ${accent}` : undefined,
        }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: accent || COLORS.text }}>{title}</span>
          {right}
        </div>
      )}
      <div style={{ padding: "16px 20px" }}>{children}</div>
    </div>
  );
}

function InputRow({ label, value, onChange, type = "text", suffix, small, placeholder }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <label style={{ fontSize: 13, color: COLORS.textDim, width: small ? 140 : 180, flexShrink: 0 }}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
        <input
          type={type} value={value} onChange={e => onChange(type === "number" ? parseFloat(e.target.value) || 0 : e.target.value)}
          placeholder={placeholder}
          style={{
            background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}`, borderRadius: 6,
            padding: "8px 12px", color: COLORS.text, fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13, width: small ? 100 : 180, outline: "none",
          }}
        />
        {suffix && <span style={{ fontSize: 12, color: COLORS.textMuted }}>{suffix}</span>}
      </div>
    </div>
  );
}

// ─── TAB 1: TRADE SETUP ───
function TradeSetup({ trade, updateTrade }) {
  return (
    <>
      <Card title="Trade Parameters" accent={COLORS.accent}>
        <InputRow label="Scenario Name" value={trade.name} onChange={v => updateTrade("name", v)} placeholder="e.g. Brazil Sugar Q2" />
        <InputRow label="Commodity" value={trade.commodity} onChange={v => updateTrade("commodity", v)} />
        <div style={{ display: "flex", gap: 20 }}>
          <div style={{ flex: 1 }}>
            <InputRow label="Origin" value={trade.origin} onChange={v => updateTrade("origin", v)} placeholder="e.g. Santos, Brazil" small />
          </div>
          <div style={{ flex: 1 }}>
            <InputRow label="Destination" value={trade.destination} onChange={v => updateTrade("destination", v)} placeholder="e.g. Felixstowe, UK" small />
          </div>
        </div>
        <div style={{ height: 1, background: COLORS.border, margin: "12px 0" }} />
        <InputRow label="Volume" value={trade.volume} onChange={v => updateTrade("volume", v)} type="number" suffix="MT" />
        <InputRow label="Purchase Price" value={trade.purchasePrice} onChange={v => updateTrade("purchasePrice", v)} type="number" suffix="$/MT" />
        <InputRow label="Sale Price" value={trade.salePrice} onChange={v => updateTrade("salePrice", v)} type="number" suffix="$/MT" />
        <InputRow label="Currency" value={trade.currency} onChange={v => updateTrade("currency", v)} />
      </Card>
      <Card title="Quick Reference">
        <div style={{ display: "flex", gap: 24 }}>
          <Stat label="Trade Value (Buy)" value={`$${(trade.volume * trade.purchasePrice).toLocaleString()}`} />
          <Stat label="Trade Value (Sell)" value={`$${(trade.volume * trade.salePrice).toLocaleString()}`} />
          <Stat label="Gross Spread" value={`$${(trade.salePrice - trade.purchasePrice).toFixed(2)}/MT`} color={trade.salePrice > trade.purchasePrice ? COLORS.green : COLORS.red} />
          <Stat label="Gross Spread" value={`${toClb(trade.salePrice - trade.purchasePrice).toFixed(3)} c/lb`} color={trade.salePrice > trade.purchasePrice ? COLORS.green : COLORS.red} />
        </div>
      </Card>
    </>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 11, color: COLORS.textMuted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || COLORS.text, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
    </div>
  );
}

// ─── TAB 2: INCOTERMS ───
function IncotermsPanel({ buyInco, sellInco, setBuyInco, setSellInco, activeBuckets }) {
  const activeCount = activeBuckets.filter(b => b.active).length;
  return (
    <>
      <Card title="Incoterm Selection" accent={COLORS.accent}>
        <div style={{ display: "flex", gap: 40, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Buy Incoterm</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {INCOTERMS.map(i => (
                <button key={i} onClick={() => setBuyInco(i)} style={{
                  padding: "8px 16px", borderRadius: 6, border: `1px solid ${buyInco === i ? COLORS.accent : COLORS.border}`,
                  background: buyInco === i ? COLORS.accentDim : COLORS.surfaceAlt,
                  color: buyInco === i ? COLORS.accent : COLORS.textDim,
                  fontFamily: fontStack, fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}>{i}</button>
              ))}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Sell Incoterm</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {INCOTERMS.map(i => (
                <button key={i} onClick={() => setSellInco(i)} style={{
                  padding: "8px 16px", borderRadius: 6, border: `1px solid ${sellInco === i ? COLORS.green : COLORS.border}`,
                  background: sellInco === i ? COLORS.greenDim : COLORS.surfaceAlt,
                  color: sellInco === i ? COLORS.green : COLORS.textDim,
                  fontFamily: fontStack, fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}>{i}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 13, color: COLORS.textDim, padding: "10px 14px", background: COLORS.surfaceAlt, borderRadius: 6 }}>
          Buy <strong style={{ color: COLORS.accent }}>{buyInco}</strong> / Sell <strong style={{ color: COLORS.green }}>{sellInco}</strong> activates <strong style={{ color: COLORS.text }}>{activeCount}</strong> of {COST_BUCKETS.length} cost buckets
        </div>
      </Card>

      <Card title="Cost Responsibility Matrix">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "8px 10px", color: COLORS.textMuted, borderBottom: `1px solid ${COLORS.border}` }}>Cost Bucket</th>
                <th style={{ padding: "8px 10px", color: COLORS.accent, borderBottom: `1px solid ${COLORS.border}` }}>BUY_{buyInco}</th>
                <th style={{ padding: "8px 10px", color: COLORS.green, borderBottom: `1px solid ${COLORS.border}` }}>SELL_{sellInco}</th>
                <th style={{ padding: "8px 10px", color: COLORS.text, borderBottom: `1px solid ${COLORS.border}` }}>Active</th>
              </tr>
            </thead>
            <tbody>
              {activeBuckets.map((b, i) => (
                <tr key={b.name} style={{ background: i % 2 === 0 ? "transparent" : `${COLORS.surfaceAlt}60` }}>
                  <td style={{ padding: "6px 10px", color: b.active ? COLORS.text : COLORS.textMuted }}>{b.name}</td>
                  <td style={{ textAlign: "center", padding: "6px 10px" }}>
                    <span style={{ color: BUY_MATRIX[buyInco][i] ? COLORS.accent : COLORS.textMuted }}>{BUY_MATRIX[buyInco][i] ? "YES" : "--"}</span>
                  </td>
                  <td style={{ textAlign: "center", padding: "6px 10px" }}>
                    <span style={{ color: SELL_MATRIX[sellInco][i] ? COLORS.green : COLORS.textMuted }}>{SELL_MATRIX[sellInco][i] ? "YES" : "--"}</span>
                  </td>
                  <td style={{ textAlign: "center", padding: "6px 10px" }}>
                    {b.active
                      ? <span style={{ background: COLORS.greenDim, color: COLORS.green, padding: "2px 10px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>ACTIVE</span>
                      : <span style={{ color: COLORS.textMuted, fontSize: 11 }}>--</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// ─── TAB 3: COST BUCKETS ───
function CostBuckets({ activeBuckets, costInputs, updateCost, logisticsTotal, currency }) {
  const active = activeBuckets.filter(b => b.active);
  const inactive = activeBuckets.filter(b => !b.active);
  return (
    <>
      <Card title={`Active Cost Buckets (${active.length})`} accent={COLORS.green}
        right={<span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: COLORS.accent }}>
          Total: ${logisticsTotal.toFixed(2)}/MT | {toClb(logisticsTotal).toFixed(3)} c/lb
        </span>}
      >
        {active.length === 0 && <div style={{ color: COLORS.textMuted, fontSize: 13 }}>No active cost buckets for this Incoterm combination.</div>}
        {active.map(b => {
          const ci = costInputs[b.name];
          return (
            <div key={b.name} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
              borderBottom: `1px solid ${COLORS.border}22`,
            }}>
              <button onClick={() => updateCost(b.name, "enabled", !ci.enabled)} style={{
                width: 20, height: 20, borderRadius: 4, border: `1px solid ${ci.enabled ? COLORS.green : COLORS.border}`,
                background: ci.enabled ? COLORS.greenDim : "transparent", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: ci.enabled ? COLORS.green : "transparent", fontSize: 13,
              }}>{ci.enabled ? "✓" : ""}</button>
              <span style={{ flex: 1, fontSize: 13, color: ci.enabled ? COLORS.text : COLORS.textMuted }}>{b.name}</span>
              <input type="number" value={ci.value} onChange={e => updateCost(b.name, "value", e.target.value)}
                disabled={!ci.enabled}
                style={{
                  width: 90, background: COLORS.surfaceAlt, border: `1px solid ${COLORS.border}`, borderRadius: 5,
                  padding: "6px 10px", color: ci.enabled ? COLORS.text : COLORS.textMuted,
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 12, textAlign: "right", outline: "none",
                  opacity: ci.enabled ? 1 : 0.4,
                }}
              />
              <span style={{ fontSize: 11, color: COLORS.textMuted, width: 40 }}>{currency}/MT</span>
              <span style={{ fontSize: 11, color: COLORS.textMuted, width: 70, fontFamily: "'JetBrains Mono', monospace", textAlign: "right" }}>
                {toClb(parseFloat(ci.value) || 0).toFixed(3)} c/lb
              </span>
            </div>
          );
        })}
      </Card>
      {inactive.length > 0 && (
        <Card title={`Inactive Buckets (${inactive.length})`}>
          <div style={{ fontSize: 12, color: COLORS.textMuted, lineHeight: 1.7 }}>
            {inactive.map(b => b.name).join(" · ")}
          </div>
        </Card>
      )}
    </>
  );
}

// ─── TAB 4: FINANCING ───
function FinancingPanel({ stages, addStage, removeStage, updateStage, bankCOF, setBankCOF, finCalcs, trade }) {
  return (
    <>
      <Card title="Global Financing Parameters" accent={COLORS.blue}>
        <div style={{ display: "flex", gap: 24 }}>
          <InputRow label="Blended Bank COF" value={(bankCOF * 100).toFixed(2)} onChange={v => setBankCOF((parseFloat(v) || 0) / 100)} type="number" suffix="%" small />
          <InputRow label="CZ Equity Rate" value="12.00" onChange={() => {}} type="number" suffix="% (fixed)" small />
        </div>
      </Card>

      <Card title="Financing Stages" accent={COLORS.accent}
        right={<button onClick={addStage} style={{
          background: COLORS.accentDim, border: `1px solid ${COLORS.accent}40`, borderRadius: 6,
          padding: "6px 14px", color: COLORS.accent, fontFamily: fontStack, fontSize: 12,
          fontWeight: 600, cursor: "pointer",
        }}>+ Add Stage</button>}
      >
        {stages.map((s, i) => {
          const ft = FINANCING_TYPES.find(f => f.id === s.typeId);
          const c = finCalcs.results[i];
          return (
            <div key={i} style={{
              background: COLORS.surfaceAlt, borderRadius: 8, padding: 16, marginBottom: 12,
              border: `1px solid ${COLORS.border}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: "50%", background: COLORS.accentDim,
                    color: COLORS.accent, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700,
                  }}>{i + 1}</span>
                  <select value={s.typeId} onChange={e => updateStage(i, "typeId", e.target.value)} style={{
                    background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 6,
                    padding: "6px 10px", color: COLORS.text, fontFamily: fontStack, fontSize: 13, outline: "none",
                  }}>
                    {FINANCING_TYPES.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <button onClick={() => removeStage(i)} style={{
                  background: COLORS.redDim, border: "none", borderRadius: 4, padding: "4px 10px",
                  color: COLORS.red, fontSize: 11, cursor: "pointer", fontWeight: 600,
                }}>Remove</button>
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}>
                <MiniInput label="Days" value={s.days} onChange={v => updateStage(i, "days", parseInt(v) || 0)} />
                <MiniInput label="Advance Rate" value={s.advanceRate !== null ? (s.advanceRate * 100).toFixed(1) : (ft?.advanceRate * 100).toFixed(1)} onChange={v => updateStage(i, "advanceRate", (parseFloat(v) || 0) / 100)} suffix="%" />
                <MiniInput label="Margin" value={s.margin !== null ? (s.margin * 100).toFixed(2) : (ft?.margin * 100).toFixed(2)} onChange={v => updateStage(i, "margin", (parseFloat(v) || 0) / 100)} suffix="%" />
              </div>
              {c && (
                <div style={{ display: "flex", gap: 16, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${COLORS.border}` }}>
                  <MiniStat label="Exposure Base" value={`$${c.base.toLocaleString()}`} />
                  <MiniStat label="Bank Loan" value={`$${c.bankLoan.toLocaleString()}`} />
                  <MiniStat label="CZ Equity" value={`$${c.equity.toLocaleString()}`} />
                  <MiniStat label="Bank Interest" value={`$${c.bankInterest.toFixed(0)}`} />
                  <MiniStat label="Equity Cost" value={`$${c.equityCost.toFixed(0)}`} />
                  <MiniStat label="Total Cost" value={`$${c.totalCost.toFixed(0)}`} accent />
                </div>
              )}
            </div>
          );
        })}
      </Card>

      <Card title="Financing Aggregation">
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <Stat label="Total Lifecycle Days" value={finCalcs.totalDays} />
          <Stat label="Total Financing Cost" value={`$${finCalcs.totalCost.toFixed(2)}`} />
          <Stat label="Cost per MT" value={`$${finCalcs.costPerMt.toFixed(4)}`} />
          <Stat label="Cost per lb" value={`${toClb(finCalcs.costPerMt).toFixed(4)} c/lb`} />
          <Stat label="Avg Equity %" value={`${(finCalcs.avgEquityPct * 100).toFixed(1)}%`} />
          <Stat label="Avg CZ Equity" value={`$${finCalcs.avgEquity.toFixed(0)}`} />
        </div>
      </Card>
    </>
  );
}

function MiniInput({ label, value, onChange, suffix }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: COLORS.textMuted, marginBottom: 3, textTransform: "uppercase" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input type="number" value={value} onChange={e => onChange(e.target.value)} style={{
          width: 72, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 5,
          padding: "5px 8px", color: COLORS.text, fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12, textAlign: "right", outline: "none",
        }} />
        {suffix && <span style={{ fontSize: 10, color: COLORS.textMuted }}>{suffix}</span>}
      </div>
    </div>
  );
}

function MiniStat({ label, value, accent }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: accent ? COLORS.accent : COLORS.text, fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>{value}</div>
    </div>
  );
}

// ─── TAB 5: ECONOMICS ───
function EconomicsSummary({ economics, trade, finCalcs, logisticsTotal, buyInco, sellInco }) {
  const e = economics;
  const rows = [
    { label: "Commodity Cost (Purchase)", usdMt: e.commodityCost, pct: null, color: null },
    { label: "Logistics Cost", usdMt: e.logCost, pct: null, color: null },
    { label: "Financing Cost", usdMt: e.finCost, pct: null, color: null },
    { label: "Total Landed Cost", usdMt: e.totalCost, pct: null, color: COLORS.accent, bold: true, divider: true },
    { label: "Sale Price", usdMt: trade.salePrice, pct: null, color: null },
    { label: "Net Margin", usdMt: e.margin, pct: e.marginPct, color: e.margin >= 0 ? COLORS.green : COLORS.red, bold: true, divider: true },
  ];

  return (
    <>
      <Card title="Trade Economics Summary" accent={COLORS.accent}>
        <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
          <SummaryCard label="Buy / Sell" value={`${buyInco} → ${sellInco}`} />
          <SummaryCard label="Volume" value={`${trade.volume} MT`} />
          <SummaryCard label="Lifecycle" value={`${finCalcs.totalDays} days`} />
          <SummaryCard label="Avg Equity" value={`${(finCalcs.avgEquityPct * 100).toFixed(1)}%`} />
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "8px 12px", fontSize: 11, color: COLORS.textMuted, borderBottom: `1px solid ${COLORS.border}`, textTransform: "uppercase" }}>Component</th>
              <th style={{ textAlign: "right", padding: "8px 12px", fontSize: 11, color: COLORS.textMuted, borderBottom: `1px solid ${COLORS.border}`, textTransform: "uppercase" }}>$/MT</th>
              <th style={{ textAlign: "right", padding: "8px 12px", fontSize: 11, color: COLORS.textMuted, borderBottom: `1px solid ${COLORS.border}`, textTransform: "uppercase" }}>c/lb</th>
              <th style={{ textAlign: "right", padding: "8px 12px", fontSize: 11, color: COLORS.textMuted, borderBottom: `1px solid ${COLORS.border}`, textTransform: "uppercase" }}>Total USD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: r.divider ? `2px solid ${COLORS.border}` : undefined }}>
                <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: r.bold ? 700 : 400, color: r.color || COLORS.text }}>{r.label}</td>
                <td style={{ padding: "10px 12px", fontSize: 14, fontWeight: r.bold ? 700 : 500, color: r.color || COLORS.text, textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
                  {r.usdMt.toFixed(2)}
                </td>
                <td style={{ padding: "10px 12px", fontSize: 13, color: r.color || COLORS.textDim, textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
                  {toClb(r.usdMt).toFixed(3)}
                </td>
                <td style={{ padding: "10px 12px", fontSize: 13, color: r.color || COLORS.textDim, textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
                  {(r.usdMt * trade.volume).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <Card title="Return on Equity" accent={COLORS.green}>
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 42, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: e.roe >= 0 ? COLORS.green : COLORS.red }}>
                {e.roe.toFixed(1)}%
              </div>
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 4 }}>Annualised ROE</div>
            </div>
            <div style={{ fontSize: 12, color: COLORS.textDim, padding: "10px 14px", background: COLORS.surfaceAlt, borderRadius: 6, lineHeight: 1.6 }}>
              Net profit of <strong style={{ color: COLORS.text }}>${(e.margin * trade.volume).toFixed(0)}</strong> on avg equity of <strong style={{ color: COLORS.text }}>${finCalcs.avgEquity.toFixed(0)}</strong> over <strong style={{ color: COLORS.text }}>{finCalcs.totalDays} days</strong>
            </div>
          </Card>
        </div>
        <div style={{ flex: 1 }}>
          <Card title="Cost Breakdown" accent={COLORS.blue}>
            <CostBar label="Commodity" value={e.commodityCost} total={e.totalCost} color="#60a5fa" />
            <CostBar label="Logistics" value={e.logCost} total={e.totalCost} color={COLORS.accent} />
            <CostBar label="Financing" value={e.finCost} total={e.totalCost} color="#a78bfa" />
          </Card>
        </div>
      </div>
    </>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div style={{
      flex: 1, minWidth: 120, padding: "12px 16px", background: COLORS.surfaceAlt,
      borderRadius: 8, border: `1px solid ${COLORS.border}`,
    }}>
      <div style={{ fontSize: 10, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
    </div>
  );
}

function CostBar({ label, value, total, color }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: COLORS.textDim }}>{label}</span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: COLORS.text }}>${value.toFixed(2)} ({pct.toFixed(1)}%)</span>
      </div>
      <div style={{ height: 6, background: COLORS.surfaceAlt, borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 3, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

export default App;
