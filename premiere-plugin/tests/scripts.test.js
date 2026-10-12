// The Mac scripts can't run here, but their top level can: this catches code that ends up outside a function
// (which stops the whole script before it does anything).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const stub = () => new Proxy(function () {}, { get: () => stub(), apply: () => stub() });

for (const name of ["uploads.js", "stories.js"]) {
  test(`${name} loads`, () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "stories", name), "utf8");
    const app = () => stub();
    app.currentApplication = () => stub();
    const run = new Function("ObjC", "Application", "$", "delay", `${src}\n;return typeof run;`);
    assert.strictEqual(run({ import() {}, unwrap: () => "/Users/test" }, app, stub(), () => {}), "function");
  });
}

// Every function the Mac scripts call must exist (a missing one only shows up halfway through a run on the Mac)
const BUILTINS = new Set(("if for while switch catch function return typeof new delay Number String Boolean JSON Math Date " +
  "Object Array Set Map Error RegExp parseInt parseFloat isNaN eval require Application ObjC encodeURIComponent " +
  "decodeURIComponent setTimeout Promise Symbol $").split(" "));
for (const name of ["uploads.js", "stories.js"]) {
  test(`${name}: every function it calls exists`, () => {
    let src = fs.readFileSync(path.join(__dirname, "..", "stories", name), "utf8");
    // leave out page code (template strings), strings, comments and regexes
    src = src.replace(/`(?:\\[\s\S]|[^`\\])*`/g, "``").replace(/\/\/[^\n]*/g, "").replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""')
      .replace(/(?<=[=(,:!&|?;{}]\s*|return\s+)\/(?![*\/])(?:\\.|\[(?:\\.|[^\]])*\]|[^\/\\\n])+\/[gimsuy]*/g, "/x/");
    const defined = new Set([...src.matchAll(/(?:function\s+|(?:const|let|var)\s+|class\s+)([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
    for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) m[1].split(",").forEach((a) => defined.add(a.trim().replace(/=.*/, "").replace(/[{}\[\]\s.]/g, "")));
    for (const m of src.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g)) m[1].split(",").forEach((a) => defined.add(a.trim().replace(/=.*/, "")));
    for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) defined.add(m[1]);
    const missing = new Set();
    for (const m of src.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const n = m[2];
      if (!defined.has(n) && !BUILTINS.has(n)) missing.add(n);
    }
    assert.deepStrictEqual([...missing], []);
  });
}
