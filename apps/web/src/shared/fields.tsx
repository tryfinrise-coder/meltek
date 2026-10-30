import { Label, Select, TextInput, Tooltip } from 'flowbite-react';
import { forwardRef, useId, type ComponentProps, type ReactNode } from 'react';
import { HiInformationCircle } from 'react-icons/hi';

/**
 * Form fields (§11.1).
 *
 * Built on flowbite-react so focus, disabled, invalid and sizing behave consistently and
 * accessibly everywhere, with the MELTEK theme applied centrally in lib/flowbite-theme.
 * The label/help/error scaffolding lives here so no screen repeats it.
 */

interface BaseFieldProps {
  label: string;
  error?: string;
  help?: ReactNode;
  /** Explains a term an engineer might not share with the person who wrote the form. */
  hint?: string;
  unit?: string;
  span?: boolean;
  children?: ReactNode;
}

export function FieldShell({ label, error, help, hint, span, children }: BaseFieldProps) {
  return (
    <div className={`field-shell flex flex-col gap-1.5 ${span ? 'col-span-2' : ''}`}>
      <div className="flex items-center gap-1.5">
        <Label>{label}</Label>
        {hint && (
          <Tooltip content={hint}>
            <HiInformationCircle className="h-3.5 w-3.5 text-[var(--text-3)]" aria-label={hint} />
          </Tooltip>
        )}
      </div>
      {children}
      {error && <span className="text-[11.5px]" style={{ color: 'var(--warn)' }}>{error}</span>}
      {!error && help && <span className="text-[11.5px] text-[var(--text-3)]">{help}</span>}
    </div>
  );
}

type TextFieldProps = BaseFieldProps & Omit<ComponentProps<typeof TextInput>, 'color'>;

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, help, hint, unit, span, ...input }, ref,
) {
  const id = useId();
  return (
    <FieldShell label={label} {...(error ? { error } : {})} help={help} {...(hint ? { hint } : {})} {...(span ? { span } : {})}>
      <div className={unit ? 'flex items-center gap-2' : undefined}>
        <TextInput
          id={id}
          ref={ref}
          color={error ? 'failure' : 'gray'}
          aria-invalid={error ? true : undefined}
          className={input.type === 'number' ? 'num flex-1' : 'flex-1'}
          {...input}
        />
        {unit && <span className="shrink-0 text-[13px] text-[var(--text-3)]">{unit}</span>}
      </div>
    </FieldShell>
  );
});

type SelectFieldProps = BaseFieldProps & Omit<ComponentProps<typeof Select>, 'color'>;

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, error, help, hint, span, children, ...select }, ref,
) {
  const id = useId();
  return (
    <FieldShell label={label} {...(error ? { error } : {})} help={help} {...(hint ? { hint } : {})} {...(span ? { span } : {})}>
      <Select id={id} ref={ref} color={error ? 'failure' : 'gray'} {...select}>
        {children}
      </Select>
    </FieldShell>
  );
});
