import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

function loadSchema(name: string) {
  const raw = readFileSync(join(__dirname, "schemas", name), "utf-8");
  return JSON.parse(raw);
}

const serviceManifestSchema = loadSchema("service-manifest.schema.json");
const validateManifest = ajv.compile(serviceManifestSchema);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateServiceManifest(data: unknown): ValidationResult {
  const valid = validateManifest(data);
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validateManifest.errors ?? []).map(
    (e) => `${e.instancePath || "/"}: ${e.message}`
  );
  return { valid: false, errors };
}

const flowSchema = loadSchema("flow.schema.json");
const validateFlowSchema = ajv.compile(flowSchema);

export function validateFlow(data: unknown): ValidationResult {
  const valid = validateFlowSchema(data);
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validateFlowSchema.errors ?? []).map(
    (e) => `${e.instancePath || "/"}: ${e.message}`
  );
  return { valid: false, errors };
}

const indexSchema = loadSchema("index.schema.json");
const validateIndexSchema = ajv.compile(indexSchema);

export function validateIndex(data: unknown): ValidationResult {
  const valid = validateIndexSchema(data);
  if (valid) {
    return { valid: true, errors: [] };
  }
  const errors = (validateIndexSchema.errors ?? []).map(
    (e) => `${e.instancePath || "/"}: ${e.message}`
  );
  return { valid: false, errors };
}

export function detectFileType(
  data: unknown
): "service-manifest" | "flow" | "index" | "unknown" {
  if (typeof data !== "object" || data === null) return "unknown";
  const keys = Object.keys(data);
  if (keys.includes("schema_version") && keys.includes("service")) return "service-manifest";
  if (keys.includes("flow") && keys.includes("steps")) return "flow";
  if (keys.includes("services") && keys.includes("flows")) return "index";
  return "unknown";
}

export function validateAny(data: unknown): ValidationResult & { type: string } {
  const type = detectFileType(data);
  switch (type) {
    case "service-manifest":
      return { ...validateServiceManifest(data), type };
    case "flow":
      return { ...validateFlow(data), type };
    case "index":
      return { ...validateIndex(data), type };
    default:
      return { valid: false, errors: ["Unrecognized file structure"], type: "unknown" };
  }
}

// CLI entry point
const cliFile = process.argv[2];
if (cliFile) {
  const raw = readFileSync(cliFile, "utf-8");
  const data = yaml.load(raw);
  const result = validateAny(data);
  if (result.valid) {
    console.log(`VALID ${result.type}: ${cliFile}`);
  } else {
    console.error(`INVALID ${result.type}: ${cliFile}`);
    result.errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
}
