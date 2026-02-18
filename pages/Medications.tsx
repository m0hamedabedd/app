
import React, { useState, useRef, useEffect } from 'react';
import { Medication, DosageForm, FrequencyType, StomachCondition } from '../types';
import { MedicationCard } from '../components/MedicationCard';
import { scanMedicationBottle } from '../services/geminiService';
import { resolveLanguage, tr } from '../services/i18n';

interface MedicationsProps {
  medications: Medication[];
  onAdd: (med: Medication) => void;
  onUpdate: (med: Medication) => void;
  onDelete: (id: string) => void;
  language?: 'en' | 'ar';
}

const COLORS = [
    { name: 'Red', class: 'bg-red-500', value: 'red' },
    { name: 'Orange', class: 'bg-orange-500', value: 'orange' },
    { name: 'Amber', class: 'bg-amber-400', value: 'amber' },
    { name: 'Green', class: 'bg-emerald-500', value: 'emerald' },
    { name: 'Teal', class: 'bg-teal-500', value: 'teal' },
    { name: 'Blue', class: 'bg-blue-500', value: 'blue' },
    { name: 'Indigo', class: 'bg-indigo-500', value: 'indigo' },
    { name: 'Purple', class: 'bg-violet-500', value: 'violet' },
    { name: 'Pink', class: 'bg-pink-500', value: 'pink' },
    { name: 'Gray', class: 'bg-gray-500', value: 'gray' },
];

const WEEK_DAYS = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 }
];

const STOMACH_OPTIONS: StomachCondition[] = ['Any', 'Before Meal', 'With Meal', 'After Meal', 'Empty Stomach'];

