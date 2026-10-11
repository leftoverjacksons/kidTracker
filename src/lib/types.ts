export type EventType =
  | 'sleep' | 'nursing' | 'bottle' | 'diaper' | 'pump' | 'medicine'
  | 'temperature' | 'growth' | 'tummy_time' | 'bath' | 'note';

export interface Caregiver {
  id: string;
  email: string | null;
  display_name: string;
}

export interface Baby {
  id: string;
  name: string;
  birth_date: string | null; // YYYY-MM-DD
}

export interface HouseholdSettings {
  volume_unit: 'oz' | 'ml';
  temp_unit: 'F' | 'C';
  weight_unit: 'lb_oz' | 'kg';
  length_unit: 'in' | 'cm';
}

export const DEFAULT_SETTINGS: HouseholdSettings = {
  volume_unit: 'oz',
  temp_unit: 'F',
  weight_unit: 'lb_oz',
  length_unit: 'in',
};

export interface NursingSegment {
  id: string;
  event_id: string;
  side: 'left' | 'right';
  started_at: string;
  ended_at: string | null;
}

export interface EventRow {
  id: string;
  baby_id: string;
  type: EventType;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
  bottle_ml: number | null;
  bottle_contents: 'breast_milk' | 'formula' | 'mixed' | null;
  diaper_wet: boolean | null;
  diaper_dirty: boolean | null;
  poop_color: string | null;
  poop_consistency: string | null;
  diaper_rash: boolean | null;
  pump_side: 'left' | 'right' | 'both' | null;
  pump_left_ml: number | null;
  pump_right_ml: number | null;
  medication_id: string | null;
  dose_amount: number | null;
  dose_unit: string | null;
  temp_c: number | null;
  temp_method: string | null;
  weight_g: number | null;
  length_cm: number | null;
  head_cm: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  nursing_segments?: NursingSegment[];
}

/** Columns a client may set on insert/update. */
export type EventFields = Partial<Omit<EventRow,
  'id' | 'baby_id' | 'created_by' | 'updated_by' | 'created_at' | 'updated_at' | 'nursing_segments'>>;

export interface Medication {
  id: string;
  name: string;
  default_dose: number | null;
  unit: string | null;
  min_interval_hours: number | null;
  max_doses_per_24h: number | null;
  active: boolean;
}

export const TIMED_TYPES = ['sleep', 'nursing', 'pump', 'tummy_time'] as const;
export type TimedType = (typeof TIMED_TYPES)[number];
