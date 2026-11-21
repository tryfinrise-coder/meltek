import * as XLSX from 'xlsx';
import { MIN_SATURATION_FACTOR, saturationFactor, type SolveResult, type SteelGrade } from '@meltek/engine';

const SECTIONS: { title: string; keys: string[] }[] = [
  { title: 'GEOMETRY & INPUTS', keys: ['turns', 'allowance', 'coreId', 'coreOd', 'radialBuild'] },
  { title: 'ELECTRICAL CALCULATION', keys: ['burdenVoltage', 'atLoss', 'mml', 'h', 'bRaw', 'bUsed', 'area', 'width'] },
  { title: 'COSTING ESTIMATES', keys: ['orderedWidth', 'coreWeight', 'copperWeight', 'cost'] },
];

/** Plain-language meaning of each calculation step, shown beside the numbers. */
const MEANING: Record<string, string> = {
  turns: 'Turns on the secondary winding. One primary turn carries the full primary current, so turns = primary ÷ secondary current.',
  allowance: 'Space taken on the diameter by core insulation, the winding layers and the resin cover. It is removed from the finished size to find the bare core.',
  coreId: 'Inner diameter of the bare steel core: finished ID plus the allowance.',
  coreOd: 'Outer diameter of the bare steel core before width rounding: finished OD minus the allowance.',
  radialBuild: 'Wall thickness of the steel ring: half the difference between core OD and core ID.',
  burdenVoltage: 'Voltage the CT must deliver to the connected burden at rated secondary current: VA ÷ secondary current.',
  atLoss: 'Ampere-turns the core is allowed to use for magnetising. It is the accuracy class error limit applied to the primary ampere-turns.',
  mml: 'Mean magnetic length: the average path the flux travels round the ring, through the middle of the wall.',
  h: 'Magnetising force available per centimetre of path: AT loss ÷ mean magnetic length.',
  bRaw: 'Flux density the steel reaches at that magnetising force, read from the grade B–H curve.',
  bUsed: 'Flux density the core is sized for. If the curve value is above the trigger, the lower ceiling value is used to keep the core well away from saturation.',
  area: 'Steel cross-section needed to produce the total voltage at the flux density used. Repeated until the voltage stops changing (see the Convergence sheet).',
  width: 'Exact strip width that gives the required area with the available wall thickness: area ÷ radial build.',
  orderedWidth: 'Strip is bought in fixed steps. The width goes down to the lower step only when it is within the tolerance; inside the tolerance the step with width : build-up nearer 2 : 1 is taken. Otherwise it goes up. The core OD is then adjusted so the area stays the same.',
  coreWeight: 'Weight of steel: area × mean magnetic length × steel density × stacking factor.',
  copperWeight: 'Weight of the secondary wire: wire length × weight per metre of the gauge.',
  cost: 'Steel weight × steel rate plus copper weight × copper rate. Labour, resin and overheads are not included.',
};

