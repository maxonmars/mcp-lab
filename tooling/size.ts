import ts from "typescript";

export const limits = { source: 300, test: 400, function: 60, agents: 120 } as const;

function codeLines(text: string): Set<number> {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  const source = ts.createSourceFile("size.ts", text, ts.ScriptTarget.Latest);
  const lines = new Set<number>();
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token >= ts.SyntaxKind.SingleLineCommentTrivia && token <= ts.SyntaxKind.ConflictMarkerTrivia) continue;
    const first = source.getLineAndCharacterOfPosition(scanner.getTokenPos()).line;
    const last = source.getLineAndCharacterOfPosition(scanner.getTextPos() - 1).line;
    for (let line = first; line <= last; line++) lines.add(line);
  }
  return lines;
}

function describeNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== "vitest") continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const item of bindings.elements) {
      if ((item.propertyName ?? item.name).text === "describe") names.add(item.name.text);
    }
  }
  return names;
}

export function checkSize(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const lines = codeLines(text);
  const errors: string[] = [];
  const limit = path.endsWith(".test.ts") ? limits.test : limits.source;
  if (lines.size > limit) errors.push(`${path}: ${lines.size} строк кода, предел ${limit}`);
  const containers = describeNames(source);
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node) && "body" in node && node.body) {
      const parent = node.parent;
      const container =
        ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && containers.has(parent.expression.text);
      const first = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
      const last = source.getLineAndCharacterOfPosition(node.end).line;
      const count = [...lines].filter((line) => line >= first && line <= last).length;
      if (!container && count > limits.function)
        errors.push(`${path}:${first + 1}: функция ${count} строк, предел ${limits.function}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return errors;
}
