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
    assert.strictEqual(run({ import() {}, unwrap: (x) => x }, app, stub(), () => {}), "function");
  });
}
