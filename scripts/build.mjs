import { chmod, copyFile, mkdir, readdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const file of await readdir("src")) {
  if (file.endsWith(".js")) await copyFile(`src/${file}`, `dist/${file}`);
}
await copyFile("src/index.d.ts", "dist/index.d.ts");
await chmod("dist/index.js", 0o755);
