// Loads server/openapi.yaml and compiles its component schemas with Ajv (JSON Schema 2020-12).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020';
import type { ValidateFunction } from 'ajv';

// Tests run from out/test/helpers; the spec lives at the package root.
const SPEC = path.resolve(__dirname, '../../../openapi.yaml');

interface OpenApiDoc { openapi: string; components: { schemas: Record<string, unknown> } }

let doc: OpenApiDoc | null = null;
let ajv: Ajv2020 | null = null;

export function loadOpenApi(): OpenApiDoc {
  doc ??= yaml.load(fs.readFileSync(SPEC, 'utf8')) as OpenApiDoc;
  return doc;
}

export function schemaValidator(name: string): ValidateFunction {
  if (!ajv) {
    ajv = new Ajv2020({ strict: false, allErrors: true });
    ajv.addSchema({ $id: 'openapi', components: loadOpenApi().components });
  }
  const v = ajv.getSchema(`openapi#/components/schemas/${name}`);
  if (!v) { throw new Error(`No schema ${name}`); }
  return v;
}

export function assertMatches(name: string, value: unknown): void {
  const v = schemaValidator(name);
  if (!v(value)) {
    throw new Error(`${name} mismatch: ${JSON.stringify(v.errors)}\nvalue: ${JSON.stringify(value).slice(0, 500)}`);
  }
}
