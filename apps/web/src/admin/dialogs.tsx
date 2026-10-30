import { Modal, ModalBody, ModalFooter, ModalHeader } from 'flowbite-react';
import { useState } from 'react';
import { TESLA, type SteelGrade, type WireGauge } from '@meltek/engine';
import { api, ApiError, type Customer } from '../shared/api';
import { TextField } from '../shared/fields';
import { Button, Callout } from '../shared/primitives';

/**
 * Dialogs for adding and editing reference data.
 *
 * Everything the calculation depends on can be maintained here, so the works is never
 * waiting on a deploy to add a grade, a wire size or a customer.
 */

function Shell({
  open, onClose, title, children, onSubmit, submitLabel, busy, error, disabled,
}: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
  onSubmit: () => void; submitLabel: string; busy?: boolean; error?: string | null;
  disabled?: boolean;
}) {
  return (
    <Modal show={open} onClose={onClose} size="2xl" dismissible>
      <ModalHeader className="border-[var(--line)] [&>h3]:text-[15px] [&>h3]:font-semibold">
        {title}
      </ModalHeader>
      <ModalBody className="bg-[var(--surface-1)]">
        <div className="flex flex-col gap-4">
          {children}
          {error && <Callout tone="warn" title="That did not save">{error}</Callout>}
        </div>
      </ModalBody>
      <ModalFooter className="justify-end border-[var(--line)] bg-[var(--surface-1)]">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={onSubmit} disabled={busy || disabled}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/* ─────────────────────────── steel grade ─────────────────────────── */

export function GradeDialog({
  open, onClose, onSaved, existing,
}: {
  open: boolean; onClose: () => void; onSaved: () => void; existing?: SteelGrade | null;
}) {
  const editing = Boolean(existing);
  const [code, setCode] = useState(existing?.code ?? '');
  const [label, setLabel] = useState(existing?.label ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [rate, setRate] = useState(existing?.ratePerKg?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.saveGrade(code.trim(), {
        code: code.trim(),
        label: label.trim() || code.trim(),
        note: note.trim() || null,
        ratePerKg: rate.trim() === '' ? null : Number(rate),
        densityGCm3: existing?.densityGCm3 ?? null,
        stackingFactor: existing?.stackingFactor ?? null,
        isAvailable: existing?.isAvailable ?? true,
        // A new grade starts with the standard flux density index and no measurements,
        // so the curve editor has rows to fill in rather than a blank table.
        curve: existing?.curve ?? TESLA.map((teslaT) => ({ teslaT, hAtCm: null })),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The grade could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      open={open} onClose={onClose} onSubmit={submit}
      title={editing ? `Edit ${existing!.label}` : 'Add a steel grade'}
      submitLabel={editing ? 'Save grade' : 'Add grade'}
      busy={busy} error={error}
      disabled={!code.trim() || !label.trim()}
    >
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Code" value={code} onChange={(e) => setCode(e.target.value)}
          disabled={editing} placeholder="23-MOH"
          help={editing ? 'The code identifies the grade and cannot be changed.' : 'Short identifier, e.g. 23-MOH.'}
        />
        <TextField
          label="Name" value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="23 MOH Grade"
        />
        <TextField
          label="Rate" unit="₹/kg" type="number" step="any" value={rate}
          onChange={(e) => setRate(e.target.value)}
          help="Leave blank if the rate is not agreed yet. The grade will calculate but not be costed."
        />
        <TextField
          label="Note" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Suitable for metering cores"
        />
      </div>
      {!editing && (
        <Callout tone="info" title="Next: enter the B–H curve">
          A grade cannot be calculated until its curve is filled in. Open the curve editor on
          the grade once it is added.
        </Callout>
      )}
    </Shell>
  );
}

/* ─────────────────────────── wire gauge ─────────────────────────── */

export function GaugeDialog({
  open, onClose, onSaved, existing,
}: {
  open: boolean; onClose: () => void; onSaved: () => void; existing?: WireGauge | null;
}) {
  const editing = Boolean(existing);
  const [swg, setSwg] = useState(existing?.swg?.toString() ?? '');
  const [diaMm, setDia] = useState(existing?.diaMm?.toString() ?? '');
  const [areaSqmm, setArea] = useState(existing?.areaSqmm?.toString() ?? '');
  const [ohm20, setOhm20] = useState(existing?.ohmPerM20c?.toString() ?? '');
  const [ohm75, setOhm75] = useState(existing?.ohmPerM75c?.toString() ?? '');
  const [gramPerM, setGram] = useState(existing?.gramPerM?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = [swg, diaMm, areaSqmm, ohm20, gramPerM].every((v) => v.trim() !== '');

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.saveGauge(Number(swg), {
        swg: Number(swg),
        diaMm: Number(diaMm),
        areaSqmm: Number(areaSqmm),
        ohmPerM20c: Number(ohm20),
        ohmPerM75c: ohm75.trim() === '' ? null : Number(ohm75),
        gramPerM: Number(gramPerM),
        isAvailable: existing?.isAvailable ?? true,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The wire size could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      open={open} onClose={onClose} onSubmit={submit}
      title={editing ? `Edit SWG ${existing!.swg}` : 'Add a wire size'}
      submitLabel={editing ? 'Save wire size' : 'Add wire size'}
      busy={busy} error={error} disabled={!complete}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <TextField
          label="SWG" type="number" value={swg} onChange={(e) => setSwg(e.target.value)}
          disabled={editing} help={editing ? 'Fixed once added.' : undefined}
        />
        <TextField label="Diameter" unit="mm" type="number" step="any" value={diaMm} onChange={(e) => setDia(e.target.value)} />
        <TextField label="Area" unit="mm²" type="number" step="any" value={areaSqmm} onChange={(e) => setArea(e.target.value)} />
        <TextField label="Resistance at 20 °C" unit="Ω/m" type="number" step="any" value={ohm20} onChange={(e) => setOhm20(e.target.value)} />
        <TextField
          label="Resistance at 75 °C" unit="Ω/m" type="number" step="any" value={ohm75}
          onChange={(e) => setOhm75(e.target.value)}
          help="Optional. Left blank rather than estimated."
        />
        <TextField label="Mass" unit="g/m" type="number" step="any" value={gramPerM} onChange={(e) => setGram(e.target.value)} />
      </div>
    </Shell>
  );
}

/* ─────────────────────────── customer ─────────────────────────── */

export function CustomerDialog({
  open, onClose, onSaved, customer,
}: {
  open: boolean; onClose: () => void; onSaved: () => void; customer: Customer | null;
}) {
  const [name, setName] = useState(customer?.name ?? '');
  const [gstin, setGstin] = useState(customer?.gstin ?? '');
  const [contactName, setContactName] = useState(customer?.contactName ?? '');
  const [contactEmail, setContactEmail] = useState(customer?.contactEmail ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!customer) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateCustomer(customer.id, {
        name: name.trim(),
        gstin: gstin.trim() || null,
        contactName: contactName.trim() || null,
        contactEmail: contactEmail.trim() || null,
        phone: phone.trim() || null,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The customer could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      open={open} onClose={onClose} onSubmit={submit}
      title={customer ? `Edit ${customer.name}` : 'Edit customer'}
      submitLabel="Save customer" busy={busy} error={error} disabled={!name.trim()}
    >
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Name" value={name} onChange={(e) => setName(e.target.value)} span
          help="Renaming updates every design already on record against this customer."
        />
        <TextField label="GSTIN" value={gstin} onChange={(e) => setGstin(e.target.value)} />
        <TextField label="Contact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
        <TextField label="Email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        <TextField label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
    </Shell>
  );
}
