import {
  readdir,
  readFile,
  writeFile,
  mkdir,
  rm,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import { transform } from "esbuild";
import { minify } from "html-minifier-terser";

async function buildDirectory(source, destination) {
  await mkdir(destination, { recursive: true });

  for (const entry of await readdir(source, { withFileTypes: true })) {
    const input = path.join(source, entry.name);
    const output = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      await buildDirectory(input, output);
      continue;
    }

    const extension = path.extname(entry.name);

    if (extension === ".html") {
      const html = await readFile(input, "utf8");
      await writeFile(
        output,
        await minify(html, {
          collapseWhitespace: true,
          conservativeCollapse: true,
          removeComments: true,
        }),
      );
    } else if (extension === ".js" || extension === ".css") {
      const sourceText = await readFile(input, "utf8");
      const result = await transform(sourceText, {
        loader: extension === ".js" ? "js" : "css",
        minify: true,
      });
      await writeFile(output, result.code);
    } else {
      await copyFile(input, output);
    }
  }
}

await rm("dist", { recursive: true, force: true });
await buildDirectory("public", "dist");
console.log("Built public/ → dist/");
