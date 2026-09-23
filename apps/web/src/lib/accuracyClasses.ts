/** Display labels only: the reference-data code remains the calculation value. */
const APPLICATION_NAMES: Record<string, string> = {
  '5P': 'Protection relay',
  '10P': 'Protection relay',
  'PS': 'Special protection',
  'PX': 'Special protection',
  '0.1': 'Metering',
  '0.2': 'Accurate metering',
  '0.5': 'General metering',
  '1.0': 'Indication / panel meters',
  '1': 'Indication / panel meters',
  '3.0': 'Indication',
  '3': 'Indication',
  '0.2S': 'High-accuracy billing',
  '0.5S': 'Energy billing meter',
};

export function accuracyClassLabel(code: string): string {
  const name = APPLICATION_NAMES[code];
  return name ? `${code} — ${name}` : code;
}
