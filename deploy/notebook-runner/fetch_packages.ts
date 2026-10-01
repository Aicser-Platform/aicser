/**
 * Build step: vendor the Python packages scheduled notebook runs can import, so the runner
 * never needs the internet at run time. Every file is checked against the sha256 in Pyodide's
 * lock file.
 */
const VERSION = Deno.args[0] ?? "0.28.3";
const CDN = `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/`;
const DIR = "/runner/pyodide/";
// What notebooks reach for; their dependencies are added from the lock file.
const ROOTS = ["numpy", "pandas", "matplotlib", "scipy", "scikit-learn", "statsmodels"];

type Pkg = { file_name: string; sha256: string; depends?: string[] };
const lock = JSON.parse(await Deno.readTextFile(`${DIR}pyodide-lock.json`)) as { packages: Record<string, Pkg> };
const need = new Set<string>();
const stack = [...ROOTS];
while (stack.length) {
  const name = stack.pop()!;
  if (need.has(name)) continue;
  const pkg = lock.packages[name];
  if (!pkg) throw new Error(`Not in the Pyodide lock file: ${name}`);
  need.add(name);
  stack.push(...(pkg.depends ?? []));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

for (const name of [...need].sort()) {
  const pkg = lock.packages[name];
  const res = await fetch(CDN + pkg.file_name);
  if (!res.ok) throw new Error(`Download failed for ${pkg.file_name}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (await sha256(bytes) !== pkg.sha256) throw new Error(`Checksum mismatch for ${pkg.file_name}`);
  await Deno.writeFile(DIR + pkg.file_name, bytes);
  console.log(`vendored ${pkg.file_name} (${(bytes.length / 1e6).toFixed(1)} MB)`);
}
console.log(`${need.size} packages vendored`);
