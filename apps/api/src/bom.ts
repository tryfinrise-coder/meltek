import { randomUUID } from 'node:crypto';
import type { ReferenceData } from '@meltek/engine';
import type { BomLine, Design, StoredOption } from './store/index.js';

/**
 * Bill of materials for the selected option (§7 design_bom, §11.3).
 *
 * Quantities are per unit. Every line derives from the §5.9 reconstruction and is
 * therefore provisional until the client signs off on the costing block.
 */
export function buildBom(design: Design, option: StoredOption, ref: ReferenceData): BomLine[] {
  const engineering = design.inputs.engineering;
  const grade = ref.grades.find((g) => g.code === option.gradeCode);
  const gauge = ref.gauges.find((g) => g.swg === option.swg);
  const orderedLength = gauge && gauge.gramPerM > 0 ? option.copperWeightKg * 1000 / gauge.gramPerM : option.wireLengthM;
  const line = (
    itemType: BomLine['itemType'], itemRef: string | null,
    description: string, quantity: number, unit: string,
  ): BomLine => ({ id: randomUUID(), designId: design.id, itemType, itemRef, description, quantity, unit });

  return [
    line('core', option.gradeCode,
      `${grade?.label ?? option.gradeCode} strip, ${option.orderedWidthMm} mm slit width, core ${option.geometry.coreIdMm.toFixed(1)}/${option.geometry.coreOdMm.toFixed(1)} mm`,
      round(option.coreWeightKg, 4), 'kg'),
    line('copper', `SWG ${option.swg}`,
      `Enamelled copper wire SWG ${option.swg}, ${option.geometry.turns} turns × ${engineering?.parallelStrands ?? 1} strand(s), ${round(orderedLength, 3)} m total at ordered width`,
      round(option.copperWeightKg, 4), 'kg'),
    line('insulation', null,
      engineering ? `${engineering.coreInsulation.type}, ${engineering.coreInsulation.thicknessMm} mm per side; interlayer ${engineering.interlayerType}, ${engineering.interlayerThicknessMm} mm` : 'Interlayer insulation, per winding specification', 1, 'set'),
    line('resin', null,
      `${engineering?.outerInsulation.type ?? 'Cast epoxy resin'} body, finished ${design.inputs.finishedIdMm}/${design.inputs.finishedOdMm} mm`,
      1, 'set'),
  ];
}

/** §12.12 - the inventory integration is an interface; CSV is the shipped implementation. */
export function bomToCsv(design: Design, lines: BomLine[]): string {
  const head = ['design_no', 'revision', 'customer', 'item_type', 'item_ref', 'description', 'quantity', 'unit'];
  const rows = lines.map((l) => [
    design.designNo, String(design.revision), design.customerName,
    l.itemType, l.itemRef ?? '', l.description, String(l.quantity), l.unit,
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

const csvCell = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const round = (n: number, dp: number): number => Number(n.toFixed(dp));
