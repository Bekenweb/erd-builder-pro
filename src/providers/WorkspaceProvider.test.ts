import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('publishes Settings open/close and tab changes through the memoized workspace context', () => {
  const source = ts.createSourceFile('WorkspaceProvider.tsx', readFileSync(new URL('./WorkspaceProvider.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let dependencies: string[] | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'ctx' && node.initializer && ts.isCallExpression(node.initializer)) {
      const array = node.initializer.arguments[1];
      if (array && ts.isArrayLiteralExpression(array)) dependencies = array.elements.map(item => item.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(dependencies).toEqual(expect.arrayContaining(['isSettingsOpen', 'settingsTab']));
});
