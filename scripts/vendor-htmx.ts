import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve(import.meta.dir, "../node_modules/htmx.org/dist/htmx.min.js");
const destination = resolve(import.meta.dir, "../public/htmx-2.0.10.min.js");

await copyFile(source, destination);

const hasher = new Bun.CryptoHasher("sha256");
hasher.update(await Bun.file(destination).arrayBuffer());
console.log(`Vendored htmx 2.0.10 -> public/htmx-2.0.10.min.js`);
console.log(`SHA-256: ${hasher.digest("hex")}`);
