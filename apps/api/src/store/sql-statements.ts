/** Split our MySQL migration scripts without splitting literals or comments. */
export function sqlStatements(source: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote = '';
  let comment: 'line' | 'block' | null = null;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    const next = source[i + 1];
    if (comment === 'line') {
      if (char === '\n') { comment = null; current += '\n'; }
      continue;
    }
    if (comment === 'block') {
      if (char === '*' && next === '/') { comment = null; i++; current += ' '; }
      continue;
    }
    if (quote) {
      current += char;
      if (char === '\\' && next !== undefined) { current += next; i++; }
      else if (char === quote) {
        if (next === quote) { current += next; i++; }
        else quote = '';
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; current += char; }
    else if (char === '/' && next === '*') { comment = 'block'; i++; }
    else if (char === '#' || (char === '-' && next === '-' && /\s/.test(source[i + 2] ?? '\n'))) {
      comment = 'line'; current += ' '; if (char === '-') i++;
    } else if (char === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else current += char;
  }
  if (quote || comment === 'block') throw new Error('Unterminated literal or comment in MySQL migration');
  if (current.trim()) statements.push(current.trim());
  return statements;
}
