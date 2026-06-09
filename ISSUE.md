# `experimental.bundledDev` crashes with `CssSyntaxError: Unclosed string` when a lazily-bundled CSS module is processed by PostCSS

> Title to use when filing: **`experimental.bundledDev`: `vite:css` runs PostCSS on Rolldown's `?rolldown-lazy` JS proxy → `CssSyntaxError: Unclosed string`**

### Describe the bug

In Vite's experimental full-bundle dev mode (`experimental.bundledDev: true`), importing a `.css` file in a project that also uses PostCSS causes a **hard build-time crash**. The dev server starts, but as soon as the CSS module is pulled in through Rolldown's lazy bundling, the build fails and never recovers. The browser is stuck on the bundledDev "Bundling in progress" screen with the error overlay, and **no page reload recovers** — the bundle itself fails to build.

What I expect: the CSS module is processed by PostCSS as CSS and the page renders.
What actually happens: `vite:css` runs PostCSS on a JavaScript proxy module and PostCSS throws while trying to parse JS as CSS.

```
✘ Build error: Build failed with 1 error:

[plugin vite:css] /path/to/src/global.css?rolldown-lazy=1:15:41
CssSyntaxError: [postcss] /path/to/src/global.css?rolldown-lazy=1:15:42: Unclosed string
    at Input.error (.../node_modules/postcss/lib/input.js:135:16)
    at unclosed (.../node_modules/postcss/lib/tokenize.js:46:17)
    at Object.nextToken (.../node_modules/postcss/lib/tokenize.js:161:15)
    at Parser.other (.../node_modules/postcss/lib/parser.js:428:30)
    at Parser.parse (.../node_modules/postcss/lib/parser.js:479:16)
    at parse (.../node_modules/postcss/lib/parse.js:11:12)
    at new LazyResult (.../node_modules/postcss/lib/lazy-result.js:165:16)
    at Processor.process (.../node_modules/postcss/lib/processor.js:53:14)
    at runPostCSS (.../node_modules/vite/dist/node/chunks/node.js:21166:66)
    at async compilePostCSS (.../node_modules/vite/dist/node/chunks/node.js:21150:6)
```

#### Root cause

In `bundledDev` mode, Rolldown's lazy bundling wraps each lazily-loaded module in a JavaScript proxy. For a CSS module it keeps the original id and appends a query, `…/src/global.css?rolldown-lazy=1`, but the **content of that module is JavaScript**, roughly:

```js
const lazyExports = (async () => {
  delete __rolldown_runtime__.modules["src/global.css?rolldown-lazy=1"];
  await import(/* @vite-ignore */ `/@vite/lazy?id=${encodeURIComponent(...)}&clientId=...`);
  return __rolldown_runtime__.loadExports("src/global.css");
})();
export { lazyExports as 'rolldown:exports' };
```

Vite's `vite:css` plugin decides whether to transform a module by matching the file extension:

```js
const CSS_LANGS_RE = /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/
```

and only skips ids matching `commonjsProxyRE` and `SPECIAL_QUERY_RE` (`/[?&](?:worker|sharedworker|raw|url)\b/`). The `?rolldown-lazy` query is **not** excluded, so `vite:css` runs PostCSS (`runPostCSS` / `compilePostCSS`) on the JavaScript proxy module. PostCSS tries to parse JS as CSS and throws `Unclosed string` (the quoted export name in `export { lazyExports as '…' }`).

#### Suggested fix

`vite:css`'s `transform` should skip ids that carry the `?rolldown-lazy` query — those are Rolldown JS proxies, not CSS (e.g. add it to the special-query exclusion or short-circuit when the query is present).

I have not submitted a PR for this.

### Reproduction

https://github.com/happycollision/vite8-bundleddev-postcss-repro

The repository is the smallest project that reproduces it: a vanilla Vite app with `experimental.bundledDev: true`, a `postcss.config.js` registering `autoprefixer`, an `index.html`, an entry `src/main.js` that imports a `.css` file, and a valid `src/global.css`.

### Steps to reproduce

```bash
git clone https://github.com/happycollision/vite8-bundleddev-postcss-repro
cd vite8-bundleddev-postcss-repro
npm install
npm run dev
# open http://localhost:5173/ in a browser
```

The dev server terminal prints the `CssSyntaxError: Unclosed string` build error shown above, and the browser is stuck on the "Bundling in progress" overlay. This happens with the **dev** server (`npm run dev`); `vite build` is not affected.

Details that matter for reproduction:

