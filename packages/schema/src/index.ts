import { z } from 'zod';
import { engineeringSpecSchema } from './engineering.js';
export * from './engineering.js';

export * from './auth.js';

/**
 * @meltek/schema - zod schemas shared across the client/server boundary.
 * The web form and the API validate with the identical schema (§4).
 */

export const ctTypeSchema = z.enum(['ring', 'wound-primary']);

export const designInputsSchema = z
  .object({
    engineering: engineeringSpecSchema.nullable().optional(),
    primaryCurrent: z.number().positive('Primary current must be greater than zero.'),
    secondaryCurrent: z.number().positive('Secondary current must be greater than zero.'),
    burdenVA: z.number().positive('Burden must be greater than zero.'),
    accuracyClass: z.string().min(1, 'Choose an accuracy class.'),
    finishedIdMm: z.number().positive('Finished ID must be greater than zero.'),
    finishedOdMm: z.number().positive('Finished OD must be greater than zero.'),
    ctType: ctTypeSchema.default('ring'),
    maxWidthMm: z.number().positive().nullable().optional(),
  })
  .refine((v) => v.finishedOdMm > v.finishedIdMm, {
    message: 'Finished OD must be larger than finished ID.',
    path: ['finishedOdMm'],
  });

export type DesignInputsDto = z.infer<typeof designInputsSchema>;

export const processSettingsSchema = z.object({
  resinCoverMm: z.number().nonnegative(),
  windingAllowanceMm: z.number().nonnegative(),
  lengthFactor: z.number().positive(),
  leadWireMm: z.number().nonnegative(),
  testMarginFactor: z.number().positive(),
  stackingFactor: z.number().positive().max(1),
  steelDensity: z.number().positive(),
  saturationCapTesla: z.number().positive(),
  saturationTriggerTesla: z.number().positive(),
  frequencyHz: z.number().positive(),
  maxIterations: z.number().int().min(1).max(500),
  convergenceTolerance: z.number().positive(),
  slitStepMm: z.number().positive(),
  plusFiveAbove400A: z.boolean(),
});

export const calculateRequestSchema = z.object({
  inputs: designInputsSchema,
  /** Optional per-run overrides. Persisted designs always use the stored settings. */
  settingsOverride: processSettingsSchema.partial().optional(),
});

export const customerSchema = z.object({
  name: z.string().min(1, 'Customer name is required.'),
  gstin: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactEmail: z.string().email('Enter a valid email address.').nullable().optional().or(z.literal('')),
  phone: z.string().nullable().optional(),
});

export const designStatusSchema = z.enum([
  'draft', 'calculated', 'approved', 'in_production', 'superseded', 'archived',
]);

export const createDesignSchema = z.object({
  customerId: z.string().nullable().optional(),
  customerName: z.string().min(1, 'Customer is required.'),
  enquiryNo: z.string().nullable().optional(),
  poNo: z.string().nullable().optional(),
  prdNo: z.string().nullable().optional(),
  quantity: z.number().int().positive().nullable().optional(),
  requiredBy: z.string().nullable().optional(),
  insulationType: z.string().nullable().optional(),
  inputs: designInputsSchema,
});

export const patchDesignSchema = createDesignSchema.partial().extend({
  status: designStatusSchema.optional(),
});

export const selectOptionSchema = z.object({ optionId: z.string().min(1) });

export const customerUpdateSchema = z.object({
  name: z.string().min(1, 'Customer name is required.'),
  gstin: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactEmail: z.string().email('Enter a valid email address.').nullable().optional().or(z.literal('')),
  phone: z.string().nullable().optional(),
});

export type CustomerUpdateDto = z.infer<typeof customerUpdateSchema>;

export const approveSchema = z.object({
  approvedBy: z.string().min(1, 'Approver name is required.'),
});

export const bhPointSchema = z.object({
  teslaT: z.number().positive(),
  hAtCm: z.number().positive().nullable(),
});

export const gradeUpsertSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  note: z.string().nullable().optional(),
  ratePerKg: z.number().positive().nullable(),
  densityGCm3: z.number().positive().nullable().optional(),
  stackingFactor: z.number().positive().max(1).nullable().optional(),
  isAvailable: z.boolean(),
  curve: z.array(bhPointSchema),
});

export const gaugeUpsertSchema = z.object({
  swg: z.number().int().positive(),
  diaMm: z.number().positive(),
  areaSqmm: z.number().positive(),
  ohmPerM20c: z.number().positive(),
  ohmPerM75c: z.number().positive().nullable(),
  gramPerM: z.number().positive(),
  isAvailable: z.boolean(),
});

export const dieUpsertSchema = z.object({
  id: z.string().optional(),
  dieNo: z.string().min(1),
  minOdMm: z.number().positive(),
  maxOdMm: z.number().positive(),
  maxWidthMm: z.number().positive(),
  quantity: z.number().int().nonnegative(),
  location: z.string().nullable().optional(),
  isAvailable: z.boolean(),
});

export const slitWidthsSchema = z.object({
  widths: z.array(z.number().positive()),
});

export const ratesSchema = z.object({
  copperRatePerKg: z.number().positive(),
});

export const manufacturedResultSchema = z.object({
  batchNo: z.string().min(1),
  manufacturedOn: z.string().nullable().optional(),
  actualCoreGrade: z.string().nullable().optional(),
  actualCoreWidthMm: z.number().positive().nullable().optional(),
  actualCoreWeightKg: z.number().positive().nullable().optional(),
  actualCopperWeightKg: z.number().positive().nullable().optional(),
  measuredRatioErrorPct: z.number().nullable().optional(),
  measuredPhaseErrorMin: z.number().nullable().optional(),
  measuredResistanceOhm: z.number().nullable().optional(),
  testLab: z.string().nullable().optional(),
  passed: z.boolean(),
  notes: z.string().nullable().optional(),
});

export type CreateDesignDto = z.infer<typeof createDesignSchema>;
export type PatchDesignDto = z.infer<typeof patchDesignSchema>;
export type ManufacturedResultDto = z.infer<typeof manufacturedResultSchema>;
export type GradeUpsertDto = z.infer<typeof gradeUpsertSchema>;
export type GaugeUpsertDto = z.infer<typeof gaugeUpsertSchema>;
export type DieUpsertDto = z.infer<typeof dieUpsertSchema>;
export type DesignStatus = z.infer<typeof designStatusSchema>;
