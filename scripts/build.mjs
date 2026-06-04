import { chmod, copyFile, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await copyFile("src/index.js", "dist/index.js");
await copyFile("src/index.d.ts", "dist/index.d.ts");
await chmod("dist/index.js", 0o755);
