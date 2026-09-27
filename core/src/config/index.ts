// config/ — load and validate .reprise.yml v3
// Owned by: Base (full implementation). All tracks use this.
// Spec: 02-specs/reprise-config.md
export { createConfig, configSourceFromFileSystem, normaliseConfig } from './config';
export type { ConfigService } from '../contracts/services';
