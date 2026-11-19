import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROOT_FILES = [
  "package.json", "package-lock.json", "tsconfig.json", "next.config.ts",
  "next-env.d.ts", "postcss.config.mjs", "eslint.config.mjs", "drizzle.config.ts",
  "railway.toml", "vercel.json", ".gitignore", ".nvmrc", ".env.example",
];
const SOURCE_DIRS = ["src", "public"];

/** Never package credentials, local builds or dependency trees. */
function allowed(relativePath: string) {
  const normalized = relativePath.split(path.sep).join("/");
  const basename = normalized.split("/").pop() || "";
  const isSecretEnv = basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example");
  return !/(^|\/)(node_modules|\.next|\.git)(\/|$)/.test(normalized)
    && !isSecretEnv
    && !normalized.endsWith(".log");
}

async function addDirectory(dir: string, files: Record<string, Uint8Array>, root: string) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(/*turbopackIgnore: true*/ dir, entry.name);
    const relative = path.relative(root, absolute);
    if (!allowed(relative)) continue;
    if (entry.isDirectory()) await addDirectory(absolute, files, root);
    else if (entry.isFile()) files[relative.split(path.sep).join("/")] = new Uint8Array(await readFile(absolute));
  }
}

export async function GET() {
  try {
    const root = process.cwd();
    const files: Record<string, Uint8Array> = {};
    for (const filename of ROOT_FILES) {
      try {
        if (allowed(filename)) files[filename] = new Uint8Array(await readFile(path.join(/*turbopackIgnore: true*/ root, filename)));
      } catch { /* optional config file is absent */ }
    }
    for (const dir of SOURCE_DIRS) await addDirectory(path.join(/*turbopackIgnore: true*/ root, dir), files, root);

    files["README-UPLOAD.txt"] = strToU8(`SpreadHunter source package

This ZIP is safe to upload to GitHub. It intentionally excludes .env, node_modules,
.next and all local secrets.

Render deployment:
1. Upload all files and folders from this ZIP to your GitHub repository.
2. Keep src/ and public/ at the repository root, alongside package.json.
3. Render Build Command: npm install && npm run build
4. Render Start Command: npx drizzle-kit push --force && npm start
5. Add DATABASE_URL and exchange API keys only in Render > Environment.
6. After deployment, check /api/health and /api/preflight.
`);

    const archive = zipSync(files, { level: 6 });
    return new NextResponse(archive, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="spreadhunter-source.zip"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[source-export] failed", error);
    return NextResponse.json({ error: "Could not create source ZIP" }, { status: 500 });
  }
}
