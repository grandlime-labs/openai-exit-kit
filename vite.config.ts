import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type IndexHtmlTransformContext, type Plugin } from "vite";

// CSP is injected for production builds only (the dev server needs inline scripts for HMR).
// The converter page must stay locked down: connect-src 'none' means it cannot make
// network requests (fetch/XHR/WebSocket), so "your files never leave your browser"
// is enforced by the browser, not just promised. form-action 'none' blocks form posts.
//
// The landing page uses the same policy today because the optional email form is not
// wired up. If a maintainer later enables Formspree/Tally/Buttondown, loosen ONLY
// LANDING_CSP (and the `/` plus `/index.html` rules in web/public/_headers):
//   form-action https://formspree.io
// Never change CONVERTER_CSP.
const CONVERTER_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'";
const LANDING_CSP = CONVERTER_CSP;

const webRoot = path.dirname(fileURLToPath(new URL("./web/index.html", import.meta.url)));

const cspPlugin = (): Plugin => ({
  name: "inject-csp",
  apply: "build",
  transformIndexHtml: (_html, ctx: IndexHtmlTransformContext) => {
    const p = (ctx.path || ctx.filename || "").replaceAll("\\", "/");
    const csp = p.endsWith("convert.html") ? CONVERTER_CSP : LANDING_CSP;
    return [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: csp }, injectTo: "head-prepend" }];
  },
});

// Multi-page: landing at index.html, converter at convert.html.
// Default base is relative so local preview and non-Pages hosts work. The GitHub Pages
// workflow sets GITHUB_PAGES_BASE to the project path (e.g. /openai-exit-kit/).
function pagesBase(): string {
  const raw = process.env.GITHUB_PAGES_BASE?.trim();
  if (!raw || raw === "./") return "./";
  const withLead = raw.startsWith("/") ? raw : `/${raw}`;
  return withLead.endsWith("/") ? withLead : `${withLead}/`;
}

export default defineConfig({
  root: "web",
  base: pagesBase(),
  plugins: [cspPlugin()],
  server: { fs: { allow: [".."] } },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        index: path.join(webRoot, "index.html"),
        convert: path.join(webRoot, "convert.html"),
      },
    },
  },
});
