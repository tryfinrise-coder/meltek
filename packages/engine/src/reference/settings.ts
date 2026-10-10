import type { ProcessSettings } from '../types.js';

/**
 * Default process settings (§5.1).
 *
 * NOTHING here may be hardcoded at a call site. The running system loads these from
 * the `process_setting` table, each row carrying `isConfirmed` — false meaning the row
 * still holds the shipped default rather than a value set for this works.
 */
export const DEFAULT_SETTINGS: ProcessSettings = {
  resinCoverMm: 3,
  windingAllowanceMm: 9,
  lengthFactor: 1.2,
  leadWireMm: 40,
  testMarginFactor: 0.95,
  stackingFactor: 0.95,
  steelDensity: 7.65,
  saturationCapTesla: 0.65,
  saturationTriggerTesla: 1.0,
  frequencyHz: 50,
  maxIterations: 20,
  convergenceTolerance: 2e-5,
  slitStepMm: 5,
  plusFiveAbove400A: false,
  wireInsulationMm: 0,
  interLayerTapeMm: 0,
  windingPackingFactor: 0,
};

export interface SettingMeta {
  key: keyof ProcessSettings;
  unit: string;
  label: string;
  /**
   * false = still the shipped default. The admin screen marks these so an engineer can
   * see at a glance which numbers have been set for this works and which have not.
   * The open questions behind each one are recorded in §12 of the build brief.
   */
  isConfirmed: boolean;
  sourceNote: string;
}

/** Drives the settings screen and the setup checklist in the header. */
export const SETTING_META: readonly SettingMeta[] = [
  { key: 'resinCoverMm', unit: 'mm', label: 'Resin cover (fallback)', isConfirmed: false,
    sourceNote: 'Fallback resin cover. The engine uses a turns-dependent rule: 4 mm for up to 100 turns, 6 mm for up to 200 turns, and the larger of this setting or 6 mm above 200 turns.' },
  { key: 'windingAllowanceMm', unit: 'mm', label: 'Winding allowance', isConfirmed: false,
    sourceNote: 'Radial space reserved for the secondary winding, entered by hand. It depends on turns, wire selection, interlayer insulation and minimum epoxy thickness; once those tables are entered this can be calculated instead.' },
  { key: 'lengthFactor', unit: '—', label: 'Wire length factor', isConfirmed: false,
    sourceNote: 'Allowance for crossover as the wire is wound. 1.2 adds 20% to the bare turn length.' },
  { key: 'leadWireMm', unit: 'mm', label: 'Lead wire', isConfirmed: true,
    sourceNote: 'Tail left at each end for termination — 20 mm a side.' },
  { key: 'testMarginFactor', unit: '—', label: 'Test margin factor', isConfirmed: true,
    sourceNote: 'Deliberate safety margin on the error budget, because external test rigs read slightly differently from the works rig. 0.95 designs to sit inside the limit.' },
  { key: 'stackingFactor', unit: '—', label: 'Stacking factor', isConfirmed: true,
    sourceNote: 'Wound strip is roughly 5% air and varnish rather than steel.' },
  { key: 'steelDensity', unit: 'g/cm³', label: 'Steel density', isConfirmed: true,
    sourceNote: 'Density of grain-oriented silicon steel, used for core weight.' },
  { key: 'saturationCapTesla', unit: 'T', label: 'Flux ceiling', isConfirmed: true,
    sourceNote: 'Flux density the core is sized at once the ceiling applies. Applies to every grade, so no core saturates below roughly 2 to 2.5 times the working voltage.' },
  { key: 'saturationTriggerTesla', unit: 'T', label: 'Flux ceiling trigger', isConfirmed: false,
    sourceNote: 'Flux density above which the ceiling takes over from the B-H curve. Review this against your own saturation testing.' },
  { key: 'frequencyHz', unit: 'Hz', label: 'Supply frequency', isConfirmed: true,
    sourceNote: 'Used in the transformer equation. 50 Hz across India.' },
  { key: 'maxIterations', unit: 'passes', label: 'Iteration limit', isConfirmed: false,
    sourceNote: 'How many passes the core size may take to settle before the calculation gives up. It normally settles in 6 to 9.' },
  { key: 'convergenceTolerance', unit: 'V', label: 'Settling tolerance', isConfirmed: false,
    sourceNote: 'How close two successive passes must be before the core size counts as settled.' },
  { key: 'slitStepMm', unit: 'mm', label: 'Slit rounding step', isConfirmed: false,
    sourceNote: 'Used only while no stocked slit widths are on record. Enter your widths under Reference data and the calculation rounds to a width you actually buy.' },
  { key: 'plusFiveAbove400A', unit: 'flag', label: 'Extra 5-turn margin above 400 A', isConfirmed: false,
    sourceNote: 'Adds five secondary turns on designs above 400 A primary. Off by default: the flux ceiling already guards against saturation, and switching both on makes every large core wider than the calculation requires.' },
  { key: 'wireInsulationMm', unit: 'mm', label: 'Wire insulation per side', isConfirmed: false,
    sourceNote: 'Enamel insulation thickness added to each side of the bare wire diameter to get the insulated diameter used in winding build calculations.' },
  { key: 'interLayerTapeMm', unit: 'mm', label: 'Interlayer tape thickness', isConfirmed: false,
    sourceNote: 'Tape or insulation placed between winding layers. Used when computing the winding build from the actual wire geometry.' },
  { key: 'windingPackingFactor', unit: '—', label: 'Winding packing factor', isConfirmed: false,
    sourceNote: 'How tightly the wire packs in each layer — 1.0 is perfect packing, 0.9 allows 10% extra space for crossover and irregularity.' },
];
