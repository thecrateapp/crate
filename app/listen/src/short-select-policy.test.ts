import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

type Control = {
  file: string;
  component: string;
  value: string;
  count: number | undefined;
};

const DYNAMIC_SELECTS: Record<string, string> = {
  "app/listen/src/components/settings/SettingsPrimitives.tsx:Select:value":
    "Existing1BD typed scalar Settings form adapter; callers inject their approved choices. This extraction adds no control.",
  "app/listen/src/components/settings/SleepTimerView.tsx:Select:value":
    "Existing1AZ SleepTimer presentation extracted from controller; typed timer preset choices, no added control.",
  "app/listen/src/pages/LibraryCollectionSortDropdown.tsx:Select:selected.value":
    "One shared collection Sort form adapter takes the typed artist/album/liked choice arrays; Sort uses Select by Diego's1AQ amendment, reconciled1AY.",
  "app/ui/src/components/ai-models/ActivityPanel.tsx:AdminSelect:actionId":
    "Feature options are the action definitions supplied by the AI snapshot API.",
  'app/ui/src/components/ai-models/FeatureModelSheet.tsx:AdminSelect:selectedProfile ? selectedProfile.profile.id : ""':
    "Saved profile identities and labels come from the runtime AI profile catalog.",
  'app/ui/src/components/ai-models/ModelPicker.tsx:AdminSelect:connection ? connection.id : ""':
    "Configured provider connections are runtime user-managed records, not fixed choices.",
  'app/ui/src/components/ai-models/ModelPicker.tsx:AdminSelect:model ? model.model_id : ""':
    "Eligible models come from the chosen provider connection's model catalog.",
  'app/ui/src/components/ai-models/ModelPicker.tsx:AdminSelect:model ? current : ""':
    "Reasoning form presets depend on the selected model capabilities and include stored custom budgets.",
  'app/ui/src/components/ai-models/ProfileForm.tsx:AdminSelect:model ? limits.image_detail : ""':
    "Image detail is a categorical profile field supplied by the selected model's capability metadata.",
  "app/ui/src/pages/Browse.tsx:AdminSelect:genre":
    "The catalog supplies available genres; their cardinality is not a UI constant.",
  "app/ui/src/pages/Browse.tsx:AdminSelect:country":
    "Available countries are catalog facets.",
  "app/ui/src/pages/Browse.tsx:AdminSelect:decade":
    "Available decades are catalog facets and may grow with the library.",
  "app/ui/src/pages/Browse.tsx:AdminSelect:format":
    "Available audio formats are catalog facets.",
  'app/ui/src/components/system-health/MetricChart.tsx:Select:selected ?? ""':
    "Inspectable samples are the points of the live metric series.",
  "app/ui/src/pages/Logs.tsx:AdminSelect:category":
    "Log categories come from the operational API.",
  "app/ui/src/pages/Logs.tsx:AdminSelect:workerId":
    "Workers are discovered at runtime.",
  "app/ui/src/pages/NewReleases.tsx:AdminSelect:typeFilter":
    "Release type options are returned by the catalog API.",
  "app/ui/src/pages/Playlists.tsx:AdminSelect:categoryFilter":
    "Playlist category facets come from the API and include server-defined categories.",
  "app/ui/src/pages/Playlists.tsx:AdminSelect:rule.value":
    "Rule value choices depend on the selected field and catalog facets.",
  'app/ui/src/pages/PlaylistEditor.tsx:AdminSelect:String(rule.value ?? "")':
    "Rule value choices depend on the selected field and catalog facets.",
  "app/ui/src/pages/Playlists.tsx:AdminSelect:rule.op":
    "Approved1AP operator Select; comparator options vary with the rule field type.",
  "app/ui/src/pages/PlaylistEditor.tsx:AdminSelect:rule.op":
    "Approved1AP operator Select; comparator options vary with the rule field type.",
  "app/ui/src/pages/Settings.tsx:AdminSelect:actionFilter":
    "Audit action kinds are supplied by the operational API.",
  'app/ui/src/pages/Tasks.tsx:AdminSelect:filterType === "all" ? "" : filterType':
    "Task types are discovered from task history and worker metadata.",
  "app/ui/src/pages/Upcoming.tsx:AdminSelect:genreFilter":
    "Available concert genres are computed from the current event payload.",
  "app/ui/src/pages/Upcoming.tsx:AdminSelect:cityFilter":
    "Available cities are computed from the current event payload.",
  "app/ui/src/pages/I18nReview.tsx:FilterSelect:localeFilter":
    "Locales are obtained from translation bundle metadata; the wrapper is checked per caller.",
  "app/ui/src/pages/I18nReview.tsx:FilterSelect:sourceFilter":
    "Source versions are obtained from translation bundles; the wrapper is checked per caller.",
};

