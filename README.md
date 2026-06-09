# Vite 8 `bundledDev` + CSS + PostCSS crash repro

Minimal reproduction of a hard build-time crash in Vite's experimental full-bundle dev
mode (`experimental.bundledDev: true`) when a project imports a `.css` file **and** uses
PostCSS.

When the CSS module is loaded through Rolldown's **lazy bundling** (e.g. via a dynamic
import), Rolldown wraps it in a JavaScript proxy that keeps the original id but appends a
`?rolldown-lazy=1` query. Vite's `vite:css` plugin matches on the `.css` extension and does
**not** exclude the `?rolldown-lazy` query, so it runs PostCSS on the JS proxy module.
PostCSS then tries to parse JavaScript as CSS and throws:

```
[plugin vite:css] /.../src/global.css?rolldown-lazy=1:15:41
CssSyntaxError: [postcss] /.../src/global.css?rolldown-lazy=1:15:42: Unclosed string
    ...
    at runPostCSS (.../vite/dist/node/chunks/node.js:21166:66)
    at async compilePostCSS (.../vite/dist/node/chunks/node.js:21150:6)
```

This is a **hard build-time crash** — the server starts but the bundle fails to build, and
no page reload recovers it.

## Reproduce

```bash
npm install
npm run dev
# open http://localhost:5173/ in a browser
```

The browser shows a "Bundling in progress" screen with an error overlay, and the dev
server terminal prints the `CssSyntaxError: Unclosed string` build error above.

The exact captured error output is in [`error-8.0.16.log`](./error-8.0.16.log).

## Regression range

| Version          | Result        |
| ---------------- | ------------- |
| 8.0.0 / 8.0.8 / 8.0.12 | ✅ works  |
| **8.0.13**       | ❌ first broken |
| 8.0.14 / 8.0.16  | ❌ broken     |

Introduced by 8.0.13's "bundled-dev: add lazy bundling support"
([vitejs/vite#21406](https://github.com/vitejs/vite/pull/21406)).

To verify the regression yourself:

```bash
npm install vite@8.0.12 --save-exact --save-dev && npm run dev   # works
npm install vite@8.0.16 --save-exact --save-dev && npm run dev   # crashes
```

## Why these specific files

- `vite.config.js` — enables `experimental.bundledDev: true`.
- `postcss.config.js` — registers `autoprefixer` so PostCSS actually runs (the crash is
  inside `runPostCSS`). The CSS uses `user-select`, which autoprefixer rewrites, proving
  PostCSS is meaningfully in the pipeline.
- `src/main.js` — **dynamically** imports the CSS (`await import('./global.css')`). A
  dynamic import is what forces Rolldown to lazy-bundle the CSS module and emit the
  `?rolldown-lazy=1` proxy that triggers the bug.
- `src/global.css` — perfectly valid CSS (the crash is not a CSS-authoring error).