export function exportCalcChain(result: SolveResult, gradeLabel: string, grade?: SteelGrade, frequencyHz = 50) {
  const sat = grade ? saturationFactor({ curve: grade.curve, turns: result.geometry.turns, areaCm2: result.finalAreaCm2, workingVoltageV: result.vTotal, frequencyHz }) : null;
  const satVerdict = sat ? (sat.factor >= MIN_SATURATION_FACTOR ? 'Pass' : 'Below minimum') : 'Not available';
  const k = sat ? sat.saturationVoltageV / (result.geometry.turns * sat.saturationFluxT * result.finalAreaCm2) : 0;
  const ratio = result.geometry.radialBuildMm > 0 ? result.orderedWidthMm / result.geometry.radialBuildMm : 0;
  const wb = XLSX.utils.book_new();

  // ─── Sheet 1: Calculation Chain ───
  const chainRows: (string | number)[][] = [
    ['MELTEK — CT Core Design Calculation Chain'],
    [],
    ['Grade', gradeLabel, '', 'Wire', result.wireCombinationLabel || `SWG ${result.swg}`],
    ...(result.wireCombination
      ? result.wireCombination.map(e => ['', '', '', `  SWG ${e.swg}`, `${e.count} strand${e.count > 1 ? 's' : ''}`])
      : []),
    [],
  ];

  const grouped = SECTIONS.map(sec => ({
    ...sec,
    steps: result.steps.filter(s => sec.keys.includes(s.key)),
  })).filter(sec => sec.steps.length > 0);

  for (const sec of grouped) {
    chainRows.push([sec.title]);
    chainRows.push(['Step', 'Calculation', 'Formula', 'Substituted', 'Value', 'Unit', 'Notes', 'What it means']);
    for (const s of sec.steps) {
      chainRows.push([
        s.step,
        s.label,
        s.formula,
        s.substituted,
        typeof s.value === 'number' ? s.value : s.value,
        s.unit,
        s.note ?? '',
        MEANING[s.key] ?? '',
      ]);
    }
    chainRows.push([]);
  }

  chainRows.push(['CHECKS ON THE FINAL CORE']);
  chainRows.push(['Step', 'Calculation', 'Formula', 'Substituted', 'Value', 'Unit', 'Notes', 'What it means']);
  chainRows.push(['A', 'Width : build-up', 'rounded core width ÷ radial build after rounding',
    `${result.orderedWidthMm} / ${result.geometry.radialBuildMm.toFixed(2)}`, ratio, ': 1', ratio > 2 ? 'Above 2 : 1 — tall, thin core.' : '',
    'Shape of the steel cross-section. About 2 : 1 is the target; a much higher value is a tall, thin ring that is harder to wind evenly.']);
  if (sat) {
    chainRows.push(['B', 'Saturation voltage', '4.44 × f × N × B saturation × area',
      `${Number(k.toPrecision(4))} x ${result.geometry.turns} x ${sat.saturationFluxT} x ${result.finalAreaCm2.toFixed(4)}`, sat.saturationVoltageV, 'V',
      `B saturation = ${sat.saturationFluxT} T, the highest point on the ${gradeLabel} B–H curve.`,
      'Voltage at which the finished core would be fully saturated.']);
    chainRows.push(['C', 'Saturation factor', 'saturation voltage ÷ final working voltage',
      `${sat.saturationVoltageV.toFixed(2)} / ${result.vTotal.toFixed(2)}`, sat.factor, '',
      `${satVerdict}. Minimum ${MIN_SATURATION_FACTOR}.`,
      `Headroom between the working voltage and saturation. Turns and area cancel, so it equals B saturation ÷ B used (${sat.saturationFluxT} ÷ ${result.bUsedT.toFixed(4)}). It must be at least ${MIN_SATURATION_FACTOR}.`]);
  }
  chainRows.push([]);

  const wsChain = XLSX.utils.aoa_to_sheet(chainRows);
  wsChain['!cols'] = [
    { wch: 8 },   // Step
    { wch: 28 },  // Calculation
    { wch: 32 },  // Formula
    { wch: 40 },  // Substituted
    { wch: 16 },  // Value
    { wch: 10 },  // Unit
    { wch: 50 },  // Notes
    { wch: 90 },  // What it means
  ];
  XLSX.utils.book_append_sheet(wb, wsChain, 'Calculation Chain');

  // ─── Sheet 2: Convergence ───
  const convRows: (string | number)[][] = [
    ['CONVERGENCE TABLE'],
    [],
    ['How convergence works:'],
    ['The solver iterates to find the correct core size. Pass 1 starts with the burden voltage alone.'],
    ['Each pass calculates: area → width → wire length → resistance → voltage drop → new total voltage.'],
    ['The new total voltage (V out) feeds back as V in for the next pass. When the change (Δ) falls'],
    ['below the settling tolerance (~0.00002 V), the calculation has converged and stops.'],
    [],
    ['Passes', result.passes, '', 'Converged', result.converged ? 'Yes' : 'No'],
    ['Final V', result.vTotal, '', 'Wire drop', result.vDrop, 'V'],
    [],
    ['Pass', 'V in', 'Area cm²', 'Width mm', 'Wire m', 'R Ω', 'V drop', 'V out', 'Δ'],
  ];
  for (const it of result.iterations) {
    convRows.push([
      it.pass, it.vIn, it.areaCm2, it.widthCm * 10, it.lengthM,
      it.resistanceOhm, it.vDrop, it.vNext, it.delta,
    ]);
  }
  convRows.push([]);
  convRows.push(['Column explanations:']);
  convRows.push(['Pass', 'Iteration number — each pass refines the core size by recalculating area, width, wire and resistance.']);
  convRows.push(['V in', 'Voltage fed into this pass. Pass 1 = burden voltage only; later passes add the wire drop from the previous pass.']);
  convRows.push(['Area cm²', 'Core cross-sectional area. Formula: A = V / (4.44 × f × N × B).']);
  convRows.push(['Width mm', 'Core strip width. Formula: area ÷ radial build.']);
  convRows.push(['Wire m', 'Total secondary wire length. Formula: mean turn length × number of turns.']);
  convRows.push(['R Ω', 'Winding DC resistance at 20 °C. Formula: resistivity × wire length ÷ wire cross-section.']);
  convRows.push(['V drop', 'Voltage drop across the winding. Formula: secondary current × resistance.']);
  convRows.push(['V out', 'New total voltage = burden voltage + V drop. This becomes V in for the next pass.']);
  convRows.push(['Δ', 'Delta — how much V changed from the previous pass. Converges when Δ < settling tolerance.']);

  const wsConv = XLSX.utils.aoa_to_sheet(convRows);
  wsConv['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsConv, 'Convergence');

  // ─── Sheet 3: Summary ───
  const summaryRows: (string | number)[][] = [
    ['DESIGN SUMMARY'],
    [],
    ['Parameter', 'Value', 'Unit', 'Explanation'],
    ['Grade', gradeLabel, '', 'Steel grade / material used for the core.'],
    ['Wire', result.wireCombinationLabel || `SWG ${result.swg}`, '', 'Wire gauge or combination used for the secondary winding.'],
    ...(result.wireCombination
      ? result.wireCombination.map(e => [`  SWG ${e.swg}`, `${e.count} strand${e.count > 1 ? 's' : ''}`, '', 'Individual strand in the wire combination.'])
      : []),
    [],
    ['GEOMETRY'],
    ['Finished ID', result.inputs.finishedIdMm, 'mm', 'Customer-specified inner diameter of the finished CT.'],
    ['Finished OD', result.inputs.finishedOdMm, 'mm', 'Customer-specified outer diameter of the finished CT.'],
    ['Core ID', result.geometry.coreIdMm, 'mm', 'Inner diameter of the bare core after subtracting insulation and winding allowances from the finished ID.'],
    ['Core OD', result.geometry.coreOdMm, 'mm', 'Outer diameter of the bare core after subtracting insulation from the finished OD.'],
    ['Allowance', result.geometry.allowanceMm, 'mm', 'Total radial space reserved for insulation, winding build and resin on both sides of the bore.'],
    ['Radial Build', result.geometry.radialBuildMm, 'mm', 'Thickness of the core steel: (Core OD − Core ID) / 2.'],
    ['Winding Build', result.geometry.windingBuildMm, 'mm', 'Total radial thickness of all winding layers on one side of the core.'],
    ['Winding Layers', result.geometry.windingLayers, '', 'Number of concentric winding layers around the core bore.'],
    ['Turns per Layer', result.geometry.turnsPerLayer, '', 'How many secondary turns fit in one layer around the bore circumference.'],
    ['Secondary Turns', result.geometry.turns, '', 'Total number of secondary winding turns (= primary current ÷ secondary current).'],
    [],
    ['PHYSICAL PROPERTIES'],
    ['Core Width (calculated)', result.coreWidthMm, 'mm', 'Exact strip width from the calculation, before rounding to a standard strip width.'],
    ['Ordered Width', result.orderedWidthMm, 'mm', 'Calculated width rounded to a standard strip step. The core OD is adjusted so the steel area stays the same.'],
    ['Width : Build-up', ratio, ': 1', 'Ordered width ÷ radial build. About 2 : 1 is the target; much higher means a tall, thin core.'],
    ['Core Area', result.finalAreaCm2 * 100, 'mm²', 'Net iron cross-sectional area after stacking factor — the area carrying flux.'],
    ['Core Volume', result.coreVolumeCm3, 'cm³', 'Volume of steel in the wound core, used for weight calculation.'],
    ['Core Weight', result.coreWeightKg, 'kg', 'Weight of the steel core = volume × steel density × stacking factor.'],
    ['Copper Weight', result.copperWeightKg, 'kg', 'Weight of the secondary copper winding.'],
    ['Wire Length', result.wireLengthM, 'm', 'Total length of secondary wire across all strands.'],
    ['Resistance', result.resistanceOhm, 'Ω', 'DC winding resistance at 20 °C reference temperature.'],
    [],
    ['ELECTRICAL'],
    ['Burden Voltage', result.burdenVoltage, 'V', 'Voltage the CT must develop across the rated burden at rated secondary current.'],
    ['AT Loss', result.atLoss, 'AT', 'Ampere-turns the accuracy class allows the core to use for magnetising.'],
    ['H', result.h, 'AT/cm', 'Magnetising force per centimetre at the working flux density, from the B–H curve.'],
    ['B (raw)', result.bRawT, 'T', 'Flux density read from the grade B–H curve at the available magnetising force, before any ceiling is applied.'],
    ['B (used)', result.bUsedT, 'T', 'Actual flux density used — equals B(raw) unless a flux ceiling was applied.'],
    ['Flux Ceiling Applied', result.wasCapped ? 'Yes' : 'No', '', 'Whether the raw flux exceeded the material\'s ceiling and was capped.'],
    ['Final Working Voltage', result.vTotal, 'V', 'Burden voltage plus the voltage dropped in the winding resistance. The core is sized for this voltage.'],
    ['Saturation Voltage', sat ? sat.saturationVoltageV : 'N/A', 'V', sat ? `Voltage at which the core saturates: 4.44 × frequency × turns × ${sat.saturationFluxT} T × core area.` : 'Needs the B–H curve of the grade.'],
    ['Saturation Factor', sat ? sat.factor : 'N/A', '', `Saturation voltage ÷ final working voltage. Must be at least ${MIN_SATURATION_FACTOR}.`],
    ['Saturation Check', satVerdict, '', 'Pass when the saturation factor is at or above the minimum.'],
    [],
    ['COSTING'],
    ['Core Cost', result.coreCost ?? 'N/A', '₹', 'Steel cost = core weight × steel rate per kg.'],
    ['Copper Cost', result.copperCost, '₹', 'Copper cost = copper weight × copper rate per kg.'],
    ['Total Cost', result.totalCost ?? 'N/A', '₹', 'Combined material cost: core + copper. Labour, resin and overheads are not included.'],
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 10 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // ─── Sheet 4: Engineering (if available) ───
  if (result.engineering) {
    const r = result.engineering;
    const engRows: (string | number | null)[][] = [
      ['ENGINEERING SCREENING'],
      [],
      ['Parameter', 'Value', 'Unit', 'Explanation'],
      ['Winding Layers', r.layers, '', 'Number of concentric winding layers around the core.'],
      ['Turns per Layer', r.turnsPerLayer, '', 'Secondary turns divided equally across the winding layers.'],
      ['Radial Winding Build', r.windingBuildMm, 'mm', 'Total thickness of all winding layers on one side of the core.'],
      ['Finished Axial Width', r.finishedWidthMm, 'mm', 'Core strip width plus any insulation overhang — the final CT width.'],
      ['Wire per Strand', r.wireLengthPerStrandM, 'm', 'Length of wire for one parallel strand of the secondary winding.'],
      ['Total Wire', r.totalWireLengthM, 'm', 'Total wire across all parallel strands, including practical additions.'],
      ['Resistance at 20°C', r.resistance20Ohm, 'Ω', 'DC winding resistance at the standard 20 °C reference temperature.'],
      ['Resistance at Room Temp', r.resistanceRoomOhm, 'Ω', 'Winding resistance adjusted to typical ambient (~25 °C).'],
      ['Resistance at 75°C', r.resistance75Ohm, 'Ω', 'Winding resistance at the rated thermal limit — worst-case burden contribution.'],
      ['Operating Resistance', r.resistanceOperatingOhm, 'Ω', 'Resistance at the expected operating temperature used in accuracy checks.'],
      ['Effective Steel Area', r.effectiveAreaCm2, 'cm²', 'Net iron cross-section after stacking factor — the area carrying flux.'],
      ['Working Flux', r.operatingFluxT, 'T', 'Flux density the core operates at under rated burden and current.'],
      ['Required Design Voltage', r.voltageAtLimit, 'V', 'Secondary voltage the CT must sustain at rated burden without exceeding the error limit.'],
      ['Characterised Saturation Voltage', r.saturationVoltage, 'V', 'Voltage at which the core reaches its characterised saturation knee from the B–H curve.'],
      ['Estimated Knee Voltage', r.kneeVoltage, 'V', 'Knee-point voltage (Vk) — the point where a 10% voltage increase causes a 50% excitation current increase.'],
      ['Area from Specified Vk', r.areaFromKneeCm2, 'cm²', 'Minimum core area needed to achieve the specified knee-point voltage.'],
      ['Area from PS Resistance Formula', r.areaFromResistanceCm2, 'cm²', 'Core area derived from the protection-class resistance formula.'],
      ['Exciting Current at Check Voltage', r.excitationCurrentA, 'A', 'Magnetising current drawn by the core at the accuracy-check voltage.'],
      ['Working Excitation', r.excitationAtCm, 'AT/cm', 'Magnetising force the core needs at the working flux density.'],
      ['Composite Error Estimate', r.compositeErrorEstimatePercent, '%', 'Estimated total error combining ratio error and phase displacement — must stay within the accuracy class limit.'],
      ['Steel + Copper Including Waste', r.materialCost, '₹', 'Raw material cost: (steel weight × steel rate) + (copper weight × copper rate) + wastage allowance.'],
      ['Manufacturing Cost', r.manufacturingCost, '₹', 'Full cost including insulation, resin, labour, overhead and wastage.'],
    ];

    if (r.issues.length > 0) {
      engRows.push([], ['ISSUES']);
      for (const issue of r.issues) {
        engRows.push([issue]);
      }
    }

    if (r.checks.length > 0) {
      engRows.push([], ['SCREENING CHECKS']);
      engRows.push(['Current %', 'Burden %', 'Ratio Error %', 'Phase Minutes', 'Result']);
      for (const c of r.checks) {
        engRows.push([
          c.currentPercent, c.burdenPercent,
          c.ratioErrorPercent, c.phaseMinutes,
          c.passed === null ? 'Missing curve data' : c.passed ? 'Pass' : 'Fail',
        ]);
      }
    }

    const wsEng = XLSX.utils.aoa_to_sheet(engRows);
    wsEng['!cols'] = [{ wch: 36 }, { wch: 18 }, { wch: 10 }, { wch: 70 }];
    XLSX.utils.book_append_sheet(wb, wsEng, 'Engineering');
  }

  const filename = `Meltek_${gradeLabel}_${result.wireCombinationLabel || `SWG${result.swg}`}_Calc.xlsx`
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  XLSX.writeFile(wb, filename);
}
