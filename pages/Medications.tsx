
import React, { useState, useRef, useEffect } from 'react';
import { Medication, DosageForm, FrequencyType } from '../types';
import { MedicationCard } from '../components/MedicationCard';
import { scanMedicationBottle } from '../services/geminiService';

interface MedicationsProps {
  medications: Medication[];
  onAdd: (med: Medication) => void;
  onUpdate: (med: Medication) => void;
  onDelete: (id: string) => void;
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

export const Medications: React.FC<MedicationsProps> = ({ medications, onAdd, onUpdate, onDelete }) => {
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState(1);
  const [isScanning, setIsScanning] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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
    instructions: '',
    refillsRemaining: 0,
    inventoryCount: 30,
    expiryDate: '',
    slot: undefined
  };

  const [formData, setFormData] = useState<Partial<Medication>>(defaultFormState);
  
  const updateFrequencyLabel = (type: FrequencyType, times: string[], interval?: number) => {
      if (type === 'As Needed') return 'As Needed';
      if (type === 'Interval') return `Every ${interval || 4} Hours`;
      if (type === 'Daily') {
          return `${times.length}x Daily`;
      }
      return 'Custom';
  };

  const handleOpenAdd = () => {
      setEditingId(null);
      setFormData(defaultFormState);
      setStep(1);
      setShowModal(true);
  };

  const handleOpenEdit = (med: Medication) => {
      setEditingId(med.id);
      setFormData({ ...med });
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
        formData.intervalHours
    );

    const finalData = {
        ...formData,
        frequency: finalLabel
    };

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

