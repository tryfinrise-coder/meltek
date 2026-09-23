import { useState } from 'react';
import type { EngineeringSpec } from '@meltek/engine';
import { engineeringSpecSchema } from '@meltek/schema';
import { EngineeringEditor } from '../features/EngineeringEditor';
import { accuracyClassLabel } from '../lib/accuracyClasses';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'flowbite-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api, ApiError, type Design } from '../lib/api';
import { useReference } from '../features/useCalculator';
import { SelectField, TextField } from './fields';
import { Button, Callout } from './primitives';

const schema = z.object({
  customerName: z.string().min(1, 'Customer is required.'),
  enquiryNo: z.string().optional(),
  poNo: z.string().optional(),
  prdNo: z.string().optional(),
  quantity: z.coerce.number().int().positive().optional().or(z.literal('')),
  requiredBy: z.string().optional(),
  insulationType: z.string().optional(),
  primaryCurrent: z.coerce.number().positive('Primary current must be greater than zero.'),
  secondaryCurrent: z.coerce.number().positive(),
  burdenVA: z.coerce.number().positive('Burden must be greater than zero.'),
  accuracyClass: z.string().min(1),
  finishedIdMm: z.coerce.number().positive('Finished ID must be greater than zero.'),
  finishedOdMm: z.coerce.number().positive('Finished OD must be greater than zero.'),
  maxWidthMm: z.coerce.number().positive().optional().or(z.literal('')),
});

type Values = z.input<typeof schema>;

/**
 * Edit a design in place.
 *
 * Changing the specification invalidates the options that were calculated from it, so
 * the server clears them and the design returns to draft. The dialog says so before the
 * operator commits, rather than leaving them to discover it afterwards.
 */
