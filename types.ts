
export enum DosageForm {
  PILL = 'Pill',
  LIQUID = 'Liquid',
  INJECTION = 'Injection',
  CREAM = 'Cream',
  INHALER = 'Inhaler',
  OTHER = 'Other'
}

export type FrequencyType = 'Daily' | 'Interval' | 'As Needed';

export interface Medication {
  id: string;
  name: string;
  dosage: string;
  form: DosageForm;
  color?: string; // Hex code or tailwind color name
  frequency: string; // Human readable label (e.g. "2x Daily")
  frequencyType: FrequencyType; 
  scheduledTimes?: string[]; // Array of times ["08:00", "20:00"]
  intervalHours?: number; // e.g. 4 for "Every 4 hours"
  instructions: string;
  startDate: string;
  refillsRemaining: number;
  inventoryCount: number;
  expiryDate?: string;
  slot?: number; // 1, 2, or 3. undefined means external/manual.
}

export interface UserProfile {
  name: string;
  age: number;
  conditions: string[];
  allergies: string[];
  emergencyContact: string;
  notificationsEnabled?: boolean;
  photoURL?: string;
  timezone?: string;
}

export interface LogEntry {
  id: string;
  medicationId: string;
  medicationName: string;
  timestamp: string;
  status: 'Taken' | 'Missed' | 'Skipped';
  notes?: string;
}

export interface AppNotification {
  id: string;
  type: 'reminder' | 'warning' | 'info' | 'success';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export interface AIAnalysisResult {
  text: string;
  interactions?: string[];
  medicationData?: Partial<Medication>;
}
