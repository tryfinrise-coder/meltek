import * as XLSX from 'xlsx';
import type { SolveResult } from '@meltek/engine';

const SECTIONS: { title: string; keys: string[] }[] = [
  { title: 'GEOMETRY & INPUTS', keys: ['turns', 'allowance', 'coreId', 'coreOd', 'radialBuild'] },
  { title: 'ELECTRICAL CALCULATION', keys: ['burdenVoltage', 'atLoss', 'mml', 'h', 'bRaw', 'bUsed', 'area', 'width'] },
  { title: 'COSTING ESTIMATES', keys: ['orderedWidth', 'coreWeight', 'copperWeight', 'cost'] },
];

export function exportCalcChain(result: SolveResult, gradeLabel: string) {
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
    chainRows.push(['Step', 'Calculation', 'Formula', 'Substituted', 'Value', 'Unit', 'Notes']);
    for (const s of sec.steps) {
      chainRows.push([
        s.step,
        s.label,
        s.formula,
        s.substituted,
        typeof s.value === 'number' ? s.value : s.value,
        s.unit,
        s.note ?? '',
      ]);
    }
    chainRows.push([]);
  }

  const wsChain = XLSX.utils.aoa_to_sheet(chainRows);

  // Column widths
  wsChain['!cols'] = [
    { wch: 8 },   // Step
    { wch: 28 },  // Calculation
    { wch: 32 },  // Formula
    { wch: 40 },  // Substituted
    { wch: 16 },  // Value
    { wch: 10 },  // Unit
    { wch: 50 },  // Notes
  ];

  XLSX.utils.book_append_sheet(wb, wsChain, 'Calculation Chain');

  // ─── Sheet 2: Convergence ───
  const convRows: (string | number)[][] = [
    ['CONVERGENCE TABLE'],
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

  const wsConv = XLSX.utils.aoa_to_sheet(convRows);
  wsConv['!cols'] = Array(9).fill({ wch: 14 });
  XLSX.utils.book_append_sheet(wb, wsConv, 'Convergence');

  // ─── Sheet 3: Summary ───
  const summaryRows: (string | number)[][] = [
    ['DESIGN SUMMARY'],
    [],
    ['Parameter', 'Value', 'Unit'],
    ['Grade', gradeLabel, ''],
    ['Wire', result.wireCombinationLabel || `SWG ${result.swg}`, ''],
    ...(result.wireCombination
      ? result.wireCombination.map(e => [`  SWG ${e.swg}`, `${e.count} strand${e.count > 1 ? 's' : ''}`, ''])
      : []),
    [],
    ['Finished ID', result.inputs.finishedIdMm, 'mm'],
    ['Finished OD', result.inputs.finishedOdMm, 'mm'],
    ['Core ID', result.geometry.coreIdMm, 'mm'],
    ['Core OD', result.geometry.coreOdMm, 'mm'],
    ['Allowance', result.geometry.allowanceMm, 'mm'],
    ['Radial Build', result.geometry.radialBuildMm, 'mm'],
    ['Winding Build', result.geometry.windingBuildMm, 'mm'],
    ['Winding Layers', result.geometry.windingLayers, ''],
    ['Turns per Layer', result.geometry.turnsPerLayer, ''],
    ['Secondary Turns', result.geometry.turns, ''],
    [],
    ['Ordered Width', result.orderedWidthMm, 'mm'],
    ['Core Area', result.finalAreaCm2 * 100, 'mm²'],
    ['Core Volume', result.coreVolumeCm3, 'cm³'],
    ['Core Weight', result.coreWeightKg, 'kg'],
    ['Copper Weight', result.copperWeightKg, 'kg'],
    ['Wire Length', result.wireLengthM, 'm'],
    ['Resistance', result.resistanceOhm, 'Ω'],
    [],
    ['Burden Voltage', result.burdenVoltage, 'V'],
    ['AT Loss', result.atLoss, 'AT'],
    ['H', result.h, 'AT/cm'],
    ['B (raw)', result.bRawT, 'T'],
    ['B (used)', result.bUsedT, 'T'],
    ['Flux Ceiling Applied', result.wasCapped ? 'Yes' : 'No', ''],
    [],
    ['Core Cost', result.coreCost ?? 'N/A', '₹'],
    ['Copper Cost', result.copperCost, '₹'],
    ['Total Cost', result.totalCost ?? 'N/A', '₹'],
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // ─── Sheet 4: Engineering (if available) ───
  if (result.engineering) {
    const r = result.engineering;
    const engRows: (string | number | null)[][] = [
      ['ENGINEERING SCREENING'],
      [],
      ['Parameter', 'Value', 'Unit'],
      ['Winding Layers', r.layers, ''],
      ['Turns per Layer', r.turnsPerLayer, ''],
      ['Radial Winding Build', r.windingBuildMm, 'mm'],
      ['Finished Axial Width', r.finishedWidthMm, 'mm'],
      ['Wire per Strand', r.wireLengthPerStrandM, 'm'],
      ['Total Wire', r.totalWireLengthM, 'm'],
      ['Resistance at 20°C', r.resistance20Ohm, 'Ω'],
      ['Resistance at Room Temp', r.resistanceRoomOhm, 'Ω'],
      ['Resistance at 75°C', r.resistance75Ohm, 'Ω'],
      ['Operating Resistance', r.resistanceOperatingOhm, 'Ω'],
      ['Effective Steel Area', r.effectiveAreaCm2, 'cm²'],
      ['Working Flux', r.operatingFluxT, 'T'],
      ['Required Design Voltage', r.voltageAtLimit, 'V'],
      ['Characterised Saturation Voltage', r.saturationVoltage, 'V'],
      ['Estimated Knee Voltage', r.kneeVoltage, 'V'],
      ['Area from Specified Vk', r.areaFromKneeCm2, 'cm²'],
      ['Area from PS Resistance Formula', r.areaFromResistanceCm2, 'cm²'],
      ['Exciting Current at Check Voltage', r.excitationCurrentA, 'A'],
      ['Working Excitation', r.excitationAtCm, 'AT/cm'],
      ['Composite Error Estimate', r.compositeErrorEstimatePercent, '%'],
      ['Steel + Copper Including Waste', r.materialCost, '₹'],
      ['Manufacturing Cost', r.manufacturingCost, '₹'],
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
    wsEng['!cols'] = [{ wch: 36 }, { wch: 18 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, wsEng, 'Engineering');
  }

  const filename = `Meltek_${gradeLabel}_${result.wireCombinationLabel || `SWG${result.swg}`}_Calc.xlsx`
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  XLSX.writeFile(wb, filename);
}