export function EditDesignDialog({
  design, open, onClose,
}: { design: Design; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const reference = useReference();

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      customerName: design.customerName,
      enquiryNo: design.enquiryNo ?? '',
      poNo: design.poNo ?? '',
      prdNo: design.prdNo ?? '',
      quantity: design.quantity ?? '',
      requiredBy: design.requiredBy ?? '',
      insulationType: design.insulationType ?? '',
      primaryCurrent: design.inputs.primaryCurrent,
      secondaryCurrent: design.inputs.secondaryCurrent,
      burdenVA: design.inputs.burdenVA,
      accuracyClass: design.inputs.accuracyClass,
      finishedIdMm: design.inputs.finishedIdMm,
      finishedOdMm: design.inputs.finishedOdMm,
      maxWidthMm: design.inputs.maxWidthMm ?? '',
    },
  });

  const values = form.watch();
  const [engineering, setEngineering] = useState<EngineeringSpec | null>(design.inputs.engineering ?? null);
  const specChanged = JSON.stringify(engineering) !== JSON.stringify(design.inputs.engineering ?? null) ||
    Number(values.primaryCurrent) !== design.inputs.primaryCurrent ||
    Number(values.secondaryCurrent) !== design.inputs.secondaryCurrent ||
    Number(values.burdenVA) !== design.inputs.burdenVA ||
    values.accuracyClass !== design.inputs.accuracyClass ||
    Number(values.finishedIdMm) !== design.inputs.finishedIdMm ||
    Number(values.finishedOdMm) !== design.inputs.finishedOdMm ||
    (values.maxWidthMm === '' ? null : Number(values.maxWidthMm)) !== design.inputs.maxWidthMm;

  const save = useMutation({
    mutationFn: (v: Values) =>
      api.patchDesign(design.id, {
        customerName: v.customerName,
        enquiryNo: v.enquiryNo || null,
        poNo: v.poNo || null,
        prdNo: v.prdNo || null,
        quantity: v.quantity === '' ? null : Number(v.quantity),
        requiredBy: v.requiredBy || null,
        insulationType: v.insulationType || null,
        // Only send the spec when it actually changed, so an order-field edit does not
        // needlessly throw away a calculation.
        ...(specChanged
          ? {
              inputs: {
                engineering,
                primaryCurrent: Number(v.primaryCurrent),
                secondaryCurrent: Number(v.secondaryCurrent),
                burdenVA: Number(v.burdenVA),
                accuracyClass: v.accuracyClass,
                finishedIdMm: Number(v.finishedIdMm),
                finishedOdMm: Number(v.finishedOdMm),
                ctType: design.inputs.ctType,
                maxWidthMm: v.maxWidthMm === '' ? null : Number(v.maxWidthMm),
              },
            }
          : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['design', design.id] });
      void qc.invalidateQueries({ queryKey: ['designs'] });
      onClose();
    },
  });

  const classes = engineering?.purpose === 'protection' ? ['5P','10P'].map(code=>({code,perIS:false,note:'Engineering screening'})) : engineering?.purpose === 'ps' ? ['PS','PX'].map(code=>({code,perIS:false,note:'Engineering screening'})) : (reference.data?.classes ?? []).filter(c=>!['5P','10P','PS','PX'].includes(c.code));

  return (
    <Modal show={open} onClose={onClose} size="3xl" dismissible>
      <ModalHeader className="border-[var(--line)] [&>h3]:text-[15px] [&>h3]:font-semibold">
        Edit {design.designNo}
      </ModalHeader>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <ModalBody className="bg-[var(--surface-1)]">
          <div className="flex flex-col gap-5">
            <EngineeringEditor value={engineering} reference={reference.data} onChange={next=>{
              if ((next?.purpose ?? 'metering') !== (engineering?.purpose ?? 'metering')) form.setValue('accuracyClass',next?.purpose==='protection'?'5P':next?.purpose==='ps'?'PS':'0.5S');
              setEngineering(next);
            }}/>

            <section>
              <h3 className="eyebrow mb-3">Customer &amp; order</h3>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <TextField
                  label="Customer" list="edit-customers"
                  error={form.formState.errors.customerName?.message}
                  {...form.register('customerName')}
                />
                <datalist id="edit-customers">
                  {(reference.data?.customers ?? []).map((c) => <option key={c.id} value={c.name} />)}
                </datalist>
                <TextField label="Enquiry no" {...form.register('enquiryNo')} />
                <TextField label="PO no" {...form.register('poNo')} />
                <TextField label="PRD no" {...form.register('prdNo')} />
                <TextField label="Quantity" type="number" {...form.register('quantity')} />
                <TextField label="Required by" type="date" {...form.register('requiredBy')} />
                <TextField label="Insulation type" {...form.register('insulationType')} />
              </div>
            </section>

            <section>
              <h3 className="eyebrow mb-3">Specification</h3>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <TextField
                  label="Primary current Ip" unit="A" type="number" step="any"
                  error={form.formState.errors.primaryCurrent?.message}
                  {...form.register('primaryCurrent')}
                />
                <SelectField label="Secondary current Is" {...form.register('secondaryCurrent')}>
                  <option value={5}>5 A</option>
                  <option value={1}>1 A</option>
                </SelectField>
                <TextField
                  label="Burden" unit="VA" type="number" step="any"
                  error={form.formState.errors.burdenVA?.message}
                  {...form.register('burdenVA')}
                />
                <SelectField label="Accuracy class" span aria-label="Accuracy class" help={classes.find(c => c.code === values.accuracyClass && !c.perIS)?.note} {...form.register('accuracyClass')} value={values.accuracyClass}>
                  {classes.map((c) => (
                    <option key={c.code} value={c.code}>{accuracyClassLabel(c.code)}</option>
                  ))}
                </SelectField>
                <TextField
                  label="Finished ID" unit="mm" type="number" step="any"
                  error={form.formState.errors.finishedIdMm?.message}
                  {...form.register('finishedIdMm')}
                />
                <TextField
                  label="Finished OD" unit="mm" type="number" step="any"
                  error={form.formState.errors.finishedOdMm?.message}
                  {...form.register('finishedOdMm')}
                />
                <TextField label="Max width" unit="mm" type="number" step="any" {...form.register('maxWidthMm')} />
              </div>
            </section>

            {specChanged && (
              <Callout tone="warn" title="This clears the calculated options">
                The specification has changed, so the options costed against the old one no
                longer apply. The design goes back to draft and needs recalculating.
              </Callout>
            )}

            {save.error instanceof ApiError && (
              <Callout tone="warn" title="This design could not be saved">
                {save.error.message}
                {save.error.issues.length > 0 && (
                  <ul className="mt-1 list-disc pl-4">
                    {save.error.issues.map((i) => <li key={i.path}>{i.message}</li>)}
                  </ul>
                )}
              </Callout>
            )}
          </div>
        </ModalBody>
        <ModalFooter className="justify-end border-[var(--line)] bg-[var(--surface-1)]">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={save.isPending || (engineering !== null && !engineeringSpecSchema.safeParse(engineering).success)}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