- **PostCSS must actually run.** The crash is inside `runPostCSS`/`compilePostCSS`, so a real PostCSS plugin (`autoprefixer`) is configured. The sample CSS uses `user-select`, which autoprefixer rewrites — confirming PostCSS is in the pipeline, not no-op'd.
- **The CSS is loaded through lazy bundling.** In the repro `src/main.js` uses `await import('./global.css')`, which forces Rolldown to emit the `?rolldown-lazy=1` proxy. (A statically-imported CSS module that lands in the initial entry bundle is inlined eagerly and does not hit this path.)
- The `.css` itself is perfectly valid — this is not a CSS authoring error.

#### Regression range (bisected)

| Version                  | Result          |
| ------------------------ | --------------- |
| 8.0.0 / 8.0.8 / 8.0.12   | ✅ works         |
| **8.0.13**               | ❌ first broken  |
| 8.0.14 / 8.0.16          | ❌ broken        |

Verified in the repro: switching to `vite@8.0.12` renders the app and processes the CSS with no error; switching back to `vite@8.0.16` crashes with the trace above. Introduced in **8.0.13** by "bundled-dev: add lazy bundling support" (#21406).

#### Related issues

This is distinct from the two existing bundledDev reports:

- **#22454** (closed — "fixed in 8.0.14"): an alias × dynamic-import edge case. Different trigger, and that fix does **not** address this — our case is still broken in 8.0.16.
- **#22596** (open): a *first-load asset* issue, i.e. a recoverable runtime/first-load failure.

This issue is different in kind: it is a **hard build-time PostCSS crash** (`vite:css` running PostCSS on a `?rolldown-lazy=1` JS proxy), not a recoverable first-load runtime failure. The bundle never builds, so a reload does not fix it.

### System Info

```shell
  System:
    OS: macOS 26.5.1
    CPU: (16) arm64 Apple M4 Max
    Memory: 1.22 GB / 64.00 GB
    Shell: 5.9 - /bin/zsh
  Binaries:
    Node: 24.14.1
    npm: 11.11.0
    pnpm: 10.33.0
  Browsers:
    Chrome: 149.0.7827.54
    Firefox: 151.0.2
    Safari: 26.5
  npmPackages:
    vite: 8.0.16 => 8.0.16
    rolldown: 1.0.3 (bundled via vite@8.0.16)
```

### Used Package Manager

npm

### Logs

<details>
<summary>Click to expand!</summary>

```shell
✘ Build error: Build failed with 1 error:

[plugin vite:css] /path/to/src/global.css?rolldown-lazy=1:15:41
CssSyntaxError: [postcss] /path/to/src/global.css?rolldown-lazy=1:15:42: Unclosed string
    at Input.error (.../node_modules/postcss/lib/input.js:135:16)
    at unclosed (.../node_modules/postcss/lib/tokenize.js:46:17)
    at Object.nextToken (.../node_modules/postcss/lib/tokenize.js:161:15)
    at Parser.other (.../node_modules/postcss/lib/parser.js:428:30)
    at Parser.parse (.../node_modules/postcss/lib/parser.js:479:16)
    at parse (.../node_modules/postcss/lib/parse.js:11:12)
    at new LazyResult (.../node_modules/postcss/lib/lazy-result.js:165:16)
    at Processor.process (.../node_modules/postcss/lib/processor.js:53:14)
    at runPostCSS (.../node_modules/vite/dist/node/chunks/node.js:21166:66)
    at async compilePostCSS (.../node_modules/vite/dist/node/chunks/node.js:21150:6)
```

The full captured output is committed in the reproduction as [`error-8.0.16.log`](https://github.com/happycollision/vite8-bundleddev-postcss-repro/blob/master/error-8.0.16.log).

</details>

### Validations

- [x] Follow our [Code of Conduct](https://github.com/vitejs/vite/blob/main/CODE_OF_CONDUCT.md)
- [x] Read the [Contributing Guidelines](https://github.com/vitejs/vite/blob/main/CONTRIBUTING.md).
- [x] Read the [docs](https://vite.dev/guide).
- [x] Check that there isn't [already an issue](https://github.com/vitejs/vite/issues) that reports the same bug to avoid creating a duplicate.
- [x] Make sure this is a Vite issue and not a framework-specific issue. For example, if it's a Vue SFC related bug, it should likely be reported to [vuejs/core](https://github.com/vuejs/core) instead.
- [x] Check that this is a concrete bug. For Q&A open a [GitHub Discussion](https://github.com/vitejs/vite/discussions) or join our [Discord Chat Server](https://chat.vite.dev/).
- [x] The provided reproduction is a [minimal reproducible example](https://stackoverflow.com/help/minimal-reproducible-example) of the bug.
