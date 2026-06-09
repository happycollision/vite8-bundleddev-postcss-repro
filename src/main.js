document.querySelector('#app').textContent = 'Hello from Vite bundledDev'

// Dynamic import of a CSS module forces Rolldown's lazy bundling in bundledDev
// mode, which wraps the CSS module in a JS proxy carrying ?rolldown-lazy=1.
await import('./global.css')