type FormSelect = { choices: number; sites: number; reason: string };
// Diego's1AQ amendment: categorical form fields use Select, while existing filter chips stay.
// Exact cardinality and site count prevent blanket exemptions or accidental extra controls.
const FORM_SELECTS: Record<string, FormSelect> = {
  "app/listen/src/components/crates/CrateForm.tsx:Select:values.visibility": {
    choices: 2,
    sites: 1,
    reason: "1BB categorical Visibility follows Diego's Select rule.",
  },
  "app/listen/src/components/crates/CrateForm.tsx:Select:values.ordering": {
    choices: 3,
    sites: 1,
    reason: "1BB categorical Ordering follows Diego's Select rule.",
  },
  "app/listen/src/components/playlists/PlaylistIdentityView.tsx:Select:visibility":
    {
      choices: 2,
      sites: 1,
      reason:
        "Existing private/public categorical form field (present before1AY); explicit form Select rule from1AQ/1AR, not a filter.",
    },
  "app/ui/src/components/artist/ArtistDiscographySection.tsx:AdminSelect:sort":
    {
      choices: 3,
      sites: 1,
      reason:
        "Categorical Sort uses Select under Diego's1AQ amendment; this is the album ordering field, not a content filter.",
    },
  "app/ui/src/components/artist/ArtistMetadataEditor.tsx:AdminSelect:values.artist_type":
    {
      choices: 6,
      sites: 1,
      reason:
        "Categorical artist Type edit field follows1AQ/1AR; five declared values plus the existing clear option.",
    },
  'app/ui/src/components/shows/ShowCandidateFields.tsx:AdminSelect:candidate.status ?? "scheduled"':
    {
      choices: 6,
      sites: 1,
      reason:
        "Categorical show Status writes the draft's persisted value; the six reviewed event states use Select under1AQ/1AR.",
    },
  "app/ui/src/pages/Tasks.tsx:AdminSelect:filterFamily": {
    choices: 7,
    sites: 1,
    reason:
      "Explicit Task Desk exception in app/ui/ADMIN_UI_REVIEW_CHECKLIST.md: search, family and type stay in one aligned row using selectors for family/type.",
  },
  "app/ui/src/pages/federation/PoliciesPanel.tsx:AdminSelect:preset": {
    choices: 5,
    sites: 1,
    reason:
      "Grant preset is a categorical policy edit persisted to a peer, not a list filter;1AQ/1AR retains Select.",
  },
  "app/ui/src/pages/Playlists.tsx:AdminSelect:category": {
    choices: 6,
    sites: 2,
    reason: "Category in static/smart creation;1AQ user decision.",
  },
  "app/ui/src/pages/Playlists.tsx:AdminSelect:match": {
    choices: 2,
    sites: 1,
    reason: "Match in smart creation; explicit1AQ user reply.",
  },
  "app/ui/src/pages/Playlists.tsx:AdminSelect:sort": {
    choices: 5,
    sites: 1,
    reason: "Sort in smart creation; explicit1AQ user reply.",
  },
  "app/ui/src/pages/PlaylistEditor.tsx:AdminSelect:category": {
    choices: 7,
    sites: 1,
    reason: "Category plus explicit None in editor;1AQ user decision.",
  },
  "app/ui/src/pages/PlaylistEditor.tsx:AdminSelect:match": {
    choices: 2,
    sites: 1,
    reason: "Match in editor; explicit1AQ user reply.",
  },
  "app/ui/src/pages/PlaylistEditor.tsx:AdminSelect:sort": {
    choices: 5,
    sites: 1,
    reason: "Sort in editor; explicit1AQ user reply.",
  },
  "app/ui/src/pages/PlaylistEditor.tsx:AdminSelect:trackSearchScope": {
    choices: 2,
    sites: 1,
    reason:
      "Search scope form field;1AQ search-layout feedback, same rules/library values.",
  },
};

