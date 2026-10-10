import { useEffect, useId, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import type { RankedOption } from '@meltek/engine';
import { Button, Card } from '../components/primitives';

const mm = (n: number) => Number(n.toFixed(2)).toString();

function download(data: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const WIRE_COLORS_3D = [0xf0a45e, 0xe06070, 0x60c080, 0x6098d8, 0xd8a060];
const WIRE_COLORS_SVG = ['#f0a45e', '#e06070', '#60c080', '#6098d8', '#d8a060'];

/** Annular rectangular steel section, in millimetres. */
function coreGeometry(inner: number, outer: number, width: number) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer / 2, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner / 2, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 128, steps: 1 });
  geometry.translate(0, 0, -width / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function buildWireEntries(option: RankedOption): { swg: number; count: number }[] {
  if (option.wireCombination && option.wireCombination.length > 0) {
    return option.wireCombination.filter(e => e.count > 0);
  }
  return [{ swg: option.swg, count: 1 }];
}

function totalWireCount(entries: { swg: number; count: number }[]) {
  return entries.reduce((sum, e) => sum + e.count, 0);
}

type ModelActions = { reset: () => void; rotate: (direction: number) => void; zoom: (factor: number) => void };

function openPrintSheet(option: RankedOption) {
  const g = option.geometry;
  const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  const n = (v: number | null | undefined, dp = 3) =>
    v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(dp);

  const wireLabel = option.wireCombinationLabel || `SWG ${option.swg}`;
  const entries = buildWireEntries(option);
  const wireTotal = totalWireCount(entries);

  const wireLegendRows = entries.map((e, i) => {
    const color = WIRE_COLORS_SVG[i % WIRE_COLORS_SVG.length];
    return `<tr><td><span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${color};vertical-align:middle;margin-right:6px"></span>SWG ${e.swg}</td><td class="num">${e.count} wire${e.count > 1 ? 's' : ''}</td></tr>`;
  }).join('');

  const steps = option.steps.map(s => `<tr${s.provisional ? ' class="prov"' : ''}>
    <td class="num">${s.step}</td>
    <td>${esc(s.label)}${s.provisional ? ' <span class="tag">estimate</span>' : ''}</td>
    <td class="mono">${esc(s.formula)}</td>
    <td class="mono">${esc(s.substituted)}</td>
    <td class="mono num">${typeof s.value === 'number' ? esc(n(s.value, 4)) : esc(s.value)}</td>
    <td>${esc(s.unit)}</td>
  </tr>${s.note ? `<tr class="note"><td></td><td colspan="5">${esc(s.note)}</td></tr>` : ''}`).join('');

  const iterations = option.iterations.map(it => `<tr>
    <td class="num">${it.pass}</td><td class="mono num">${n(it.vIn, 5)}</td>
    <td class="mono num">${n(it.areaCm2, 4)}</td><td class="mono num">${n(it.widthCm * 10, 2)}</td>
    <td class="mono num">${n(it.lengthM, 3)}</td><td class="mono num">${n(it.resistanceOhm, 5)}</td>
    <td class="mono num">${n(it.vDrop, 5)}</td><td class="mono num">${n(it.vNext, 5)}</td>
    <td class="mono num">${it.delta.toExponential(2)}</td>
  </tr>`).join('');

  const warnings = option.warnings.length
    ? `<section><h2>Notes and warnings</h2><ul class="warn">${option.warnings.map(w => `<li><strong>${esc(w.ref ?? '')}</strong> ${esc(w.message)}</li>`).join('')}</ul></section>`
    : '';

  // Build the SVG diagram inline for the PDF
  const inner = g.coreIdMm;
  const outer = g.coreOdMm;
  const width = option.orderedWidthMm;
  const svgScale = 152 / Math.max(option.inputs.finishedOdMm, outer);
  const ro = outer * svgScale / 2;
  const ri = inner * svgScale / 2;
  const fo = option.inputs.finishedOdMm * svgScale / 2;
  const fi = option.inputs.finishedIdMm * svgScale / 2;
  const sideScale = Math.min(svgScale, 110 / width);
  const sideW = width * sideScale;
  const sideH = outer * sideScale;

  // Wire cross-section circles in front view
  const wireRadius = Math.min((ro - ri) * 0.12, 4);
  const midR = (ri + ro) / 2;
  let wireCirclesSvg = '';
  if (wireTotal > 1) {
    let idx = 0;
    for (const entry of entries) {
      const color = WIRE_COLORS_SVG[idx % WIRE_COLORS_SVG.length];
      for (let w = 0; w < entry.count; w++) {
        const wireIdx = entries.slice(0, idx).reduce((s, e) => s + e.count, 0) + w;
        const topAngle = -Math.PI / 2 + (wireIdx / wireTotal) * Math.PI * 0.6 - Math.PI * 0.3;
        const bottomAngle = Math.PI / 2 + (wireIdx / wireTotal) * Math.PI * 0.6 - Math.PI * 0.3;
        const tx = 145 + Math.cos(topAngle) * midR;
        const ty = 165 + Math.sin(topAngle) * midR;
        const bx = 145 + Math.cos(bottomAngle) * midR;
        const by = 165 + Math.sin(bottomAngle) * midR;
        wireCirclesSvg += `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="${wireRadius}" fill="${color}" fill-opacity=".85" stroke="${color}" stroke-width=".5"/>`;
        wireCirclesSvg += `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="${wireRadius}" fill="${color}" fill-opacity=".85" stroke="${color}" stroke-width=".5"/>`;
      }
      idx++;
    }
  }

  const diagramSvg = `<svg viewBox="0 0 520 340" xmlns="http://www.w3.org/2000/svg" style="color:#173e48;max-width:480px">
    <defs><marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M10 5L0 0v10Z" fill="currentColor"/></marker></defs>
    <g fill="none" stroke="currentColor">
      <circle cx="145" cy="165" r="${ro}" fill="#65c7b9" fill-opacity=".18" stroke-width="1.5"/>
      <circle cx="145" cy="165" r="${ri}" fill="#9eb7bf" fill-opacity=".1" stroke-width="1.5"/>
      <g stroke-dasharray="4 4" opacity=".45"><circle cx="145" cy="165" r="${fo}"/><circle cx="145" cy="165" r="${fi}"/></g>
      <path d="M45 165H245 M145 65V265" stroke-dasharray="8 4 2 4" opacity=".4"/>
      <rect x="${365 - sideW / 2}" y="${165 - sideH / 2}" width="${sideW}" height="${sideH}" fill="#65c7b9" fill-opacity=".18" stroke-width="1.5"/>
      <path d="M${365 - sideW / 2} ${165 - inner * sideScale / 2}h${sideW} M${365 - sideW / 2} ${165 + inner * sideScale / 2}h${sideW}" stroke-dasharray="4 4"/>
    </g>
    ${wireCirclesSvg}
    <g fill="currentColor" stroke="currentColor" stroke-width=".8">
      <path d="M${145 - ro} ${49}v12 M${145 + ro} ${49}v12 M${145 - ro} ${55}H${145 + ro}" marker-start="url(#arr)" marker-end="url(#arr)"/>
      <text x="145" y="46" text-anchor="middle" stroke="none" font-size="11">Core OD ⌀ ${mm(outer)}</text>
    </g>
    <g fill="currentColor" stroke="currentColor" stroke-width=".8">
      <path d="M${145 - ri} ${159}v12 M${145 + ri} ${159}v12 M${145 - ri} ${165}H${145 + ri}" marker-start="url(#arr)" marker-end="url(#arr)"/>
      <text x="145" y="156" text-anchor="middle" stroke="none" font-size="11">ID ⌀ ${mm(inner)}</text>
    </g>
    <g fill="currentColor" stroke="currentColor" stroke-width=".8">
      <path d="M${365 - sideW / 2} ${49}v12 M${365 + sideW / 2} ${49}v12 M${365 - sideW / 2} ${55}H${365 + sideW / 2}" marker-start="url(#arr)" marker-end="url(#arr)"/>
      <text x="365" y="46" text-anchor="middle" stroke="none" font-size="11">Width ${mm(width)}</text>
    </g>
    <g fill="currentColor" font-family="system-ui, sans-serif" font-size="11" text-anchor="middle">
      <text x="145" y="277">FRONT VIEW</text><text x="365" y="277">SIDE VIEW · CORE</text>
      <text x="260" y="305">Finished ID / OD: ${mm(option.inputs.finishedIdMm)} / ${mm(option.inputs.finishedOdMm)} mm (dashed)</text>
      <text x="260" y="325">All dimensions in mm · Width is the ordered slit width</text>
    </g>
  </svg>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Calculation Sheet — ${esc(option.gradeLabel)} · ${esc(wireLabel)}</title>
<style>
  :root { --ink:#14181D; --ink2:#55606D; --line:#CBD0D8; --brand:#E21938; --prov:#6B5A99;
          --geo:#3a72a8; --elec:#168b79; --cost:#a8791f; }
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
  .diagram-row { display: flex; gap: 24px; align-items: flex-start; margin: 12px 0; }
  .diagram-row svg { flex: 1; }
  .wire-legend { flex: 0 0 auto; font-size: 10px; }
  .wire-legend table { width: auto; }
  .wire-legend td { padding: 2px 8px 2px 0; border: none; }
  .section-tag { display:inline-block; font-size:8px; text-transform:uppercase; letter-spacing:.06em;
                 padding: 1px 5px; border-radius:3px; color:#fff; margin-left:6px; vertical-align:middle; }
  footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid var(--line);
           color: var(--ink2); font-size: 9px; display:flex; justify-content:space-between; }
  @page { size: A4; margin: 0; }
  @media print { body { padding: 14mm 12mm; } section { break-inside: avoid; } }
  @media screen { .no-print { display: flex; gap: 8px; position: fixed; top: 12px; right: 12px; z-index: 100; }
    .no-print button { padding: 8px 16px; background: var(--brand); color: #fff; border: none;
      border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; }
    .no-print button:hover { opacity: .85; } }
  @media print { .no-print { display: none; } }
</style></head>
<body>
<div class="no-print">
  <button onclick="window.print()">Print / Save as PDF</button>
</div>
<header>
  <div>
    <div class="word">MELTEK</div>
    <h1>LT current transformer — calculation sheet</h1>
  </div>
  <div class="meta">
    <div><strong>${esc(option.gradeLabel)} · ${esc(wireLabel)}</strong></div>
    <div>${option.inputs.primaryCurrent}/${option.inputs.secondaryCurrent}A · ${option.inputs.burdenVA} VA · Class ${esc(option.inputs.accuracyClass)}</div>
    <div>${new Date().toISOString().slice(0, 10)}</div>
  </div>
</header>

<section>
  <h2>Specification</h2>
  <div class="grid">
    <div><span>Ratio</span>${option.inputs.primaryCurrent}/${option.inputs.secondaryCurrent}A</div>
    <div><span>Burden</span>${option.inputs.burdenVA} VA</div>
    <div><span>Class</span>${esc(option.inputs.accuracyClass)}</div>
    <div><span>CT type</span>${esc(option.inputs.ctType)}</div>
    <div><span>Finished ID</span>${option.inputs.finishedIdMm} mm</div>
    <div><span>Finished OD</span>${option.inputs.finishedOdMm} mm</div>
    <div><span>Wire</span>${esc(wireLabel)}</div>
    <div><span>Turns</span>${g.turns}</div>
  </div>
</section>

<section>
  <h2>Dimensioned diagram</h2>
  <div class="diagram-row">
    ${diagramSvg}
    ${wireTotal > 1 ? `<div class="wire-legend"><strong>Wire combination</strong><table>${wireLegendRows}
      <tr><td><strong>Total</strong></td><td class="num"><strong>${wireTotal} wires</strong></td></tr>
    </table></div>` : ''}
  </div>
</section>

<section>
  <h2>Selected option</h2>
  <div class="grid">
    <div><span>Grade</span>${esc(option.gradeLabel)}</div>
    <div><span>Wire</span>${esc(wireLabel)}</div>
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
    <div><span>Total material</span>${option.totalCost === null ? '—' : `₹${n(option.totalCost, 2)}`} <span class="tag">estimate</span></div>
    <div><span>Die</span>${esc(option.dieNo ?? 'not checked')}</div>
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

${warnings}

<footer>
  <span>Meltek · Adhunik Yantra Udyog — ${esc(option.gradeLabel)} · ${esc(wireLabel)}</span>
  <span>Weights and costs are estimated from the rate table in force on the date above</span>
</footer>
</body></html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

export default function SelectedDesignPreview({ option }: { option: RankedOption }) {
  const container = useRef<HTMLDivElement>(null);
  const drawing = useRef<SVGSVGElement>(null);
  const actions = useRef<ModelActions | null>(null);
  const [windings, setWindings] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const id = useId().replace(/:/g, '');
  const { coreIdMm: inner, coreOdMm: outer } = option.geometry;
  const width = option.orderedWidthMm;
  const turns = option.geometry.turns;
  const valid = [inner, outer, width].every(n => Number.isFinite(n) && n > 0) && outer > inner;
  const wireLabel = option.wireCombinationLabel || `SWG ${option.swg}`;
  const filename = `LT-CT-${option.gradeCode}-${wireLabel}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  const wireEntries = buildWireEntries(option);
  const wireCount = totalWireCount(wireEntries);

  useEffect(() => {
    const host = container.current;
    if (!host || !valid) return;
    setUnavailable(false);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setUnavailable(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D selected core. Drag to orbit, scroll or pinch to zoom. Keyboard controls are below.');
    renderer.domElement.setAttribute('role', 'img');
    const scene = new THREE.Scene();
    const model = new THREE.Group();
    scene.add(model);
    const steel = new THREE.MeshStandardMaterial({ color: 0x75b7b4, metalness: .55, roughness: .3 });
    model.add(new THREE.Mesh(coreGeometry(inner, outer, width), steel));
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x235253, transparent: true, opacity: .42 });
    for (let n = 1; n < 12; n++) {
      const points = Array.from({ length: 129 }, (_, i) => new THREE.Vector3(outer / 2 * Math.cos(i / 128 * Math.PI * 2), outer / 2 * Math.sin(i / 128 * Math.PI * 2), -width / 2 + width * n / 12));
      model.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial));
    }
    if (windings) {
      const count = Math.min(48, Math.max(1, Math.round(turns)));
      const baseRadius = Math.min((outer - inner) / 18, outer / 180);
      const clearance = baseRadius * 2;
      const riBase = Math.max(inner / 2 - clearance, baseRadius);
      const roBase = outer / 2 + clearance;
      const half = width / 2 + clearance;

      if (wireCount > 1) {
        // Multiple wires: each gauge gets a distinct color, strands are offset radially
        let wireIdx = 0;
        for (let ei = 0; ei < wireEntries.length; ei++) {
          const entry = wireEntries[ei];
          const color = WIRE_COLORS_3D[ei % WIRE_COLORS_3D.length];
          const mat = new THREE.MeshStandardMaterial({ color, metalness: .65, roughness: .27 });
          const strandRadius = baseRadius * 0.7;
          for (let w = 0; w < entry.count; w++) {
            const radialOffset = (wireIdx / wireCount - 0.5) * baseRadius * 2.2;
            for (let n = 0; n < count; n++) {
              const angle = n / count * Math.PI * 2;
              const ri = riBase + radialOffset;
              const ro = roBase + radialOffset;
              const point = (r: number, z: number) => new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
              const curve = new THREE.CatmullRomCurve3([
                point(ri, -half + clearance), point(ri + clearance, -half), point(ro - clearance, -half), point(ro, -half + clearance),
                point(ro, half - clearance), point(ro - clearance, half), point(ri + clearance, half), point(ri, half - clearance),
              ], true, 'centripetal');
              model.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, strandRadius, 6, true), mat));
            }
            wireIdx++;
          }
        }
      } else {
        // Single wire: original behavior
        const copper = new THREE.MeshStandardMaterial({ color: 0xf0a45e, metalness: .65, roughness: .27 });
        const ri = riBase;
        const ro = roBase;
        for (let n = 0; n < count; n++) {
          const angle = n / count * Math.PI * 2;
          const point = (r: number, z: number) => new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
          const curve = new THREE.CatmullRomCurve3([
            point(ri, -half + clearance), point(ri + clearance, -half), point(ro - clearance, -half), point(ro, -half + clearance),
            point(ro, half - clearance), point(ro - clearance, half), point(ri + clearance, half), point(ri, half - clearance),
          ], true, 'centripetal');
          model.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, baseRadius, 6, true), copper));
        }
      }
    }
    scene.add(new THREE.HemisphereLight(0xdaf9ff, 0x29445a, 3));
    const key = new THREE.DirectionalLight(0xffffff, 4);
    key.position.set(outer, outer, outer * 2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x58dacb, 3);
    rim.position.set(-outer, 0, -outer);
    scene.add(rim);
    const size = Math.max(outer, width);
    const camera = new THREE.PerspectiveCamera(36, 1, size / 1000, size * 30);
    const initial = new THREE.Vector3(size * 1.25, size * .85, size * 1.65);
    camera.position.copy(initial);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = size * .85;
    controls.maxDistance = size * 5;
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const lost = (event: Event) => { event.preventDefault(); setUnavailable(true); };
    renderer.domElement.addEventListener('webglcontextlost', lost);
    controls.update();
    resize();
    host.dataset.modelReady = 'true';
    actions.current = {
      reset: () => { camera.position.copy(initial); controls.target.set(0, 0, 0); controls.update(); render(); },
      rotate: direction => { camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), direction * Math.PI / 12); controls.update(); render(); },
      zoom: factor => { camera.position.multiplyScalar(factor).clampLength(controls.minDistance, controls.maxDistance); controls.update(); render(); },
    };
    return () => {
      actions.current = null;
      delete host.dataset.modelReady;
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      const materials = new Set<THREE.Material>();
      model.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
        }
      });
      materials.forEach(material => material.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [inner, outer, width, turns, windings, valid, wireCount]);

  if (!valid) return null;
  const scale = 152 / Math.max(option.inputs.finishedOdMm, outer);
  const ro = outer * scale / 2;
  const ri = inner * scale / 2;
  const fo = option.inputs.finishedOdMm * scale / 2;
  const fi = option.inputs.finishedIdMm * scale / 2;
  const sideScale = Math.min(scale, 110 / width);
  const sideW = width * sideScale;
  const sideH = outer * sideScale;
  const dimension = (x1: number, x2: number, y: number, text: string) => <g fill="currentColor" stroke="currentColor" strokeWidth=".8">
    <path d={`M${x1} ${y-6}v12 M${x2} ${y-6}v12 M${x1} ${y}H${x2}`} markerStart={`url(#${id}-arrow)`} markerEnd={`url(#${id}-arrow)`}/>
    <text x={(x1+x2)/2} y={y-9} textAnchor="middle" stroke="none" fontSize="11">{text}</text>
  </g>;

  // Wire cross-section dots in the front view annulus
  const wireRadius = Math.min((ro - ri) * 0.12, 4);
  const midR = (ri + ro) / 2;

  return <div className="design-views" data-selected-model={`${option.gradeCode}:${option.swg}`}>
    <Card title="Dimensioned diagram" subtitle={`${option.gradeLabel} · ${wireLabel}`} actions={<div className="flex gap-2">
      <Button size="xs" onClick={() => openPrintSheet(option)}>Download PDF</Button>
      <Button size="xs" onClick={() => {
        if (!drawing.current) return;
        const clone = drawing.current.cloneNode(true) as SVGSVGElement;
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.style.color = '#173e48';
        download(new XMLSerializer().serializeToString(clone), `${filename}-diagram.svg`, 'image/svg+xml');
      }}>Download SVG</Button>
    </div>}>
      <div className="drawing-stage">
        <svg ref={drawing} viewBox="0 0 520 340" role="img" aria-label={`Core diagram: ID ${mm(inner)}, OD ${mm(outer)}, ordered width ${mm(width)} millimetres`}>
          <title>{`${option.gradeLabel} · ${wireLabel}`} — core dimensions in millimetres</title>
          <defs><marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M10 5L0 0v10Z" fill="currentColor"/></marker></defs>
          <g fill="none" stroke="currentColor">
            <circle cx="145" cy="165" r={ro} fill="#65c7b9" fillOpacity=".18" strokeWidth="1.5"/>
            <circle cx="145" cy="165" r={ri} fill="#9eb7bf" fillOpacity=".1" strokeWidth="1.5"/>
            <g strokeDasharray="4 4" opacity=".45"><circle cx="145" cy="165" r={fo}/><circle cx="145" cy="165" r={fi}/></g>
            <path d="M45 165H245 M145 65V265" strokeDasharray="8 4 2 4" opacity=".4"/>
            <rect x={365-sideW/2} y={165-sideH/2} width={sideW} height={sideH} fill="#65c7b9" fillOpacity=".18" strokeWidth="1.5"/>
            <path d={`M${365-sideW/2} ${165-inner*sideScale/2}h${sideW} M${365-sideW/2} ${165+inner*sideScale/2}h${sideW}`} strokeDasharray="4 4"/>
          </g>
          {/* Wire cross-sections in the annulus for wire combinations */}
          {wireCount > 1 && (() => {
            const dots: React.ReactElement[] = [];
            let globalIdx = 0;
            wireEntries.forEach((entry, ei) => {
              const color = WIRE_COLORS_SVG[ei % WIRE_COLORS_SVG.length];
              for (let w = 0; w < entry.count; w++) {
                const topAngle = -Math.PI / 2 + (globalIdx / wireCount) * Math.PI * 0.6 - Math.PI * 0.3;
                const bottomAngle = Math.PI / 2 + (globalIdx / wireCount) * Math.PI * 0.6 - Math.PI * 0.3;
                dots.push(
                  <circle key={`t${globalIdx}`} cx={145 + Math.cos(topAngle) * midR} cy={165 + Math.sin(topAngle) * midR} r={wireRadius} fill={color} fillOpacity=".85" stroke={color} strokeWidth=".5"/>,
                  <circle key={`b${globalIdx}`} cx={145 + Math.cos(bottomAngle) * midR} cy={165 + Math.sin(bottomAngle) * midR} r={wireRadius} fill={color} fillOpacity=".85" stroke={color} strokeWidth=".5"/>,
                );
                globalIdx++;
              }
            });
            return dots;
          })()}
          {dimension(145-ro,145+ro,55,`Core OD ⌀ ${mm(outer)}`)}
          {dimension(145-ri,145+ri,165,`ID ⌀ ${mm(inner)}`)}
          {dimension(365-sideW/2,365+sideW/2,55,`Width ${mm(width)}`)}
          <g fill="currentColor" fontFamily="system-ui, sans-serif" fontSize="11" textAnchor="middle">
            <text x="145" y="277">FRONT VIEW</text><text x="365" y="277">SIDE VIEW · CORE</text>
            <text x="260" y="305">Finished ID / OD: {mm(option.inputs.finishedIdMm)} / {mm(option.inputs.finishedOdMm)} mm (dashed)</text>
            <text x="260" y="325">All dimensions in mm · Width is the ordered slit width</text>
          </g>
        </svg>
      </div>
      {/* Wire combination legend below diagram */}
      {wireCount > 1 && (
        <div className="flex items-center gap-3 px-4 pb-3 text-xs">
          {wireEntries.map((entry, i) => (
            <span key={entry.swg} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: WIRE_COLORS_SVG[i % WIRE_COLORS_SVG.length] }}/>
              {entry.count}×SWG {entry.swg}
            </span>
          ))}
        </div>
      )}
      <p className="p-4 pt-0 text-xs text-[var(--text-2)]">Steel core geometry. Dashed circles show the specified finished diameters.{wireCount > 1 ? ' Coloured dots show the wire cross-section arrangement (illustrative).' : ''} Finished axial width, terminals and mould details are not specified.</p>
    </Card>
    <Card title="Interactive 3D model" subtitle={`${option.gradeLabel} · ${wireLabel}`} actions={<Button size="xs" onClick={() => {
      const geometry = coreGeometry(inner, outer, width);
      const material = new THREE.MeshBasicMaterial();
      const mesh = new THREE.Mesh(geometry, material);
      download(new STLExporter().parse(mesh), `${filename}-core-mm.stl`, 'model/stl');
      geometry.dispose(); material.dispose();
    }}>Export core STL</Button>}>
      <div className="model-stage" ref={container}>
        {unavailable && <div className="absolute inset-0 z-10 grid place-items-center bg-[#0d1722] p-8 text-center text-sm text-white">3D rendering is unavailable in this browser. The dimensioned diagram and core STL export are still available.</div>}
        <div className="pointer-events-none absolute left-4 top-4 text-[11px] tracking-wider text-[#b6d8df]">{mm(inner)} ID × {mm(outer)} OD × {mm(width)} W mm</div>
        <div className="pointer-events-none absolute bottom-4 left-4 text-xs text-[#b6d8df]">Drag to orbit · Scroll / pinch to zoom</div>
      </div>
      <div className="model-toolbar">
        <Button size="xs" onClick={() => actions.current?.rotate(-1)} disabled={unavailable}>Rotate left</Button>
        <Button size="xs" onClick={() => actions.current?.rotate(1)} disabled={unavailable}>Rotate right</Button>
        <Button size="xs" onClick={() => actions.current?.zoom(.85)} disabled={unavailable}>Zoom in</Button>
        <Button size="xs" onClick={() => actions.current?.zoom(1.18)} disabled={unavailable}>Zoom out</Button>
        <Button size="xs" onClick={() => actions.current?.reset()} disabled={unavailable}>Reset view</Button>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={windings} onChange={e => setWindings(e.target.checked)}/>Show illustrative winding</label>
      </div>
      {/* Wire color legend for 3D model */}
      {wireCount > 1 && windings && (
        <div className="flex items-center gap-3 px-4 pb-2 text-xs">
          {wireEntries.map((entry, i) => (
            <span key={entry.swg} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: WIRE_COLORS_SVG[i % WIRE_COLORS_SVG.length] }}/>
              {entry.count}×SWG {entry.swg}
            </span>
          ))}
        </div>
      )}
      <p className="px-4 pb-4 text-xs text-[var(--text-2)]">{turns} calculated secondary turns.{wireCount > 1 ? ` ${wireCount} parallel wires shown in distinct colours.` : ''} Copper loops and lamination lines are representative; wire diameter and routing are not manufacturing geometry. STL contains the steel core only, in mm.</p>
    </Card>
  </div>;
}
