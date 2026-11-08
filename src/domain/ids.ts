import { v5 as uuidv5, v7 as uuidv7 } from 'uuid';
import type { UUID } from './types';

/**
 * App namespace for natural (UUID v5) IDs. NEVER change this value: every
 * install must derive identical IDs for the same natural key (FC-5).
 */
export const LIFE_DB_NAMESPACE = '3f1c0b6e-6a2d-4c39-9a8e-5d1f2b7c4e90';

/** Random, time-ordered ID for records with their own identity (FC-1). */
export const newId = (): UUID => uuidv7();

export type NaturalIdKind = 'habit_entry' | 'goal_habit' | 'goal_month' | 'entity_tag';

/**
 * Deterministic ID for records identified by what they link (FC-5), so two devices
 * creating "the same" record produce the same row ID and sync merges instead of clashing.
 */
export const naturalId = (kind: NaturalIdKind, ...parts: string[]): UUID =>
  uuidv5([kind, ...parts].join('\u001f'), LIFE_DB_NAMESPACE);

/** Fixed IDs of the default categories (CAT-1, FC-5). Must match 0002_seed.sql. */
export const DEFAULT_CATEGORY_IDS = {
  health: '0190a6e0-0000-7000-8000-000000000001',
  work: '0190a6e0-0000-7000-8000-000000000002',
  money: '0190a6e0-0000-7000-8000-000000000003',
  learning: '0190a6e0-0000-7000-8000-000000000004',
  relationships: '0190a6e0-0000-7000-8000-000000000005',
  home: '0190a6e0-0000-7000-8000-000000000006',
  personal: '0190a6e0-0000-7000-8000-000000000007',
  leisure: '0190a6e0-0000-7000-8000-000000000008',
} as const;
