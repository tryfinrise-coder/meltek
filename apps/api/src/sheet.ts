import type { Design, StoredOption } from './store/index.js';

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const n = (v: number | null | undefined, dp = 3): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(dp);

/**
 * The calculation sheet (§8 GET /api/designs/:id/pdf).
 *
 * This markup is what Puppeteer renders to PDF and what `?format=html` serves, so the
 * printed sheet and the on-screen sheet cannot drift apart - there is only one of them.
 */
export function renderCalculationSheet(
  design: Design,
  option: StoredOption,
  opts: { autoPrint?: boolean } = {},
): string {
  const g = option.geometry;
  const steps = option.steps
    .map(
      (s) => `<tr${s.provisional ? ' class="prov"' : ''}>
        <td class="num">${s.step}</td>
        <td>${esc(s.label)}${s.provisional ? ' <span class="tag">estimate</span>' : ''}</td>
        <td class="mono">${esc(s.formula)}</td>
        <td class="mono">${esc(s.substituted)}</td>
        <td class="mono num">${typeof s.value === 'number' ? esc(n(s.value, 4)) : esc(s.value)}</td>
        <td>${esc(s.unit)}</td>
      </tr>${s.note ? `<tr class="note"><td></td><td colspan="5">${esc(s.note)}</td></tr>` : ''}`,
    )
    .join('');

  const iterations = option.iterations
    .map(
      (it) => `<tr>
        <td class="num">${it.pass}</td>
        <td class="mono num">${n(it.vIn, 5)}</td>
        <td class="mono num">${n(it.areaCm2, 4)}</td>
        <td class="mono num">${n(it.widthCm * 10, 2)}</td>
        <td class="mono num">${n(it.lengthM, 3)}</td>
        <td class="mono num">${n(it.resistanceOhm, 5)}</td>
        <td class="mono num">${n(it.vDrop, 5)}</td>
        <td class="mono num">${n(it.vNext, 5)}</td>
        <td class="mono num">${it.delta.toExponential(2)}</td>
      </tr>`,
    )
    .join('');

  const warnings = option.warnings.length
    ? `<section><h2>Notes and warnings</h2><ul class="warn">${option.warnings
        .map((w) => `<li><strong>${esc(w.ref ?? '')}</strong> ${esc(w.message)}</li>`)
        .join('')}</ul></section>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(design.designNo)} — calculation sheet</title>
<style>
  :root { --ink:#14181D; --ink2:#55606D; --line:#CBD0D8; --brand:#E21938; --prov:#6B5A99; }
  * { box-sizing: border-box; }
  body { font: 11px/1.5 ui-sans-serif, system-ui, sans-serif; color: var(--ink);
         margin: 0; padding: 18mm 14mm; font-variant-numeric: tabular-nums; }
  header { display:flex; justify-content:space-between; align-items:flex-start;
           border-bottom: 2px solid var(--brand); padding-bottom: 8px; margin-bottom: 14px; }
  .word { font: 800 italic 22px/1 ui-sans-serif, system-ui, sans-serif; color: var(--brand);
          letter-spacing: -0.02em; }
  h1 { font-size: 15px; margin: 2px 0 0; letter-spacing: -0.02em; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink2);
       margin: 16px 0 6px; }
  .meta { text-align: right; color: var(--ink2); font-size: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink2);
       border-bottom: 1px solid var(--ink2); }
  .num { text-align: right; }
  .mono { font-family: ui-monospace, "JetBrains Mono", monospace; font-size: 10px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 16px; }
  .grid div { border-bottom: 1px solid var(--line); padding: 3px 0; }
  .grid span { display:block; color: var(--ink2); font-size: 9px;
               text-transform: uppercase; letter-spacing: .06em; }
  .tag { color: var(--prov); border: 1px solid var(--prov); border-radius: 3px;
         font-size: 8px; padding: 0 3px; text-transform: uppercase; letter-spacing: .06em; }
  tr.note td { border-bottom: none; color: var(--ink2); font-size: 9.5px; padding-top: 0; }
  tr.prov td { background: rgba(107,90,153,.05); }
  .warn li { margin-bottom: 3px; }
  footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid var(--line);
           color: var(--ink2); font-size: 9px; display:flex; justify-content:space-between; }
  @page { size: A4; margin: 0; }
  @media print { body { padding: 14mm 12mm; } section { break-inside: avoid; } }
</style></head>
<body>
<header>
  <div>
    <div class="word">MELTEK</div>
    <h1>LT current transformer — calculation sheet</h1>
  </div>
  <div class="meta">
    <div><strong>${esc(design.designNo)}</strong> rev ${design.revision}</div>
    <div>${esc(design.customerName)}</div>
    <div>${esc(design.status)}${design.approvedBy ? ` · approved by ${esc(design.approvedBy)}` : ''}</div>
    <div>${new Date().toISOString().slice(0, 10)}</div>
  </div>
</header>

<section>
  <h2>Specification</h2>
  <div class="grid">
    <div><span>Ratio</span>${design.inputs.primaryCurrent}/${design.inputs.secondaryCurrent}A</div>
    <div><span>Burden</span>${design.inputs.burdenVA} VA</div>
    <div><span>Class</span>${esc(design.inputs.accuracyClass)}</div>
    <div><span>CT type</span>${esc(design.inputs.ctType)}</div>
    <div><span>Finished ID</span>${design.inputs.finishedIdMm} mm</div>
    <div><span>Finished OD</span>${design.inputs.finishedOdMm} mm</div>
    <div><span>Enquiry</span>${esc(design.enquiryNo ?? '—')}</div>
    <div><span>PO</span>${esc(design.poNo ?? '—')}</div>
    <div><span>PRD</span>${esc(design.prdNo ?? '—')}</div>
    <div><span>Quantity</span>${design.quantity ?? '—'}</div>
    <div><span>Required by</span>${esc(design.requiredBy ?? '—')}</div>
    <div><span>Insulation</span>${esc(design.insulationType ?? '—')}</div>
  </div>
</section>

<section>
  <h2>Selected option</h2>
  <div class="grid">
    <div><span>Grade</span>${esc(option.gradeLabel)}</div>
    <div><span>Wire</span>SWG ${option.swg}</div>
    <div><span>B used</span>${n(option.bUsedT, 4)} T${option.wasCapped ? ' (capped)' : ''}</div>
    <div><span>B from curve</span>${n(option.bRawT, 4)} T</div>
    <div><span>Core ID / OD</span>${n(g.coreIdMm, 1)} / ${n(g.coreOdMm, 1)} mm</div>
    <div><span>Radial build</span>${n(g.radialBuildMm, 2)} mm</div>
    <div><span>Core area</span>${n(option.coreAreaCm2, 4)} cm²</div>
    <div><span>Core width</span>${n(option.coreWidthMm, 2)} mm</div>
    <div><span>Ordered width</span>${n(option.orderedWidthMm, 0)} mm <span class="tag">estimate</span></div>
    <div><span>Wire length</span>${n(option.wireLengthM, 3)} m</div>
    <div><span>Core weight</span>${n(option.coreWeightKg, 4)} kg <span class="tag">estimate</span></div>
    <div><span>Copper weight</span>${n(option.copperWeightKg, 4)} kg <span class="tag">estimate</span></div>
    <div><span>Core cost</span>${option.coreCost === null ? '—' : `₹${n(option.coreCost, 2)}`} <span class="tag">estimate</span></div>
    <div><span>Copper cost</span>₹${n(option.copperCost, 2)} <span class="tag">estimate</span></div>
    <div><span>Total ${option.engineering?.costBasis === 'manufacturing' ? 'manufacturing' : 'material'}</span>${option.totalCost === null ? '—' : `₹${n(option.totalCost, 2)}`} <span class="tag">estimate</span></div>
    <div><span>Die</span>${esc(option.dieNo ?? 'not checked against tooling')}</div>
  </div>
</section>

<section>
  <h2>Calculation chain</h2>
  <table>
    <thead><tr><th class="num">#</th><th>Step</th><th>Formula</th><th>Substituted</th><th class="num">Value</th><th>Unit</th></tr></thead>
    <tbody>${steps}</tbody>
  </table>
</section>

<section>
  <h2>Convergence — ${option.passes} passes${option.converged ? '' : ' (did not converge)'}</h2>
  <table>
    <thead><tr><th class="num">Pass</th><th class="num">V in</th><th class="num">Area cm²</th>
      <th class="num">Width mm</th><th class="num">Wire m</th><th class="num">R Ω</th>
      <th class="num">V drop</th><th class="num">V out</th><th class="num">Δ</th></tr></thead>
    <tbody>${iterations}</tbody>
  </table>
</section>

${option.engineering ? `<section><h2>Engineering screening</h2>
<p>${esc(design.inputs.engineering?.purpose)} · ${esc(design.inputs.engineering?.standard)}</p>
<p>Core insulation: ${esc(design.inputs.engineering?.coreInsulation.type)} (${n(design.inputs.engineering?.coreInsulation.thicknessMm)} mm/side). Outer: ${esc(design.inputs.engineering?.outerInsulation.type)} (${n(design.inputs.engineering?.outerInsulation.thicknessMm)} mm/side). Parallel strands: ${esc(design.inputs.engineering?.parallelStrands)}.</p>
<table><tbody>${Object.entries(option.engineering).filter(([key,value])=>typeof value==='number' || ['resistance75Source','costBasis'].includes(key)).map(([key,value])=>`<tr><td>${esc(key)}</td><td>${typeof value==='number'?n(value,5):esc(value)}</td></tr>`).join('')}</tbody></table>
<h3>Metering test-point screening</h3><table><thead><tr><th>Current %</th><th>Burden %</th><th>Ratio error %</th><th>Phase minutes</th><th>Result</th></tr></thead><tbody>${option.engineering.checks.map(p=>`<tr><td>${n(p.currentPercent,1)}</td><td>${n(p.burdenPercent,1)}</td><td>${n(p.ratioErrorPercent,5)}</td><td>${n(p.phaseMinutes,5)}</td><td>${p.passed===null?'Missing data':p.passed?'Pass':'Fail'}</td></tr>`).join('')}</tbody></table>
<p>Steady-state screening only. Not a certificate of standard compliance or transient fault performance.</p></section>` : ''}
${warnings}

<footer>
  <span>Meltek · Adhunik Yantra Udyog — ${esc(design.designNo)} rev ${design.revision}</span>
  <span>Weights and costs are estimated from the rate table in force on the date above</span>
</footer>
${opts.autoPrint ? '<script>window.addEventListener("load", () => window.print());</script>' : ''}
</body></html>`;
}
