type Token =
  | { type: 'number'; value: number }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: string }
  | { type: 'left' | 'right' | 'comma' };

export class FormulaError extends Error {}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const rest = expression.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }

    const number = rest.match(/^(?:\d+\.?\d*|\.\d+)/);
    if (number) {
      tokens.push({ type: 'number', value: Number(number[0]) });
      index += number[0].length;
      continue;
    }

    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier[0] });
      index += identifier[0].length;
      continue;
    }

    const operator = rest.match(/^(>=|<=|==|!=|[+\-*/><])/);
    if (operator) {
      tokens.push({ type: 'operator', value: operator[0] });
      index += operator[0].length;
      continue;
    }

    const punctuation: Record<string, Token['type']> = { '(': 'left', ')': 'right', ',': 'comma' };
    const type = punctuation[rest[0]];
    if (type) {
      tokens.push({ type } as Token);
      index += 1;
      continue;
    }

    throw new FormulaError(`Unsupported character “${rest[0]}”`);
  }

  return tokens;
}

export function formulaIdentifiers(expression: string): string[] {
  const tokens = tokenize(expression);
  return [
    ...new Set(
      tokens.flatMap((token, index) =>
        token.type === 'identifier' && tokens[index + 1]?.type !== 'left' ? [token.value] : [],
      ),
    ),
  ];
}

export function evaluateFormula(expression: string, variables: Record<string, number>): number {
  const tokens = tokenize(expression);
  let cursor = 0;

  const peek = () => tokens[cursor];
  const take = () => tokens[cursor++];

  const parsePrimary = (): number => {
    const token = take();
    if (!token) throw new FormulaError('Formula ended unexpectedly');

    if (token.type === 'number') return token.value;

    if (token.type === 'operator' && (token.value === '+' || token.value === '-')) {
      const value = parsePrimary();
      return token.value === '-' ? -value : value;
    }

    if (token.type === 'left') {
      const value = parseComparison();
      if (take()?.type !== 'right') throw new FormulaError('Missing closing parenthesis');
      return value;
    }

    if (token.type === 'identifier') {
      if (peek()?.type === 'left') {
        take();
        const args: number[] = [];
        if (peek()?.type !== 'right') {
          while (true) {
            args.push(parseComparison());
            if (peek()?.type !== 'comma') break;
            take();
          }
        }
        if (take()?.type !== 'right') throw new FormulaError('Missing closing parenthesis');
        return applyFunction(token.value, args);
      }

      if (!(token.value in variables)) throw new FormulaError(`Unknown metric “${token.value}”`);
      return variables[token.value];
    }

    throw new FormulaError('Expected a number, metric, or parenthesis');
  };

  const parseProduct = (): number => {
    let value = parsePrimary();
    while (peek()?.type === 'operator' && ['*', '/'].includes((peek() as { value: string }).value)) {
      const operator = (take() as { value: string }).value;
      const right = parsePrimary();
      if (operator === '/' && right === 0) throw new FormulaError('Cannot divide by zero');
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  };

  const parseSum = (): number => {
    let value = parseProduct();
    while (peek()?.type === 'operator' && ['+', '-'].includes((peek() as { value: string }).value)) {
      const operator = (take() as { value: string }).value;
      const right = parseProduct();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };

  const parseComparison = (): number => {
    let value = parseSum();
    while (
      peek()?.type === 'operator' &&
      ['>', '<', '>=', '<=', '==', '!='].includes((peek() as { value: string }).value)
    ) {
      const operator = (take() as { value: string }).value;
      const right = parseSum();
      const comparisons: Record<string, boolean> = {
        '>': value > right,
        '<': value < right,
        '>=': value >= right,
        '<=': value <= right,
        '==': value === right,
        '!=': value !== right,
      };
      value = comparisons[operator] ? 1 : 0;
    }
    return value;
  };

  const result = parseComparison();
  if (cursor !== tokens.length) throw new FormulaError('Unexpected token');
  if (!Number.isFinite(result)) throw new FormulaError('Formula produced an invalid value');
  return result;
}

function applyFunction(name: string, args: number[]): number {
  switch (name.toUpperCase()) {
    case 'MIN':
      if (!args.length) throw new FormulaError('MIN needs at least one value');
      return Math.min(...args);
    case 'MAX':
      if (!args.length) throw new FormulaError('MAX needs at least one value');
      return Math.max(...args);
    case 'AVERAGE':
      if (!args.length) throw new FormulaError('AVERAGE needs at least one value');
      return args.reduce((sum, value) => sum + value, 0) / args.length;
    case 'ROUND':
      if (args.length !== 1) throw new FormulaError('ROUND needs one value');
      return Math.round(args[0]);
    case 'ABS':
      if (args.length !== 1) throw new FormulaError('ABS needs one value');
      return Math.abs(args[0]);
    case 'CLAMP':
      if (args.length !== 3) throw new FormulaError('CLAMP needs value, minimum, and maximum');
      return Math.min(Math.max(args[0], args[1]), args[2]);
    case 'IF':
      if (args.length !== 3) throw new FormulaError('IF needs condition, then, and otherwise values');
      return args[0] !== 0 ? args[1] : args[2];
    default:
      throw new FormulaError(`Unknown function “${name}”`);
  }
}
