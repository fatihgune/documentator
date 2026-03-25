import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

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
