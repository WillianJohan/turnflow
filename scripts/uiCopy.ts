import ts from 'typescript'

// Texto de UI solto em .tsx, pela AST do TypeScript (E6.9 traduz o que está no copy; o que fica no
// JSX some da tradução). Acusa: JsxText com letra; e string/template que vira valor de um atributo
// de texto (direto, nos ramos de um ternário, num `+`, depois de `??`/`||`).

/** Atributos cujo valor é lido por alguém. */
export const TEXT_ATTRS = new Set([
  'title',
  'aria-label',
  'placeholder',
  'label',
  'alt',
  'body',
  'confirm',
  'cancel',
  'action'
])

/** Nomes de produto e siglas que não se traduzem. */
export const ALLOWED = new Set(['Codex', 'Cursor', 'Claude', 'Claude Code', 'README', 'Jira'])

export type Literal = { line: number; text: string }

const hasLetter = (s: string): boolean => /\p{L}/u.test(s)
/** Nome de arquivo/caminho (`config.json`, `themes/x.json`) e combinação de teclas não se traduzem. */
export const ALLOWED_PATTERNS = [/^[\w*/ .-]*\.json$/, /^(Ctrl|Shift|Alt|Meta)(\+[\w\\|]+)+$/]

const allowed = (s: string): boolean =>
  ALLOWED.has(s.trim()) || ALLOWED_PATTERNS.some((re) => re.test(s.trim()))

/** Strings que a expressão pode devolver como texto (não as que ela só compara). */
function texts(e: ts.Expression, out: ts.Node[]): void {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) out.push(e)
  else if (ts.isTemplateExpression(e)) out.push(e)
  else if (ts.isParenthesizedExpression(e)) texts(e.expression, out)
  else if (ts.isConditionalExpression(e)) {
    texts(e.whenTrue, out)
    texts(e.whenFalse, out)
  } else if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind
    if (op === ts.SyntaxKind.PlusToken) {
      texts(e.left, out)
      texts(e.right, out)
    } else if (
      op === ts.SyntaxKind.QuestionQuestionToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.AmpersandAmpersandToken
    )
      texts(e.right, out)
  }
}

const literalText = (n: ts.Node, sf: ts.SourceFile): string => {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text
  if (ts.isTemplateExpression(n))
    return [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(' ')
  return n.getText(sf)
}

export function uiLiterals(source: string, file = 'x.tsx'): Literal[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: Literal[] = []
  const add = (n: ts.Node, text: string): void => {
    if (!hasLetter(text) || allowed(text)) return
    found.push({
      line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
      text: text.trim()
    })
  }
  const visit = (n: ts.Node): void => {
    if (ts.isJsxText(n)) add(n, n.text)
    else if (ts.isJsxAttribute(n) && TEXT_ATTRS.has(n.name.getText(sf)) && n.initializer) {
      const init = n.initializer
      if (ts.isStringLiteral(init)) add(init, init.text)
      else if (ts.isJsxExpression(init) && init.expression) {
        const out: ts.Node[] = []
        texts(init.expression, out)
        for (const t of out) add(t, literalText(t, sf))
      }
    } else if (ts.isJsxExpression(n) && n.expression && ts.isJsxElement(n.parent)) {
      // {'texto'} ou {cond ? 'a' : 'b'} como filho de elemento
      const out: ts.Node[] = []
      texts(n.expression, out)
      for (const t of out) add(t, literalText(t, sf))
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return found
}
