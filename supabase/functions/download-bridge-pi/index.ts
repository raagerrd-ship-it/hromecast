import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "Content-Disposition",
};

const GITHUB_OWNER = "raagerrd-ship-it";
const GITHUB_REPO = "hromecast";
const GITHUB_BRANCH = "main";
const GITHUB_API_BASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/bridge-pi`;

const FILES = [
  "index.js",
  "package.json",
  ".env.example",
  "README.md",
  "public/index.html",
  "public/style.css",
  "public/app.js",
  "install-linux.sh",
  "update.sh",
  "uninstall-linux.sh",
];

function createZip(files: Record<string, Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const entries: { name: string; data: Uint8Array; crc: number; offset: number }[] = [];
  
  function crc32(data: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    for (let i = 0; i < data.length; i++) {
      crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  let totalSize = 0;
  for (const [name, data] of Object.entries(files)) {
    const fileName = "cast-away-pi/" + name;
    totalSize += 30 + fileName.length + data.length;
    totalSize += 46 + fileName.length;
  }
  totalSize += 22;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);
  let offset = 0;
  let centralOffset = 0;

  for (const [name, data] of Object.entries(files)) {
    const fileName = "cast-away-pi/" + name;
    const fileNameBytes = encoder.encode(fileName);
    const crc = crc32(data);

    entries.push({ name: fileName, data, crc, offset });

    view.setUint32(offset, 0x04034B50, true); offset += 4;
    view.setUint16(offset, 20, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint32(offset, crc, true); offset += 4;
    view.setUint32(offset, data.length, true); offset += 4;
    view.setUint32(offset, data.length, true); offset += 4;
    view.setUint16(offset, fileNameBytes.length, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;

    uint8.set(fileNameBytes, offset); offset += fileNameBytes.length;
    uint8.set(data, offset); offset += data.length;
  }

  centralOffset = offset;

  for (const entry of entries) {
    const fileNameBytes = encoder.encode(entry.name);

    view.setUint32(offset, 0x02014B50, true); offset += 4;
    view.setUint16(offset, 20, true); offset += 2;
    view.setUint16(offset, 20, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint32(offset, entry.crc, true); offset += 4;
    view.setUint32(offset, entry.data.length, true); offset += 4;
    view.setUint32(offset, entry.data.length, true); offset += 4;
    view.setUint16(offset, fileNameBytes.length, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint32(offset, 0, true); offset += 4;
    view.setUint32(offset, entry.offset, true); offset += 4;

    uint8.set(fileNameBytes, offset); offset += fileNameBytes.length;
  }

  const centralSize = offset - centralOffset;

  view.setUint32(offset, 0x06054B50, true); offset += 4;
  view.setUint16(offset, 0, true); offset += 2;
  view.setUint16(offset, 0, true); offset += 2;
  view.setUint16(offset, entries.length, true); offset += 2;
  view.setUint16(offset, entries.length, true); offset += 2;
  view.setUint32(offset, centralSize, true); offset += 4;
  view.setUint32(offset, centralOffset, true); offset += 4;
  view.setUint16(offset, 0, true);

  return uint8.slice(0, offset + 2);
}

const VERSION_PLACEHOLDER = "__BRIDGE_VERSION__";

async function fetchVersion(): Promise<string> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const response = await fetch(`${supabaseUrl}/functions/v1/get-version`);
    if (!response.ok) return "1.4.0";
    const data = await response.json();
    return data.version || "1.4.0";
  } catch {
    return "1.4.0";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const version = await fetchVersion();
    const githubToken = Deno.env.get("GITHUB_TOKEN");
    if (!githubToken) throw new Error("GITHUB_TOKEN not configured");

    const fileContents: Record<string, Uint8Array> = {};
    const encoder = new TextEncoder();
    
    for (const file of FILES) {
      const url = `${GITHUB_API_BASE}/${file}?ref=${GITHUB_BRANCH}`;
      const response = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${githubToken}`,
          "Accept": "application/vnd.github.v3.raw",
          "User-Agent": "CastAway-Pi-Downloader",
        },
      });
      
      if (!response.ok) throw new Error(`Failed to fetch ${file}: ${response.statusText}`);
      
      let content = await response.text();
      
      if (file === "index.js") {
        content = content.replace(VERSION_PLACEHOLDER, version);
        content = content.replace(/const BRIDGE_VERSION = '[^']+';/, `const BRIDGE_VERSION = '${version}';`);
      }
      
      fileContents[file] = encoder.encode(content);
    }

    const zipData = createZip(fileContents);

    return new Response(zipData.buffer as ArrayBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename=cast-away-pi-v${version}.zip`,
        "Content-Length": zipData.length.toString(),
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