function unwrap(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

function maximum(values: Array<number | undefined>): number | undefined {
  return values.some((value) => value === undefined)
    ? undefined
    : Math.max(0, ...(values as number[]));
}

function total(values: Array<number | undefined>): number | undefined {
  return values.some((value) => value === undefined)
    ? undefined
    : (values as number[]).reduce((sum, value) => sum + value, 0);
}

function inspectControls(source: string, file = "fixture.tsx"): Control[] {
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const imports = new Map<string, string>();
  const declarations: ts.VariableDeclaration[] = [];
  const wrappers = new Set<ts.FunctionDeclaration>();
  const visit = (node: ts.Node, callback: (child: ts.Node) => void) => {
    callback(node);
    node.forEachChild((child) => visit(child, callback));
  };
  visit(tree, (node) => {
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    if (ts.isFunctionDeclaration(node) && node.name?.text === "FilterSelect") {
      const parameter = node.parameters[0]?.name;
      if (parameter && ts.isObjectBindingPattern(parameter)) {
        const names = parameter.elements.map((item) => item.name.getText(tree));
        if (names.includes("options") && names.includes("value"))
          wrappers.add(node);
      }
    }
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteral(node.moduleSpecifier)
    )
      return;
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return;
    for (const item of bindings.elements) {
      const name = item.propertyName?.text ?? item.name.text;
      if (
        [
          "Select",
          "SelectItem",
          "AdminSelect",
          "FilterSelect",
          "useMemo",
        ].includes(name)
      ) {
        imports.set(item.name.text, name);
      }
    }
  });

  function initializer(identifier: ts.Identifier): ts.Expression | undefined {
    for (
      let scope: ts.Node | undefined = identifier.parent;
      scope;
      scope = scope.parent
    ) {
      if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
        const declaration = declarations.find((item) => {
          if (!ts.isIdentifier(item.name) || item.name.text !== identifier.text)
            return false;
          let owner: ts.Node = item;
          while (!ts.isBlock(owner) && !ts.isSourceFile(owner))
            owner = owner.parent;
          return owner === scope;
        });
        if (declaration) {
          return declaration.parent.flags & ts.NodeFlags.Const
            ? declaration.initializer
            : undefined;
        }
      }
      if (
        ts.isFunctionLike(scope) &&
        scope.parameters.some((parameter) => {
          const names: string[] = [];
          visit(parameter.name, (node) => {
            if (ts.isIdentifier(node)) names.push(node.text);
          });
          return names.includes(identifier.text);
        })
      )
        return undefined;
    }
    return undefined;
  }

  function arrayLength(
    expression: ts.Expression,
    seen = new Set<ts.Node>(),
  ): number | undefined {
    const node = unwrap(expression);
    if (seen.has(node)) return undefined;
    const nextSeen = new Set(seen).add(node);
    if (ts.isIdentifier(node)) {
      const value = initializer(node);
      return value ? arrayLength(value, nextSeen) : undefined;
    }
    if (ts.isArrayLiteralExpression(node)) {
      return total(
        node.elements.map((item) =>
          ts.isSpreadElement(item) ? arrayLength(item.expression, nextSeen) : 1,
        ),
      );
    }
    if (ts.isConditionalExpression(node)) {
      return maximum([
        arrayLength(node.whenTrue, nextSeen),
        arrayLength(node.whenFalse, nextSeen),
      ]);
    }
    if (ts.isCallExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "map"
      ) {
        return arrayLength(node.expression.expression, nextSeen);
      }
      if (
        ts.isIdentifier(node.expression) &&
        (imports.get(node.expression.text) ?? node.expression.text) ===
          "useMemo"
      ) {
        const callback = node.arguments[0];
        if (
          !callback ||
          (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
        )
          return undefined;
        if (!ts.isBlock(callback.body))
          return arrayLength(callback.body, nextSeen);
        const returned = callback.body.statements.filter(ts.isReturnStatement);
        return returned.length === 1 && returned[0]?.expression
          ? arrayLength(returned[0].expression, nextSeen)
          : undefined;
      }
    }
    return undefined;
  }

  const tagName = (tag: ts.JsxTagNameExpression) =>
    imports.get(tag.getText(tree)) ?? tag.getText(tree);
  function optionCount(node: ts.Node): number | undefined {
    if (ts.isJsxElement(node)) {
      const name = tagName(node.openingElement.tagName);
      return name === "option" || name === "SelectItem"
        ? 1
        : total(node.children.map(optionCount));
    }
    if (ts.isJsxSelfClosingElement(node)) {
      const name = tagName(node.tagName);
      return name === "option" || name === "SelectItem" ? 1 : 0;
    }
    if (ts.isJsxFragment(node)) return total(node.children.map(optionCount));
    if (ts.isJsxText(node)) return 0;
    if (ts.isJsxExpression(node))
      return node.expression ? optionCount(node.expression) : 0;
    if (ts.isExpression(node)) {
      const expression = unwrap(node);
      if (expression !== node) return optionCount(expression);
      if (ts.isConditionalExpression(expression))
        return maximum([
          optionCount(expression.whenTrue),
          optionCount(expression.whenFalse),
        ]);
      if (
        ts.isBinaryExpression(expression) &&
        expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      )
        return optionCount(expression.right);
      if (
        expression.kind === ts.SyntaxKind.NullKeyword ||
        expression.kind === ts.SyntaxKind.FalseKeyword
      )
        return 0;
      if (
        ts.isCallExpression(expression) &&
        ts.isPropertyAccessExpression(expression.expression) &&
        expression.expression.name.text === "map"
      ) {
        const count = arrayLength(expression.expression.expression);
        const callback = expression.arguments[0];
        if (
          count === undefined ||
          !callback ||
          !ts.isArrowFunction(callback) ||
          ts.isBlock(callback.body)
        )
          return undefined;
        const perItem = optionCount(callback.body);
        return perItem === undefined ? undefined : count * perItem;
      }
    }
    return undefined;
  }

  function attribute(
    node: ts.JsxOpeningLikeElement,
    name: string,
  ): ts.JsxAttribute | undefined {
    return node.attributes.properties.find(
      (item): item is ts.JsxAttribute =>
        ts.isJsxAttribute(item) && item.name.getText(tree) === name,
    );
  }
  function expressionAttribute(
    node: ts.JsxOpeningLikeElement,
    name: string,
  ): ts.Expression | undefined {
    const value = attribute(node, name)?.initializer;
    return value && ts.isJsxExpression(value) ? value.expression : undefined;
  }

  const controls: Control[] = [];
  visit(tree, (node) => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node))
      return;
    const component = tagName(node.tagName);
    if (
      !["Select", "AdminSelect", "select", "FilterSelect"].includes(component)
    )
      return;
    if (component === "select" && ts.isJsxElement(node.parent)) {
      const children = node.parent.children.filter(
        (child) => !ts.isJsxText(child) || child.text.trim() !== "",
      );
      const child = children[0];
      const mapped =
        child && ts.isJsxExpression(child) ? child.expression : undefined;
      const forwardsOptions =
        children.length === 1 &&
        mapped &&
        ts.isCallExpression(mapped) &&
        ts.isPropertyAccessExpression(mapped.expression) &&
        mapped.expression.name.text === "map" &&
        mapped.expression.expression.getText(tree) === "options" &&
        mapped.arguments[0] &&
        ts.isArrowFunction(mapped.arguments[0]) &&
        optionCount(mapped.arguments[0].body) === 1 &&
        expressionAttribute(node, "value")?.getText(tree) === "value";
      if (forwardsOptions) {
        let ancestor: ts.Node = node;
        while (!ts.isSourceFile(ancestor)) {
          if (ts.isFunctionDeclaration(ancestor) && wrappers.has(ancestor))
            return;
          ancestor = ancestor.parent;
        }
      }
    }
    if (
      component === "AdminSelect" &&
      expressionAttribute(node, "value")?.getText(tree) === "value"
    ) {
      const options = expressionAttribute(node, "options");
      const forwarded =
        options &&
        ((ts.isIdentifier(options) && options.text === "options") ||
          (ts.isCallExpression(options) &&
            ts.isPropertyAccessExpression(options.expression) &&
            options.expression.name.text === "map" &&
            options.expression.expression.getText(tree) === "options"));
      if (forwarded) {
        let ancestor: ts.Node = node;
        while (!ts.isSourceFile(ancestor)) {
          if (ts.isFunctionDeclaration(ancestor) && wrappers.has(ancestor))
            return;
          ancestor = ancestor.parent;
        }
      }
    }
    const value = expressionAttribute(node, "value");
    const valueText =
      value?.getText(tree).replace(/\s+/g, " ") ??
      attribute(node, "value")?.initializer?.getText(tree) ??
      "<missing value>";
    const options = expressionAttribute(node, "options");
    let count =
      component === "AdminSelect" || component === "FilterSelect"
        ? options
          ? arrayLength(options)
          : undefined
        : ts.isJsxElement(node.parent)
          ? total(node.parent.children.map(optionCount))
          : 0;
    if (component === "AdminSelect" && count !== undefined) {
      const clear = attribute(node, "allowClear");
      const clearValue = expressionAttribute(node, "allowClear");
      if (
        !clear ||
        !clear.initializer ||
        clearValue?.kind === ts.SyntaxKind.TrueKeyword
      )
        count += 1;
      else if (clearValue?.kind !== ts.SyntaxKind.FalseKeyword)
        count = undefined;
    }
    controls.push({ file, component, value: valueText, count });
  });
  return controls;
}

