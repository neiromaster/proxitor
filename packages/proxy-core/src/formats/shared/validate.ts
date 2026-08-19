import { invalidRequest } from './format-error.js';

export type Json = Record<string, unknown>;

export function asObject(value: unknown, what: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidRequest(`${what} must be an object`);
  }
  return value as Json;
}

export function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') throw invalidRequest(`${what} must be a string`);
  return value;
}

export function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw invalidRequest(`${what} must be an array`);
  return value;
}
