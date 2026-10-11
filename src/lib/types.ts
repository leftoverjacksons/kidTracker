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