function violations(
  controls: Control[],
  exceptions: Record<string, string>,
  formSelects: Record<string, FormSelect> = {},
): string[] {
  const failures: string[] = [];
  const used = new Set<string>();
  const usedForms = new Map<string, number>();
  for (const control of controls) {
    const key = `${control.file}:${control.component}:${control.value}`;
    const form = formSelects[key];
    if (form?.reason.trim() && control.count === form.choices) {
      const count = (usedForms.get(key) ?? 0) + 1;
      usedForms.set(key, count);
      if (count > form.sites)
        failures.push(`${key}: too many form Select sites`);
      continue;
    }
    if (control.count !== undefined) {
      if (control.count <= 7)
        failures.push(
          `${key}: ${control.count} choices must use shared filter chips`,
        );
    } else if (!exceptions[key]?.trim())
      failures.push(`${key}: unclassified dynamic choices`);
    else if (used.has(key))
      failures.push(`${key}: exception matches more than one control`);
    else used.add(key);
  }
  for (const key of Object.keys(exceptions)) {
    if (!used.has(key)) failures.push(`${key}: stale dynamic exception`);
  }
  for (const [key, form] of Object.entries(formSelects))
    if ((usedForms.get(key) ?? 0) < form.sites)
      failures.push(`${key}: stale form Select exception`);
  return failures.sort();
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() &&
      entry.name.endsWith(".tsx") &&
      !entry.name.includes(".test.") &&
      !entry.name.includes(".stories.")
      ? [path]
      : [];
  });
}