  const renderStep1 = () => (
      <div className="space-y-6 animate-fade-in">
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
                            <span className="font-bold">Analyzing Bottle...</span>
                        </>
                    ) : (
                        <>
                            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                                <i className="fas fa-magic text-yellow-300"></i>
                            </div>
                            <span className="font-bold">Auto-Fill with AI Scan</span>
                            <span className="text-xs text-indigo-100 opacity-80 mt-1">Take a photo of the bottle label</span>
                        </>
                    )}
                </button>
            </div>
          )}

          <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">Medication Name</label>
                <input 
                    required
                    type="text" 
                    className="w-full text-2xl font-bold px-4 py-3 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-teal-500 focus:bg-white focus:ring-0 outline-none transition-all placeholder-gray-300"
                    placeholder="e.g. Lisinopril"
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                />
          </div>

          <div className="space-y-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">Appearance</label>
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
                            <span className="text-[10px] font-bold">{f}</span>
                        </button>
                    ))}
                </div>
          </div>

          <div className="space-y-2">
               <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">Color Code</label>
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
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">Dosage</label>
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
                                {formData.form === DosageForm.PILL ? 'Pills' : 'Units'}
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
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">Frequency</label>
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
                            {type}
                        </button>
                    ))}
                </div>
            </div>

            {formData.frequencyType === 'Daily' && (
                <div className="space-y-3">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">Quick Times</label>
                    <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                        {[
                            { label: 'Morning', time: '08:00', icon: 'fa-sun' },
                            { label: 'Noon', time: '12:00', icon: 'fa-cloud-sun' },
                            { label: 'Evening', time: '18:00', icon: 'fa-moon' },
                            { label: 'Bed', time: '22:00', icon: 'fa-bed' },
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
                    
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">Exact Times</label>
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
                </div>
            )}
            
            {formData.frequencyType === 'Interval' && (
                 <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Repeat every</span>
                    <div className="flex items-center space-x-2">
                        <input
                            type="number"
                            className="w-16 text-center font-bold text-lg border-b-2 border-gray-200 focus:border-teal-500 outline-none p-1"
                            value={formData.intervalHours || 4}
                            onChange={e => setFormData({...formData, intervalHours: parseInt(e.target.value)})}
                        />
                        <span className="text-sm text-gray-500 font-medium">Hours</span>
                    </div>
                </div>
            )}
      </div>
  );

  const renderStep3 = () => (
      <div className="space-y-6 animate-fade-in">
           <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded-2xl">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">Stock</label>
                    <input 
                        type="number" 
                        className="w-full mt-1 bg-transparent text-3xl font-bold text-gray-800 outline-none"
                        placeholder="30"
                        value={formData.inventoryCount}
                        onChange={e => setFormData({...formData, inventoryCount: parseInt(e.target.value)})}
                    />
                    <p className="text-xs text-gray-400 mt-1">Pills remaining</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-2xl">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wide">Refills</label>
                    <input 
                        type="number" 
                        className="w-full mt-1 bg-transparent text-3xl font-bold text-gray-800 outline-none"
                        placeholder="0"
                        value={formData.refillsRemaining}
                        onChange={e => setFormData({...formData, refillsRemaining: parseInt(e.target.value)})}
                    />
                    <p className="text-xs text-gray-400 mt-1">Available</p>
                </div>
           </div>

            <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">Expiry Date</label>
                <input 
                    type="date" 
                    className="w-full mt-1 px-4 py-3 rounded-xl bg-gray-50 border border-transparent focus:bg-white focus:border-teal-500 outline-none transition-all text-gray-700 font-medium"
                    value={formData.expiryDate || ''}
                    onChange={e => setFormData({...formData, expiryDate: e.target.value})}
                />
            </div>

            <div>
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wide ml-1">Dispenser Slot</label>
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
                            None
                        </button>
                        {[1, 2, 3].map(slotNum => {
                            const occupied = medications.find(m => m.slot === slotNum && m.id !== editingId);
                            return (
                                <button
                                key={slotNum}
                                type="button"
                                onClick={() => setFormData({...formData, slot: slotNum})}
                                className={`relative py-4 rounded-xl text-xs font-bold border-2 transition-all flex flex-col items-center justify-center ${
                                    formData.slot === slotNum
                                    ? 'border-indigo-600 bg-indigo-600 text-white' 
                                    : 'border-gray-200 bg-white text-indigo-600 hover:border-indigo-100'
                                }`}
                                >
                                    <i className="fas fa-microchip mb-1 text-lg"></i>
                                    Slot {slotNum}
                                    {occupied && (
                                        <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" title="Occupied"></span>
                                    )}
                                </button>
                            );
                        })}
                </div>
            </div>
      </div>
  );

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex justify-between items-end sticky top-0 bg-gray-50/95 backdrop-blur-sm z-20 py-4 -mx-4 px-4 border-b border-gray-100/50">
        <div>
            <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Cabinet</h2>
            <p className="text-gray-500 text-sm font-medium">
                {medications.length} {medications.length === 1 ? 'Medication' : 'Medications'}
            </p>
        </div>
      </div>

      {/* Medication Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {medications.map(med => (
            <MedicationCard 
                key={med.id} 
                medication={med} 
                onEdit={handleOpenEdit} 
                onDelete={onDelete}
            />
        ))}
        {medications.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-gray-200 rounded-3xl bg-white/50">
                <div className="w-20 h-20 bg-teal-50 rounded-full flex items-center justify-center shadow-sm mb-6">
                    <i className="fas fa-prescription-bottle-alt text-teal-300 text-4xl"></i>
                </div>
                <p className="text-gray-600 font-bold text-lg">Your cabinet is empty</p>
                <p className="text-gray-400 text-sm mt-2 max-w-xs mx-auto">Tap the + button to add your first prescription or vitamin.</p>
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
                    <div className="flex space-x-2">
                        {[1, 2, 3].map(s => (
                            <div key={s} className={`h-1.5 rounded-full transition-all duration-500 ${step >= s ? `w-8 ${getColorClass(formData.color)}` : 'w-2 bg-gray-200'}`}></div>
                        ))}
                    </div>
                    <button onClick={() => setShowModal(false)} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center">
                        <i className="fas fa-times text-gray-500"></i>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 no-scrollbar">
                    <h3 className="text-2xl font-bold text-gray-900 mb-6">
                        {step === 1 && (editingId ? "Edit Medication" : "What medication is this?")}
                        {step === 2 && "How should you take it?"}
                        {step === 3 && "Inventory & Tracking"}
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
                            Back
                        </button>
                    ) : (
                        <div></div>
                    )}
                    
                    {step < 3 ? (
                        <button 
                            onClick={() => {
                                if (step === 1 && !formData.name) return; // Validation
                                setStep(step + 1)
                            }}
                            className={`px-8 py-3 rounded-xl text-white font-bold shadow-lg transition-all ${getColorClass(formData.color)} hover:opacity-90 active:scale-95`}
                        >
                            Next
                        </button>
                    ) : (
                        <button 
                            onClick={handleSubmit}
                            className={`px-8 py-3 rounded-xl text-white font-bold shadow-lg transition-all ${getColorClass(formData.color)} hover:opacity-90 active:scale-95`}
                        >
                            {editingId ? 'Update' : 'Save'}
                        </button>
                    )}
                </div>
            </div>
        </div>
      )}
    </div>
  );
};
