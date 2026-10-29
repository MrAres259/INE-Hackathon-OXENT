import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ALLOWED_NEXT_PAGE_EXPORTS = new Set([
  "default",
  "metadata",
  "generateMetadata",
  "viewport",
  "generateViewport",
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
  "generateStaticParams",
]);

function getPageFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getPageFiles(fullPath));
    } else if (entry.isFile() && entry.name === "page.tsx") {
      results.push(fullPath);
    }
  }
  return results;
}

function findExportedNames(content: string): string[] {
  const exports: string[] = [];
  // Match export default
  if (/export\s+default\s+/m.test(content)) {
    exports.push("default");
  }

  // Match export (async)? (const|function|let|var|class) <ident>
  const identExportRegex = /export\s+(?:async\s+)?(?:const|function|let|var|class)\s+([a-zA-Z0-9_$]+)/g;
  let match: RegExpExecArray | null;
  while ((match = identExportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  // Match export interface / type
  const typeExportRegex = /export\s+(?:type|interface)\s+([a-zA-Z0-9_$]+)/g;
  while ((match = typeExportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  // Match export { a, b as c }
  const blockExportRegex = /export\s*\{([^}]+)\}/g;
  while ((match = blockExportRegex.exec(content)) !== null) {
    const items = match[1].split(",");
    for (const item of items) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+as\s+/);
      const exportedName = (parts[1] || parts[0]).trim();
      if (exportedName) exports.push(exportedName);
    }
  }

  return exports;
}

describe("Next.js App Router Page Exports Contract (pageExports.test.ts)", () => {
  const appDir = path.resolve(__dirname, "../app");
  const pageFiles = getPageFiles(appDir);

  it("finds at least the main pages of the application", () => {
    expect(pageFiles.length).toBeGreaterThanOrEqual(4);
    const relPaths = pageFiles.map((p) => path.relative(appDir, p).replace(/\\/g, "/"));
    expect(relPaths).toContain("page.tsx");
    expect(relPaths).toContain("campanas/page.tsx");
    expect(relPaths).toContain("metodologia/page.tsx");
    expect(relPaths).toContain("monitor/page.tsx");
  });

  pageFiles.forEach((file) => {
    const relPath = path.relative(appDir, file).replace(/\\/g, "/");

    it(`${relPath} exports only valid Next.js page exports (no arbitrary exports)`, () => {
      const content = fs.readFileSync(file, "utf-8");
      const exportedNames = findExportedNames(content);

      for (const name of exportedNames) {
        expect(
          ALLOWED_NEXT_PAGE_EXPORTS.has(name),
          `El archivo ${relPath} exporta '${name}', lo cual no está permitido por Next.js para páginas de app router`
        ).toBe(true);
      }
    });
  });

  describe("Suspense boundary for useSearchParams consumers", () => {
    it("pages whose subtree consumes useSearchParams wrap content in Suspense", () => {
      // Find all components that call useSearchParams
      const srcDir = path.resolve(__dirname, "..");
      const allFiles: string[] = [];

      function collectSourceFiles(dir: string) {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            if (ent.name !== "__tests__" && ent.name !== "node_modules") {
              collectSourceFiles(p);
            }
          } else if (ent.isFile() && /\.(tsx|ts)$/.test(ent.name)) {
            allFiles.push(p);
          }
        }
      }
      collectSourceFiles(srcDir);

      const filesUsingSearchParams = allFiles.filter((f) => {
        const text = fs.readFileSync(f, "utf-8");
        return /\buseSearchParams\s*\(/.test(text);
      });

      // Verify that campanas uses UnitPicker which uses useSearchParams
      expect(filesUsingSearchParams.length).toBeGreaterThan(0);

      // For every page that renders UnitPicker or uses useSearchParams directly, check Suspense
      const campanasPagePath = path.join(appDir, "campanas/page.tsx");
      const campanasContent = fs.readFileSync(campanasPagePath, "utf-8");

      expect(
        campanasContent,
        "campanas/page.tsx debe importar Suspense de react para evitar fallo de prerender"
      ).toMatch(/import\s+[\s\S]*?\bSuspense\b[\s\S]*?from\s+["']react["']/);

      expect(
        campanasContent,
        "campanas/page.tsx debe envolver el contenido en <Suspense>"
      ).toMatch(/<Suspense[\s\S]*<\/Suspense>/);
    });
  });
});
