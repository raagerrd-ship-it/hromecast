import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "Content-Disposition",
};

// Simple ZIP file creation without external dependencies
function createZip(files: Record<string, Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const entries: { name: string; data: Uint8Array; crc: number; offset: number }[] = [];
  
  // CRC32 calculation
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

  // Calculate total size
  let totalSize = 0;
  for (const [name, data] of Object.entries(files)) {
    const fileName = "chromecast-bridge/" + name;
    totalSize += 30 + fileName.length + data.length; // Local file header + data
    totalSize += 46 + fileName.length; // Central directory entry
  }
  totalSize += 22; // End of central directory

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);
  let offset = 0;
  let centralOffset = 0;

  // Write local file headers and data
  for (const [name, data] of Object.entries(files)) {
    const fileName = "chromecast-bridge/" + name;
    const fileNameBytes = encoder.encode(fileName);
    const crc = crc32(data);

    entries.push({ name: fileName, data, crc, offset });

    // Local file header
    view.setUint32(offset, 0x04034B50, true); offset += 4; // Signature
    view.setUint16(offset, 20, true); offset += 2; // Version needed
    view.setUint16(offset, 0, true); offset += 2; // Flags
    view.setUint16(offset, 0, true); offset += 2; // Compression (none)
    view.setUint16(offset, 0, true); offset += 2; // Mod time
    view.setUint16(offset, 0, true); offset += 2; // Mod date
    view.setUint32(offset, crc, true); offset += 4; // CRC32
    view.setUint32(offset, data.length, true); offset += 4; // Compressed size
    view.setUint32(offset, data.length, true); offset += 4; // Uncompressed size
    view.setUint16(offset, fileNameBytes.length, true); offset += 2; // File name length
    view.setUint16(offset, 0, true); offset += 2; // Extra field length

    uint8.set(fileNameBytes, offset); offset += fileNameBytes.length;
    uint8.set(data, offset); offset += data.length;
  }

  centralOffset = offset;

  // Write central directory
  for (const entry of entries) {
    const fileNameBytes = encoder.encode(entry.name);

    view.setUint32(offset, 0x02014B50, true); offset += 4; // Signature
    view.setUint16(offset, 20, true); offset += 2; // Version made by
    view.setUint16(offset, 20, true); offset += 2; // Version needed
    view.setUint16(offset, 0, true); offset += 2; // Flags
    view.setUint16(offset, 0, true); offset += 2; // Compression
    view.setUint16(offset, 0, true); offset += 2; // Mod time
    view.setUint16(offset, 0, true); offset += 2; // Mod date
    view.setUint32(offset, entry.crc, true); offset += 4; // CRC32
    view.setUint32(offset, entry.data.length, true); offset += 4; // Compressed size
    view.setUint32(offset, entry.data.length, true); offset += 4; // Uncompressed size
    view.setUint16(offset, fileNameBytes.length, true); offset += 2; // File name length
    view.setUint16(offset, 0, true); offset += 2; // Extra field length
    view.setUint16(offset, 0, true); offset += 2; // Comment length
    view.setUint16(offset, 0, true); offset += 2; // Disk number
    view.setUint16(offset, 0, true); offset += 2; // Internal attrs
    view.setUint32(offset, 0, true); offset += 4; // External attrs
    view.setUint32(offset, entry.offset, true); offset += 4; // Offset

    uint8.set(fileNameBytes, offset); offset += fileNameBytes.length;
  }

  const centralSize = offset - centralOffset;

  // End of central directory
  view.setUint32(offset, 0x06054B50, true); offset += 4; // Signature
  view.setUint16(offset, 0, true); offset += 2; // Disk number
  view.setUint16(offset, 0, true); offset += 2; // Central dir disk
  view.setUint16(offset, entries.length, true); offset += 2; // Entries on disk
  view.setUint16(offset, entries.length, true); offset += 2; // Total entries
  view.setUint32(offset, centralSize, true); offset += 4; // Central dir size
  view.setUint32(offset, centralOffset, true); offset += 4; // Central dir offset
  view.setUint16(offset, 0, true); // Comment length

  return uint8.slice(0, offset + 2);
}

// Storage configuration
const BUCKET = "bridge-files";
const VERSION_PLACEHOLDER = "__BRIDGE_VERSION__";

// Files to include in the ZIP (relative paths in the bucket)
const FILES = [
  { storagePath: "current/index.js", zipPath: "index.js" },
  { storagePath: "current/package.json", zipPath: "package.json" },
  { storagePath: "current/.env.example", zipPath: ".env.example" },
  { storagePath: "current/README.md", zipPath: "README.md" },
  { storagePath: "current/public/index.html", zipPath: "public/index.html" },
  { storagePath: "current/public/style.css", zipPath: "public/style.css" },
  { storagePath: "current/public/app.js", zipPath: "public/app.js" },
  { storagePath: "current/install-linux.sh", zipPath: "install-linux.sh" },
  { storagePath: "current/install-windows.ps1", zipPath: "install-windows.ps1" },
  { storagePath: "current/uninstall-linux.sh", zipPath: "uninstall-linux.sh" },
  { storagePath: "current/uninstall-windows.ps1", zipPath: "uninstall-windows.ps1" },
];

async function fetchVersion(): Promise<string> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const response = await fetch(`${supabaseUrl}/functions/v1/get-version`);
    if (!response.ok) {
      console.error("Failed to fetch version:", response.statusText);
      return "1.0.0";
    }
    const data = await response.json();
    return data.version || "1.0.0";
  } catch (error) {
    console.error("Error fetching version:", error);
    return "1.0.0";
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Starting bridge download...");
    
    // Fetch current version
    const version = await fetchVersion();
    console.log(`Using version: ${version}`);

    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch all files from storage
    const fileContents: Record<string, Uint8Array> = {};
    const encoder = new TextEncoder();
    
    for (const file of FILES) {
      console.log(`Fetching: ${file.storagePath}`);
      
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .download(file.storagePath);
      
      if (error) {
        console.error(`Error fetching ${file.storagePath}:`, error.message);
        throw new Error(`Failed to fetch ${file.storagePath}: ${error.message}`);
      }
      
      // Get file content as text, then convert to Uint8Array
      let content = await data.text();
      
      // Inject version into index.js
      if (file.zipPath === "index.js") {
        content = content.replace(VERSION_PLACEHOLDER, version);
        // Also update the hardcoded version if present
        content = content.replace(/const BRIDGE_VERSION = '[^']+';/, `const BRIDGE_VERSION = '${version}';`);
      }
      
      fileContents[file.zipPath] = encoder.encode(content);
    }

    console.log(`Creating ZIP with ${Object.keys(fileContents).length} files...`);

    // Create ZIP
    const zipData = createZip(fileContents);
    
    console.log(`ZIP created: ${zipData.length} bytes`);

    // Return ZIP file
    return new Response(zipData.buffer as ArrayBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename=chromecast-bridge-v${version}.zip`,
        "Content-Length": zipData.length.toString(),
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error creating bridge download:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