describe("shared short select policy", () => {
  it("finds aliased shared selects, native selects and mapped options", () => {
    const controls = inspectControls(`
      import { AdminSelect as Picker } from "@crate/ui/composites/AdminSelect";
      import { Select as Menu, SelectItem as Choice } from "@crate/ui/shadcn/select";
      const values = ["one", "two", "three"] as const satisfies readonly string[];
      <><Picker value={kind} options={values.map(value => ({value, label: value}))} allowClear={false} />
      <Menu value={format}>{values.map(value => <Choice value={value}>{value}</Choice>)}</Menu>
      <select value={native}><option value="a">A</option><option value="b">B</option></select></>
    `);
    expect(controls.map(({ component, count }) => [component, count])).toEqual([
      ["AdminSelect", 3],
      ["Select", 3],
      ["select", 2],
    ]);
  });

  it("resolves const aliases, spreads, conditional choices and fixed useMemo results", () => {
    const controls = inspectControls(`
      import { AdminSelect } from "@crate/ui/composites/AdminSelect";
      import { useMemo as memo } from "react";
      const base = ["one", "two"];
      const choices = enabled ? [...base, "three"] : base;
      const final = memo(() => choices.map(value => ({value, label: value})), [enabled]);
      <AdminSelect value={kind} options={final} allowClear={false} />;
    `);
    expect(controls[0]?.count).toBe(3);
    expect(violations(controls, {})).toEqual([
      "fixture.tsx:AdminSelect:kind: 3 choices must use shared filter chips",
    ]);
  });

  it("allows new static menus with at least eight effective choices and counts clear", () => {
    const controls = inspectControls(`
      import { AdminSelect } from "@crate/ui/composites/AdminSelect";
      const seven = [1,2,3,4,5,6,7];
      <AdminSelect value={kind} options={seven.map(value => ({value, label: value}))} />;
    `);
    expect(controls[0]?.count).toBe(8);
    expect(violations(controls, {})).toEqual([]);
  });

  it("checks FilterSelect callers individually instead of exempting their file", () => {
    const controls = inspectControls(`
      function FilterSelect({value, options}) {
        return <><select value={value}>{options.map(option => <option value={option}>{option}</option>)}</select>
        <select value={unrelated}><option value="one">One</option></select></>;
      }
      <><FilterSelect value={locale} options={locales} />
      <FilterSelect value={status} options={["all", "open"]} /></>;
    `);
    expect(controls.map(({ value, count }) => [value, count])).toEqual([
      ["unrelated", 1],
      ["locale", undefined],
      ["status", 2],
    ]);
    expect(
      violations(controls, {
        "fixture.tsx:FilterSelect:locale": "Runtime locale catalog.",
      }),
    ).toEqual([
      "fixture.tsx:FilterSelect:status: 2 choices must use shared filter chips",
      "fixture.tsx:select:unrelated: 1 choices must use shared filter chips",
    ]);
  });

  it("checks each FilterSelect caller when its wrapper forwards mapped options to AdminSelect", () => {
    const controls = inspectControls(`
      function FilterSelect({value, options}) {
        return <><AdminSelect value={value} options={options.map(option => ({value: option, label: option}))} allowClear={false} />
        <AdminSelect value={unrelated} options={["one", "two"]} allowClear={false} /></>;
      }
      <><FilterSelect value={locale} options={locales} />
      <FilterSelect value={status} options={["all", "open"]} /></>;
    `);
    expect(controls.map(({ value, count }) => [value, count])).toEqual([
      ["unrelated", 2],
      ["locale", undefined],
      ["status", 2],
    ]);
    expect(
      violations(controls, {
        "fixture.tsx:FilterSelect:locale": "Runtime locale catalog.",
      }),
    ).toEqual([
      "fixture.tsx:AdminSelect:unrelated: 2 choices must use shared filter chips",
      "fixture.tsx:FilterSelect:status: 2 choices must use shared filter chips",
    ]);
  });

  it("requires exact dynamic exceptions and rejects stale or shortened exceptions", () => {
    const unknown = inspectControls(
      "<AdminSelect value={kind} options={options} />",
    );
    expect(violations(unknown, {})).toEqual([
      "fixture.tsx:AdminSelect:kind: unclassified dynamic choices",
    ]);
    const exception = { "fixture.tsx:AdminSelect:kind": "Server metadata." };
    expect(violations(unknown, exception)).toEqual([]);
    expect(violations([], exception)).toEqual([
      "fixture.tsx:AdminSelect:kind: stale dynamic exception",
    ]);
    expect(
      violations(
        inspectControls("<AdminSelect value={kind} options={[1,2]} />"),
        exception,
      ),
    ).toEqual([
      "fixture.tsx:AdminSelect:kind: 3 choices must use shared filter chips",
      "fixture.tsx:AdminSelect:kind: stale dynamic exception",
    ]);
  });

  it("bounds approved form Selects by value, cardinality, reason and site count", () => {
    const controls = inspectControls(
      "<AdminSelect value={category} options={[1,2]} allowClear={false} />",
    );
    const form = {
      "fixture.tsx:AdminSelect:category": {
        choices: 2,
        sites: 1,
        reason: "Reviewed form field.",
      },
    };
    expect(violations(controls, {}, form)).toEqual([]);
    expect(violations([...controls, ...controls], {}, form)).toEqual([
      "fixture.tsx:AdminSelect:category: too many form Select sites",
    ]);
    expect(violations([], {}, form)).toEqual([
      "fixture.tsx:AdminSelect:category: stale form Select exception",
    ]);
    for (const changed of [
      { ...controls[0]!, count: 3 },
      { ...controls[0]!, value: "filter" },
    ])
      expect(
        violations([changed], {}, form).some((v) =>
          v.includes("must use shared filter chips"),
        ),
      ).toBe(true);
    expect(
      violations(
        controls,
        {},
        {
          "fixture.tsx:AdminSelect:category": {
            ...form["fixture.tsx:AdminSelect:category"],
            reason: " ",
          },
        },
      ),
    ).not.toEqual([]);
  });

  it("keeps lexical constants separate and treats unsupported computation as dynamic", () => {
    const controls = inspectControls(`
      function First() { const options = [1,2]; return <AdminSelect value={first} options={options} allowClear={false} />; }
      function Second() { const options = fetchOptions(); return <AdminSelect value={second} options={options} />; }
      const options = [1,2,3,4,5,6,7,8];
      function Third({options}) { return <AdminSelect value={third} options={options} />; }
    `);
    expect(controls.map(({ count }) => count)).toEqual([
      2,
      undefined,
      undefined,
    ]);
  });

  it("keeps reviewed short filters, form Selects and dynamic menus bounded in both apps", () => {
    const repo = resolve(process.cwd(), "../..");
    const controls = ["app/listen/src", "app/ui/src"].flatMap((directory) =>
      sourceFiles(resolve(repo, directory)).flatMap((path) =>
        inspectControls(
          readFileSync(path, "utf8"),
          relative(repo, path).split("\\").join("/"),
        ),
      ),
    );
    const found = violations(controls, DYNAMIC_SELECTS, FORM_SELECTS);
    expect(found, found.join("\n")).toEqual([]);
  }, 15_000);
});