export const Medications: React.FC<MedicationsProps> = ({ medications, onAdd, onUpdate, onDelete, language = 'en' }) => {
  const lang = resolveLanguage(language);
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState(1);
  const [isScanning, setIsScanning] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [simpleMode, setSimpleMode] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form State
  const defaultFormState: Partial<Medication> = {
    name: '',
    dosage: '1',
    form: DosageForm.PILL,
    color: 'teal',
    frequency: 'Daily (08:00)',
    frequencyType: 'Daily',
    scheduledTimes: ['08:00'],
    intervalHours: undefined,
    cycleDays: [0, 1, 2, 3, 4, 5, 6],
    instructions: '',
    notes: '',
    stomachCondition: 'Any',
    isActive: true,
    refillsRemaining: 0,
    inventoryCount: 30,
    expiryDate: '',
    slot: undefined
  };

  const [formData, setFormData] = useState<Partial<Medication>>(defaultFormState);
  
  const updateFrequencyLabel = (type: FrequencyType, times: string[], interval?: number, cycleDays?: number[]) => {
      if (type === 'As Needed') return 'As Needed';
      if (type === 'Interval') return `Every ${interval || 4} Hours`;
      if (type === 'Daily') {
          const cycle = cycleDays && cycleDays.length > 0 ? cycleDays : [0, 1, 2, 3, 4, 5, 6];
          if (cycle.length === 7) return `${times.length}x Daily`;
          return `${times.length}x Daily (${cycle.length}/7 days)`;
      }
      return 'Custom';
  };

  const handleOpenAdd = () => {
      setEditingId(null);
      setFormData(defaultFormState);
      setSimpleMode(true);
      setStep(1);
      setShowModal(true);
  };

  const handleOpenEdit = (med: Medication) => {
      setEditingId(med.id);
      setFormData({ 
        ...med,
        cycleDays: med.cycleDays && med.cycleDays.length > 0 ? med.cycleDays : [0, 1, 2, 3, 4, 5, 6],
        stomachCondition: med.stomachCondition || 'Any',
        notes: med.notes || '',
        isActive: med.isActive !== false
      });
      setSimpleMode(false);
      setStep(1);
      setShowModal(true);
  };

  const handleScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
        setIsScanning(true);
        const file = e.target.files[0];
        try {
            const result = await scanMedicationBottle(file);
            if (result.medication) {
                setFormData(prev => ({
                    ...prev,
                    name: result.medication?.name || prev.name,
                    dosage: result.medication?.dosage || prev.dosage, 
                    instructions: result.medication?.instructions || prev.instructions,
                }));
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsScanning(false);
        }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const finalLabel = updateFrequencyLabel(
        formData.frequencyType || 'Daily',
        formData.scheduledTimes || [],
        formData.intervalHours,
        formData.cycleDays
    );

    const finalData = {
        ...formData,
        frequency: finalLabel
    };

    if (finalData.frequencyType === 'Daily' && (!finalData.scheduledTimes || finalData.scheduledTimes.length === 0)) {
        alert(tr(lang, 'Please add at least one daily time.', '\u064a\u0631\u062c\u0649 \u0625\u0636\u0627\u0641\u0629 \u0648\u0642\u062a \u064a\u0648\u0645\u064a \u0648\u0627\u062d\u062f \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644.'));
        return;
    }

    if (finalData.frequencyType === 'Daily' && (!finalData.cycleDays || finalData.cycleDays.length === 0)) {
        alert(tr(lang, 'Please select at least one day in cycle settings.', '\u064a\u0631\u062c\u0649 \u062a\u062d\u062f\u064a\u062f \u064a\u0648\u0645 \u0648\u0627\u062d\u062f \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644 \u0641\u064a \u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u062f\u0648\u0631\u0629.'));
        return;
    }

    if (finalData.frequencyType === 'Interval' && (!finalData.intervalHours || finalData.intervalHours <= 0)) {
        alert(tr(lang, 'Please set a valid interval in hours.', '\u064a\u0631\u062c\u0649 \u0625\u062f\u062e\u0627\u0644 \u0641\u0627\u0635\u0644 \u0632\u0645\u0646\u064a \u0635\u062d\u064a\u062d \u0628\u0627\u0644\u0633\u0627\u0639\u0627\u062a.'));
        return;
    }

    if (finalData.slot !== undefined) {
        const occupied = medications.find(
            m => m.slot === finalData.slot && m.id !== editingId
        );
        if (occupied) {
            alert(tr(lang, `Slot ${finalData.slot} is already assigned to "${occupied.name}". Choose another slot or None.`, `\u0627\u0644\u0641\u062a\u062d\u0629 ${finalData.slot} \u0645\u062e\u0635\u0635\u0629 \u0645\u0633\u0628\u0642\u064b\u0627 \u0644\u0640 "${occupied.name}". \u0627\u062e\u062a\u0631 \u0641\u062a\u062d\u0629 \u0623\u062e\u0631\u0649 \u0623\u0648 "\u0628\u062f\u0648\u0646".`));
            return;
        }
    }

    if (finalData.name) {
        if (editingId) {
            onUpdate({ ...finalData as Medication, id: editingId });
        } else {
            onAdd({ id: Date.now().toString(), startDate: new Date().toISOString(), ...finalData as Medication });
        }
        setShowModal(false);
        setFormData(defaultFormState);
        setEditingId(null);
    }
  };

  const toggleTime = (time: string) => {
      let current = formData.scheduledTimes || [];
      if (current.includes(time)) {
          current = current.filter(t => t !== time);
      } else {
          current = [...current, time].sort();
      }
      setFormData({...formData, scheduledTimes: current});
  };

  const toggleCycleDay = (day: number) => {
      const current = formData.cycleDays || [0, 1, 2, 3, 4, 5, 6];
      const exists = current.includes(day);
      const next = exists ? current.filter(d => d !== day) : [...current, day].sort((a, b) => a - b);
      setFormData({ ...formData, cycleDays: next });
  };

  const formIcons = {
      [DosageForm.PILL]: 'fa-tablets',
      [DosageForm.LIQUID]: 'fa-prescription-bottle',
      [DosageForm.INJECTION]: 'fa-syringe',
      [DosageForm.CREAM]: 'fa-hand-holding-medical',
      [DosageForm.INHALER]: 'fa-lungs',
      [DosageForm.OTHER]: 'fa-medkit'
  };

  // Helper to get color class
  const getColorClass = (colorName?: string) => {
    const c = COLORS.find(c => c.value === colorName);
    return c ? c.class : 'bg-teal-500';
  };

  const handleToggleMedicationActive = (med: Medication) => {
    onUpdate({ ...med, isActive: med.isActive === false ? true : false });
  };

  const getDosageFormLabel = (form: DosageForm) => {
    switch (form) {
      case DosageForm.PILL:
        return tr(lang, 'Pill', '\u062d\u0628\u0648\u0628');
      case DosageForm.LIQUID:
        return tr(lang, 'Liquid', '\u0633\u0627\u0626\u0644');
      case DosageForm.INJECTION:
        return tr(lang, 'Injection', '\u062d\u0642\u0646');
      case DosageForm.CREAM:
        return tr(lang, 'Cream', '\u0643\u0631\u064a\u0645');
      case DosageForm.INHALER:
        return tr(lang, 'Inhaler', '\u0628\u062e\u0627\u062e');
      default:
        return tr(lang, 'Other', '\u0623\u062e\u0631\u0649');
    }
  };

  const getCycleDayLabel = (dayValue: number) => {
    switch (dayValue) {
      case 0:
        return tr(lang, 'Sun', '\u062d');
      case 1:
        return tr(lang, 'Mon', '\u0646');
      case 2:
        return tr(lang, 'Tue', '\u062b');
      case 3:
        return tr(lang, 'Wed', '\u0631');
      case 4:
        return tr(lang, 'Thu', '\u062e');
      case 5:
        return tr(lang, 'Fri', '\u062c');
      default:
        return tr(lang, 'Sat', '\u0633');
    }
  };

  const activeMeds = medications.filter(m => m.isActive !== false);
  const inactiveMeds = medications.filter(m => m.isActive === false);

  const renderStep1 = () => (
      <div className="space-y-6 animate-fade-in">
          <div className="bg-teal-50 border border-teal-100 rounded-xl p-3 text-sm text-teal-800">
              {tr(lang, 'Fill only the essentials first. You can edit more details later.', '\u0623\u062f\u062e\u0644 \u0627\u0644\u0623\u0633\u0627\u0633\u064a\u0627\u062a \u0623\u0648\u0644\u0627\u064b\u060c \u0648\u064a\u0645\u0643\u0646\u0643 \u062a\u0639\u062f\u064a\u0644 \u0628\u0627\u0642\u064a \u0627\u0644\u062a\u0641\u0627\u0635\u064a\u0644 \u0644\u0627\u062d\u0642\u064b\u0627.')}
          </div>
          {!editingId && (
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 p-1 shadow-lg shadow-indigo-200">
                <input type="file" ref={fileInputRef} onChange={handleScan} accept="image/*" className="hidden" />
                <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isScanning}
                    className="w-full bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-xl py-4 flex flex-col items-center justify-center text-white transition-all group"
                >
                    {isScanning ? (
                        <>
                            <i className="fas fa-circle-notch fa-spin text-2xl mb-2"></i>
                            <span className="font-bold">{tr(lang, 'Analyzing Bottle...', '\u062c\u0627\u0631\u064a \u062a\u062d\u0644\u064a\u0644 \u0639\u0628\u0648\u0629 \u0627\u0644\u062f\u0648\u0627\u0621...')}</span>
                        </>
                    ) : (
                        <>
                            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                                <i className="fas fa-magic text-yellow-300"></i>
                            </div>
                            <span className="font-bold">{tr(lang, 'Auto-Fill with AI Scan', '\u062a\u0639\u0628\u0626\u0629 \u062a\u0644\u0642\u0627\u0626\u064a\u0629 \u0628\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064a')}</span>
                            <span className="text-xs text-indigo-100 opacity-80 mt-1">{tr(lang, 'Take a photo of the bottle label', '\u0627\u0644\u062a\u0642\u0637 \u0635\u0648\u0631\u0629 \u0644\u0645\u0644\u0635\u0642 \u0627\u0644\u0639\u0628\u0648\u0629')}</span>
                        </>
                    )}
                </button>
            </div>
          )}

          <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">{tr(lang, 'Medication Name', '\u0627\u0633\u0645 \u0627\u0644\u062f\u0648\u0627\u0621')}</label>
                <input 
                    required
                    type="text" 
                    className="w-full text-2xl font-bold px-4 py-3 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-teal-500 focus:bg-white focus:ring-0 outline-none transition-all placeholder-gray-300"
                    placeholder={tr(lang, 'e.g. Lisinopril', '\u0645\u062b\u0627\u0644: \u0644\u064a\u0632\u064a\u0646\u0648\u0628\u0631\u064a\u0644')}
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                />
          </div>

          <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">{tr(lang, 'Appearance', '\u0627\u0644\u0634\u0643\u0644')}</label>
                <div className="grid grid-cols-3 gap-2">
                    {Object.values(DosageForm).map(f => (
                        <button
                        key={f}
                        type="button"
                        onClick={() => setFormData({...formData, form: f})}
                        className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${
                            formData.form === f 
                            ? 'border-teal-500 bg-teal-50 text-teal-700' 
                            : 'border-gray-100 bg-white text-gray-400 hover:border-gray-200 hover:bg-gray-50'
                        }`}
                        >
                            <i className={`fas ${formIcons[f]} text-2xl mb-1`}></i>
                            <span className="text-[10px] font-bold">{getDosageFormLabel(f)}</span>
                        </button>
                    ))}
                </div>
          </div>

          <div className="space-y-2">
               <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">{tr(lang, 'Color Code', '\u0644\u0648\u0646 \u0627\u0644\u062a\u0645\u064a\u064a\u0632')}</label>
               <div className="flex flex-wrap gap-3 p-2">
                   {COLORS.map(c => (
                       <button
                           key={c.value}
                           type="button"
                           onClick={() => setFormData({...formData, color: c.value})}
                           className={`w-8 h-8 rounded-full ${c.class} transition-transform ${formData.color === c.value ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'opacity-70 hover:opacity-100 hover:scale-105'}`}
                           aria-label={c.name}
                       />
                   ))}
               </div>
          </div>
      </div>
  );

  const renderStep2 = () => (
      <div className="space-y-6 animate-fade-in">
           <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 space-y-4">
                <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">{tr(lang, 'Dosage', '\u0627\u0644\u062c\u0631\u0639\u0629')}</label>
                    <div className="flex items-center space-x-3 mt-2">
                        <button 
                            type="button" 
                            onClick={() => {
                                const val = Math.max(0, parseFloat(formData.dosage || '0') - 0.5);
                                setFormData({...formData, dosage: val.toString()});
                            }}
                            className="w-12 h-12 rounded-xl bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-600 text-lg hover:bg-gray-100"
                        ><i className="fas fa-minus"></i></button>
                        
                        <div className="flex-1 bg-white rounded-xl border border-gray-200 h-12 flex items-center justify-center relative shadow-inner">
                            <input 
                                type="number" 
                                step="0.5" 
                                className="w-full text-center font-bold text-xl bg-transparent outline-none text-gray-800"
                                value={formData.dosage}
                                onChange={e => setFormData({...formData, dosage: e.target.value})}
                            />
                            <span className="absolute right-4 text-xs font-bold text-gray-400 uppercase">
                                {formData.form === DosageForm.PILL ? tr(lang, 'Pills', '\u062d\u0628\u0627\u062a') : tr(lang, 'Units', '\u0648\u062d\u062f\u0627\u062a')}
                            </span>
                        </div>

                        <button 
                            type="button" 
                            onClick={() => {
                                const val = parseFloat(formData.dosage || '0') + 0.5;
                                setFormData({...formData, dosage: val.toString()});
                            }}
                            className={`w-12 h-12 rounded-xl ${getColorClass(formData.color)} text-white shadow-md flex items-center justify-center text-lg hover:opacity-90`}
                        ><i className="fas fa-plus"></i></button>
                    </div>
                </div>
            </div>

            <div className="space-y-3">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">{tr(lang, 'Frequency', '\u0627\u0644\u062a\u0643\u0631\u0627\u0631')}</label>
                <div className="flex bg-gray-100 p-1 rounded-xl">
                    {(['Daily', 'Interval', 'As Needed'] as FrequencyType[]).map(type => (
                        <button
                            key={type}
                            type="button"
                            onClick={() => setFormData({...formData, frequencyType: type})}
                            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                                formData.frequencyType === type 
                                ? 'bg-white text-gray-800 shadow-sm' 
                                : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            {type === 'Daily'
                              ? tr(lang, 'Daily', '\u064a\u0648\u0645\u064a')
                              : type === 'Interval'
                              ? tr(lang, 'Interval', '\u0641\u0627\u0635\u0644 \u0632\u0645\u0646\u064a')
                              : tr(lang, 'As Needed', '\u0639\u0646\u062f \u0627\u0644\u062d\u0627\u062c\u0629')}
                        </button>
                    ))}
                </div>
            </div>

            {formData.frequencyType === 'Daily' && (
                <div className="space-y-3">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">{tr(lang, 'Quick Times', '\u0623\u0648\u0642\u0627\u062a \u0633\u0631\u064a\u0639\u0629')}</label>
                    <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                        {[
                            { label: tr(lang, 'Morning', '\u0635\u0628\u0627\u062d\u0627\u064b'), time: '08:00', icon: 'fa-sun' },
                            { label: tr(lang, 'Noon', '\u0638\u0647\u0631\u0627\u064b'), time: '12:00', icon: 'fa-cloud-sun' },
                            { label: tr(lang, 'Evening', '\u0645\u0633\u0627\u0621\u064b'), time: '18:00', icon: 'fa-moon' },
                            { label: tr(lang, 'Bed', '\u0642\u0628\u0644 \u0627\u0644\u0646\u0648\u0645'), time: '22:00', icon: 'fa-bed' },
                        ].map(t => {
                            const active = (formData.scheduledTimes || []).includes(t.time);
                            return (
                                <button
                                    key={t.time}
                                    type="button"
                                    onClick={() => toggleTime(t.time)}
                                    className={`px-4 py-2 rounded-lg border flex items-center space-x-2 transition-all ${active ? `bg-${formData.color}-50 border-${formData.color}-200 text-${formData.color}-700` : 'bg-white border-gray-200 text-gray-500'}`}
                                >
                                    <i className={`fas ${t.icon}`}></i>
                                    <span className="text-sm font-medium">{t.label}</span>
                                </button>
                            )
                        })}
                    </div>
                    
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">{tr(lang, 'Exact Times', '\u0623\u0648\u0642\u0627\u062a \u062f\u0642\u064a\u0642\u0629')}</label>
                    <div className="flex flex-wrap gap-2">
                        {formData.scheduledTimes?.map((time, idx) => (
                            <div key={idx} className="relative">
                                <input
                                    type="time"
                                    value={time}
                                    onChange={e => {
                                        const newTimes = [...(formData.scheduledTimes || [])];
                                        newTimes[idx] = e.target.value;
                                        setFormData({...formData, scheduledTimes: newTimes});
                                    }}
                                    className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-bold text-gray-700 outline-none focus:border-teal-500"
                                />
                                <button 
                                    onClick={() => {
                                        const newTimes = formData.scheduledTimes?.filter((_, i) => i !== idx);
                                        setFormData({...formData, scheduledTimes: newTimes});
                                    }}
                                    className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs shadow-sm hover:scale-110 transition-transform"
                                >
                                    <i className="fas fa-times"></i>
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={() => setFormData({...formData, scheduledTimes: [...(formData.scheduledTimes || []), '09:00']})}
                            className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-200"
                        >
                            <i className="fas fa-plus"></i>
                        </button>
                    </div>

                    <div className="pt-2 space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">{tr(lang, 'Cycle Settings', '\u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u062f\u0648\u0631\u0629')}</label>
                            <button
                                type="button"
                                onClick={() => setFormData({ ...formData, cycleDays: [0, 1, 2, 3, 4, 5, 6] })}
                                className="text-[10px] font-bold text-teal-600 bg-teal-50 border border-teal-100 rounded-md px-2 py-1"
                            >
                                {tr(lang, 'Repeat Daily', '\u062a\u0643\u0631\u0627\u0631 \u064a\u0648\u0645\u064a')}
                            </button>
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                            {WEEK_DAYS.map(day => {
                                const active = (formData.cycleDays || [0, 1, 2, 3, 4, 5, 6]).includes(day.value);
                                return (
                                    <button
                                        key={day.value}
                                        type="button"
                                        onClick={() => toggleCycleDay(day.value)}
                                        className={`h-8 rounded-md text-[11px] font-bold border transition-all ${
                                            active
                                                ? 'bg-teal-600 text-white border-teal-600'
                                                : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                                        }`}
                                    >
                                        {getCycleDayLabel(day.value)}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
            
            {formData.frequencyType === 'Interval' && (
                 <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">{tr(lang, 'Repeat every', '\u064a\u062a\u0643\u0631\u0631 \u0643\u0644')}</span>
                    <div className="flex items-center space-x-2">
                        <input
                            type="number"
                            className="w-16 text-center font-bold text-lg border-b-2 border-gray-200 focus:border-teal-500 outline-none p-1"
                            value={formData.intervalHours || 4}
                            onChange={e => setFormData({...formData, intervalHours: parseInt(e.target.value)})}
                        />
                        <span className="text-sm text-gray-500 font-medium">{tr(lang, 'Hours', '\u0633\u0627\u0639\u0627\u062a')}</span>
                    </div>
                </div>
            )}
      </div>
  );

  const renderStep3 = () => (
      <div className="space-y-6 animate-fade-in">
           <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 text-sm text-indigo-800">
              {tr(lang, 'Pick a dispenser slot only if this medicine is physically inside the device.', '\u0627\u062e\u062a\u0631 \u0641\u062a\u062d\u0629 \u0627\u0644\u062c\u0647\u0627\u0632 \u0641\u0642\u0637 \u0625\u0630\u0627 \u0643\u0627\u0646 \u0647\u0630\u0627 \u0627\u0644\u062f\u0648\u0627\u0621 \u0645\u0648\u062c\u0648\u062f\u064b\u0627 \u062f\u0627\u062e\u0644 \u0627\u0644\u062c\u0647\u0627\u0632.')}
           </div>

            <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">{tr(lang, 'Dispenser Slot', '\u0641\u062a\u062d\u0629 \u0627\u0644\u062c\u0647\u0627\u0632')}</label>
                <div className="grid grid-cols-4 gap-2 mt-2">
                        <button
                        type="button"
                        onClick={() => setFormData({...formData, slot: undefined})}
                        className={`py-4 rounded-xl text-xs font-bold border-2 transition-all flex flex-col items-center justify-center ${
                            formData.slot === undefined 
                            ? 'border-gray-800 bg-gray-800 text-white' 
                            : 'border-gray-200 bg-white text-gray-400'
                        }`}
                        >
                            <i className="fas fa-ban mb-1 text-lg"></i>
                            {tr(lang, 'None', '\u0628\u062f\u0648\u0646')}
                        </button>
                        {[1, 2, 3].map(slotNum => {
                            const occupied = medications.find(m => m.slot === slotNum && m.id !== editingId);
                            return (
                                <button
                                key={slotNum}
                                type="button"
                                disabled={!!occupied}
                                onClick={() => setFormData({...formData, slot: slotNum})}
                                className={`relative py-4 rounded-xl text-xs font-bold border-2 transition-all flex flex-col items-center justify-center ${
                                    formData.slot === slotNum
                                    ? 'border-indigo-600 bg-indigo-600 text-white' 
                                    : occupied
                                    ? 'border-red-100 bg-red-50 text-red-300 cursor-not-allowed'
                                    : 'border-gray-200 bg-white text-indigo-600 hover:border-indigo-100'
                                }`}
                                >
                                    <i className="fas fa-microchip mb-1 text-lg"></i>
                                    {tr(lang, 'Slot', '\u0641\u062a\u062d\u0629')} {slotNum}
                                    {occupied && (
                                        <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" title={tr(lang, 'Occupied', '\u0645\u0634\u063a\u0648\u0644\u0629')}></span>
                                    )}
                                </button>
                            );
                        })}
                </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4">
                <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">{tr(lang, 'Stomach Condition', '\u062d\u0627\u0644\u0629 \u0627\u0644\u0645\u0639\u062f\u0629')}</label>
                    <select
                        value={formData.stomachCondition || 'Any'}
                        onChange={e => setFormData({ ...formData, stomachCondition: e.target.value as StomachCondition })}
                        className="w-full mt-1 px-3 py-3 rounded-xl bg-gray-50 border border-transparent focus:bg-white focus:border-teal-500 outline-none text-sm font-medium text-gray-700"
                    >
                        {STOMACH_OPTIONS.map(option => (
                            <option key={option} value={option}>
                              {option === 'Any'
                                ? tr(lang, 'Any', '\u0623\u064a \u0648\u0642\u062a')
                                : option === 'Before Meal'
                                ? tr(lang, 'Before Meal', '\u0642\u0628\u0644 \u0627\u0644\u0637\u0639\u0627\u0645')
                                : option === 'With Meal'
                                ? tr(lang, 'With Meal', '\u0645\u0639 \u0627\u0644\u0637\u0639\u0627\u0645')
                                : option === 'After Meal'
                                ? tr(lang, 'After Meal', '\u0628\u0639\u062f \u0627\u0644\u0637\u0639\u0627\u0645')
                                : tr(lang, 'Empty Stomach', '\u0639\u0644\u0649 \u0645\u0639\u062f\u0629 \u0641\u0627\u0631\u063a\u0629')}
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">{tr(lang, 'Notes', '\u0645\u0644\u0627\u062d\u0638\u0627\u062a')}</label>
                    <textarea
                        rows={3}
                        value={formData.notes || ''}
                        onChange={e => setFormData({ ...formData, notes: e.target.value })}
                        placeholder={tr(lang, 'Example: Take with water, avoid coffee for 1 hour...', '\u0645\u062b\u0627\u0644: \u062e\u0630\u0647 \u0645\u0639 \u0627\u0644\u0645\u0627\u0621\u060c \u0648\u062a\u062c\u0646\u0628 \u0627\u0644\u0642\u0647\u0648\u0629 \u0644\u0645\u062f\u0629 \u0633\u0627\u0639\u0629...')}
                        className="w-full mt-1 px-3 py-3 rounded-xl bg-gray-50 border border-transparent focus:bg-white focus:border-teal-500 outline-none text-sm text-gray-700 resize-none"
                    />
                </div>
            </div>

            <details className="rounded-xl border border-gray-200 bg-white">
                <summary className="cursor-pointer px-4 py-3 font-bold text-gray-700 text-sm">{tr(lang, 'Advanced inventory settings', '\u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0645\u062e\u0632\u0648\u0646 \u0645\u062a\u0642\u062f\u0645\u0629')}</summary>
                <div className="px-4 pb-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gray-50 p-4 rounded-2xl">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">{tr(lang, 'Stock', '\u0627\u0644\u0645\u062e\u0632\u0648\u0646')}</label>
                            <input
                                type="number"
                                className="w-full mt-1 bg-transparent text-3xl font-bold text-gray-800 outline-none"
                                placeholder="30"
                                value={formData.inventoryCount}
                                onChange={e => setFormData({...formData, inventoryCount: parseInt(e.target.value)})}
                            />
                            <p className="text-xs text-gray-400 mt-1">{tr(lang, 'Pills remaining', '\u0627\u0644\u062d\u0628\u0627\u062a \u0627\u0644\u0645\u062a\u0628\u0642\u064a\u0629')}</p>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-2xl">
                            <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">{tr(lang, 'Refills', '\u0625\u0639\u0627\u062f\u0627\u062a \u0627\u0644\u0635\u0631\u0641')}</label>
                            <input
                                type="number"
                                className="w-full mt-1 bg-transparent text-3xl font-bold text-gray-800 outline-none"
                                placeholder="0"
                                value={formData.refillsRemaining}
                                onChange={e => setFormData({...formData, refillsRemaining: parseInt(e.target.value)})}
                            />
                            <p className="text-xs text-gray-400 mt-1">{tr(lang, 'Available', '\u0627\u0644\u0645\u062a\u0627\u062d')}</p>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">{tr(lang, 'Expiry Date', '\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0627\u0646\u062a\u0647\u0627\u0621')}</label>
                        <input
                            type="date"
                            className="w-full mt-1 px-4 py-3 rounded-xl bg-gray-50 border border-transparent focus:bg-white focus:border-teal-500 outline-none transition-all text-gray-700 font-medium"
                            value={formData.expiryDate || ''}
                            onChange={e => setFormData({...formData, expiryDate: e.target.value})}
                        />
                    </div>
                </div>
            </details>
      </div>
  );

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex justify-between items-end sticky top-0 bg-gray-50 backdrop-blur-sm z-20 py-4 -mx-4 px-4 border-b border-gray-100">
        <div>
            <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">{tr(lang, 'Cabinet', '\u062e\u0632\u0627\u0646\u0629 \u0627\u0644\u0623\u062f\u0648\u064a\u0629')}</h2>
            <p className="text-gray-500 text-sm font-medium">
                {tr(lang, `${activeMeds.length} Active | ${inactiveMeds.length} Inactive`, `${activeMeds.length} \u0646\u0634\u0637 | ${inactiveMeds.length} \u063a\u064a\u0631 \u0646\u0634\u0637`)}
            </p>
        </div>
      </div>

      {/* Medication Grid */}
      <div className="space-y-4">
        {activeMeds.length > 0 && (
            <>
                <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400">{tr(lang, 'Active Medications', '\u0627\u0644\u0623\u062f\u0648\u064a\u0629 \u0627\u0644\u0646\u0634\u0637\u0629')}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {activeMeds.map(med => (
                        <MedicationCard 
                            key={med.id} 
                            medication={med} 
                            onEdit={handleOpenEdit} 
                            onDelete={onDelete}
                            onToggleActive={handleToggleMedicationActive}
                            language={lang}
                        />
                    ))}
                </div>
            </>
        )}

        {inactiveMeds.length > 0 && (
            <>
                <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400">{tr(lang, 'Inactive Medications', '\u0627\u0644\u0623\u062f\u0648\u064a\u0629 \u063a\u064a\u0631 \u0627\u0644\u0646\u0634\u0637\u0629')}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {inactiveMeds.map(med => (
                        <MedicationCard 
                            key={med.id} 
                            medication={med} 
                            onEdit={handleOpenEdit} 
                            onDelete={onDelete}
                            onToggleActive={handleToggleMedicationActive}
                            language={lang}
                        />
                    ))}
                </div>
            </>
        )}

        {medications.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-gray-200 rounded-3xl bg-white/50">
                <div className="w-20 h-20 bg-teal-50 rounded-full flex items-center justify-center shadow-sm mb-6">
                    <i className="fas fa-prescription-bottle-alt text-teal-300 text-4xl"></i>
                </div>
                <p className="text-gray-600 font-bold text-lg">{tr(lang, 'Your cabinet is empty', '\u0627\u0644\u062e\u0632\u0627\u0646\u0629 \u0641\u0627\u0631\u063a\u0629')}</p>
                <p className="text-gray-400 text-sm mt-2 max-w-xs mx-auto">{tr(lang, 'Tap the + button to add your first prescription or vitamin.', '\u0627\u0636\u063a\u0637 \u0632\u0631 + \u0644\u0625\u0636\u0627\u0641\u0629 \u0623\u0648\u0644 \u062f\u0648\u0627\u0621 \u0623\u0648 \u0641\u064a\u062a\u0627\u0645\u064a\u0646.')}</p>
            </div>
        )}
      </div>

      {/* Floating Action Button */}
      <button 
        onClick={handleOpenAdd}
        className="fixed bottom-24 right-5 w-16 h-16 bg-gray-900 hover:bg-black text-white rounded-full shadow-2xl shadow-gray-900/40 flex items-center justify-center hover:scale-105 active:scale-95 transition-all z-30 group"
      >
        <i className="fas fa-plus text-2xl group-hover:rotate-90 transition-transform duration-300"></i>
      </button>

      {/* Wizard Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-gray-900/60 z-50 flex items-end sm:items-center justify-center backdrop-blur-sm p-0 sm:p-4 animate-fade-in">
            <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[90vh] animate-slide-up">
                
                {/* Header with Steps */}
                <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-white rounded-t-3xl">
                    <div className="space-y-2">
                        <div className="flex space-x-2">
                            {[1, 2, 3].map(s => (
                                <div key={s} className={`h-1.5 rounded-full transition-all duration-500 ${step >= s ? `w-8 ${getColorClass(formData.color)}` : 'w-2 bg-gray-200'}`}></div>
                            ))}
                        </div>
                        {!editingId && (
                            <button
                                type="button"
                                onClick={() => setSimpleMode(!simpleMode)}
                                className={`text-[11px] font-bold px-2 py-1 rounded-lg border ${simpleMode ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-gray-50 text-gray-600 border-gray-200'}`}
                            >
                                {simpleMode
                                  ? tr(lang, 'Simple mode: ON', '\u0627\u0644\u0648\u0636\u0639 \u0627\u0644\u0628\u0633\u064a\u0637: \u0645\u0641\u0639\u0644')
                                  : tr(lang, 'Simple mode: OFF', '\u0627\u0644\u0648\u0636\u0639 \u0627\u0644\u0628\u0633\u064a\u0637: \u0645\u062a\u0648\u0642\u0641')}
                            </button>
                        )}
                    </div>
                    <button onClick={() => setShowModal(false)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center">
                        <i className="fas fa-times text-gray-500"></i>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 no-scrollbar">
                    <h3 className="text-2xl font-bold text-gray-900 mb-6">
                        {step === 1 && (editingId ? tr(lang, 'Edit Medication', '\u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u062f\u0648\u0627\u0621') : tr(lang, 'What medication is this?', '\u0645\u0627 \u0627\u0633\u0645 \u0647\u0630\u0627 \u0627\u0644\u062f\u0648\u0627\u0621\u061f'))}
                        {step === 2 && tr(lang, 'How should you take it?', '\u0643\u064a\u0641 \u064a\u062c\u0628 \u062a\u0646\u0627\u0648\u0644\u0647\u061f')}
                        {step === 3 && (simpleMode ? tr(lang, 'Slot & Save', '\u0627\u0644\u0641\u062a\u062d\u0629 \u0648\u0627\u0644\u062d\u0641\u0638') : tr(lang, 'Inventory & Tracking', '\u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0648\u0627\u0644\u0645\u062a\u0627\u0628\u0639\u0629'))}
                    </h3>
                    
                    <form id="medForm" onSubmit={handleSubmit}>
                        {step === 1 && renderStep1()}
                        {step === 2 && renderStep2()}
                        {step === 3 && renderStep3()}
                    </form>
                </div>

                {/* Footer Navigation */}
                <div className="p-4 border-t border-gray-100 flex justify-between bg-white rounded-b-3xl">
                    {step > 1 ? (
                        <button onClick={() => setStep(step - 1)} className="px-6 py-3 font-bold text-gray-500 hover:bg-gray-50 rounded-xl transition-colors">
                            {tr(lang, 'Back', '\u0631\u062c\u0648\u0639')}
                        </button>
                    ) : (
                        <div></div>
                    )}
                    
                    {step < 3 ? (
                        <button 
                            onClick={() => {
                                if (step === 1 && !formData.name) return; // Validation
                                if (step === 2 && formData.frequencyType === 'Daily' && (!formData.scheduledTimes || formData.scheduledTimes.length === 0)) return;
                                setStep(step + 1)
                            }}
                            className={`px-8 py-3 rounded-xl text-white font-bold shadow-lg transition-all ${getColorClass(formData.color)} hover:opacity-90 active:scale-95`}
                        >
                            {tr(lang, 'Next', '\u0627\u0644\u062a\u0627\u0644\u064a')}
                        </button>
                    ) : (
                        <button 
                            onClick={handleSubmit}
                            className={`px-8 py-3 rounded-xl text-white font-bold shadow-lg transition-all ${getColorClass(formData.color)} hover:opacity-90 active:scale-95`}
                        >
                            {editingId ? tr(lang, 'Update', '\u062a\u062d\u062f\u064a\u062b') : tr(lang, 'Save', '\u062d\u0641\u0638')}
                        </button>
                    )}
                </div>
            </div>
        </div>
      )}
    </div>
  );
};



