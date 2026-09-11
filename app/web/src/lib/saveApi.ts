// Ask the local server to write a generated file into the output folder.

export async function saveToFolder(
  filename: string,
  dataUrl: string
): Promise<{ path: string }> {
  const res = await fetch("/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, dataUrl }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Save failed (${res.status})`);
  return json;
}

export async function getOutputDir(): Promise<string> {
  try {
    const res = await fetch("/api/output-dir");
    const json = await res.json();
    return json.dir || "";
  } catch {
    return "";
  }
}
