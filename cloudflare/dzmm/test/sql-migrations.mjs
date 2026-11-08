// SQLite trigger bodies contain statement separators of their own. Keep them
// together, while treating quoted values, identifiers and comments as literals.
export function splitSqlStatements(sql) {
  if (typeof sql !== 'string') throw new TypeError('SQL migration must be a string.');
  const statements = [];
  let start = 0, index = 0, hasToken = false;
  let trigger = false, triggerBody = false, caseDepth = 0;
  const prefix = [];

  const complete = end => {
    if (hasToken) statements.push(sql.slice(start, end).trim());
    start = end + 1;
    hasToken = false;
    trigger = false;
    triggerBody = false;
    caseDepth = 0;
    prefix.length = 0;
  };
  const quoted = opener => {
    const closer = opener === '[' ? ']' : opener;
    index++;
    while (index < sql.length) {
      if (sql[index] === closer) {
        if (opener !== '[' && sql[index + 1] === closer) { index += 2; continue; }
        index++;
        return;
      }
      index++;
    }
    throw new Error('SQL migration has an unterminated quoted value or identifier.');
  };

  while (index < sql.length) {
    const character = sql[index];
    if (/\s/.test(character)) { index++; continue; }
    if (character === '-' && sql[index + 1] === '-') {
      index += 2;
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') index++;
      continue;
    }
    if (character === '/' && sql[index + 1] === '*') {
      const end = sql.indexOf('*/', index + 2);
      if (end === -1) throw new Error('SQL migration has an unterminated block comment.');
      index = end + 2;
      continue;
    }
    if (character === "'" || character === '"' || character === '`' || character === '[') {
      hasToken = true;
      quoted(character);
      continue;
    }
    if (/[A-Za-z_]/.test(character)) {
      const wordStart = index++;
      while (index < sql.length && /[A-Za-z_0-9]/.test(sql[index])) index++;
      const word = sql.slice(wordStart, index).toUpperCase();
      hasToken = true;
      if (!triggerBody) {
        if (prefix.length < 3) prefix.push(word);
        trigger ||= prefix[0] === 'CREATE' && (prefix[1] === 'TRIGGER'
          || ((prefix[1] === 'TEMP' || prefix[1] === 'TEMPORARY') && prefix[2] === 'TRIGGER'));
        if (trigger && word === 'BEGIN') triggerBody = true;
      } else if (word === 'CASE') {
        caseDepth++;
      } else if (word === 'END') {
        if (caseDepth > 0) caseDepth--;
        else triggerBody = false;
      }
      continue;
    }
    if (character === ';' && !triggerBody) complete(index);
    else hasToken = true;
    index++;
  }
  if (triggerBody) throw new Error('SQL migration has an unterminated trigger body.');
  if (hasToken) statements.push(sql.slice(start).trim());
  return statements;
}
