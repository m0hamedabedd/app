
import React, { useState } from 'react';
import { Medication } from '../types';

interface MedicationCardProps {
  medication: Medication;
  onTake?: (id: string) => void;
  onSnooze?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onEdit?: (med: Medication) => void;
  onDelete?: (id: string) => void;
  isDue?: boolean;
}

export const MedicationCard: React.FC<MedicationCardProps> = ({ 
  medication, 
  onTake, 
  onSnooze, 
  onDismiss, 
  onEdit, 
  onDelete, 
  isDue 
}) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  const color = medication.color || 'teal';
  // Dynamic tailwind classes need full strings to be safe, but assuming safelist or JIT:
  const bgClass = `bg-${color}-50`;
  const textClass = `text-${color}-600`;
  const borderClass = `border-${color}-100`;
  const ringClass = `ring-${color}-400`;

  const expiryDateObj = medication.expiryDate ? new Date(medication.expiryDate) : null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  let isExpired = false;
  let isExpiringSoon = false;

  if (expiryDateObj) {
      const exp = new Date(medication.expiryDate!);
      const diffTime = exp.getTime() - today.getTime();
      const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      isExpired = daysLeft < 0;
      isExpiringSoon = !isExpired && daysLeft <= 30;
  }

  const handleTakeClick = () => {
    setIsConfirming(true);
  };

  const confirmTake = () => {
    if (onTake) onTake(medication.id);
    setIsConfirming(false);
  };

  const cancelTake = () => {
    setIsConfirming(false);
  };

  // Render "Inventory/Management" Mode if onEdit is present
  const isManagementMode = !!onEdit;

  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 relative overflow-hidden transition-all duration-300 ${isDue ? `ring-2 ${ringClass} shadow-md` : 'hover:shadow-md'}`}>
      
      {/* Delete Confirmation Overlay */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 bg-white/95 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-4 animate-fade-in">
          <p className="text-gray-800 font-bold mb-3 text-center">Delete {medication.name}?</p>
          <div className="flex gap-3 w-full">
            <button 
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 py-2 bg-gray-100 rounded-xl font-bold text-gray-600"
            >
              Cancel
            </button>
            <button 
              onClick={() => onDelete && onDelete(medication.id)}
              className="flex-1 py-2 bg-red-500 rounded-xl font-bold text-white shadow-lg shadow-red-200"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Status Badges */}
      <div className="absolute top-0 right-0 flex flex-col items-end z-10 pointer-events-none">
        {isExpired && (
            <div className="bg-red-500 text-white text-[10px] px-2 py-1 rounded-bl-lg font-bold shadow-sm mb-[1px]">
            EXPIRED
            </div>
        )}
        {isExpiringSoon && (
            <div className="bg-orange-400 text-white text-[10px] px-2 py-1 rounded-bl-lg font-bold shadow-sm mb-[1px]">
            EXP SOON
            </div>
        )}
        {isDue && (
            <div className={`bg-${color}-500 text-white text-[10px] px-2 py-1 rounded-bl-lg font-bold shadow-sm`}>
            DUE NOW
            </div>
        )}
      </div>

      <div className="p-4">
        <div className="flex justify-between items-start">
            <div className="flex items-start space-x-3 w-full">
            {/* Icon */}
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl relative shadow-sm flex-shrink-0 ${bgClass} ${textClass}`}>
                <i className={`fas ${medication.form === 'Injection' ? 'fa-syringe' : medication.form === 'Liquid' ? 'fa-prescription-bottle' : 'fa-tablets'}`}></i>
                {medication.slot && (
                    <div className="absolute -bottom-1 -right-1 bg-indigo-600 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full border-2 border-white font-bold shadow-sm" title={`Dispenser Slot ${medication.slot}`}>
                        {medication.slot}
                    </div>
                )}
            </div>
            
            {/* Text Content */}
            <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-800 text-lg leading-tight truncate pr-6">{medication.name}</h3>
                <p className="text-gray-500 text-xs font-medium mt-0.5">{medication.dosage} • {medication.form}</p>
                
                {/* Management Info (Inventory Count) */}
                {isManagementMode && (
                  <div className="flex items-center gap-2 mt-2">
                     <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${medication.inventoryCount < 10 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-gray-50 text-gray-500 border-gray-100'}`}>
                        {medication.inventoryCount} left
                     </span>
                     {medication.refillsRemaining > 0 && (
                       <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-100">
                         {medication.refillsRemaining} refills
                       </span>
                     )}
                  </div>
                )}
            </div>
            </div>
        </div>

        {/* Schedule Tags */}
        {!isManagementMode && (
             <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-1 bg-gray-50 rounded-md text-gray-500 font-bold border border-gray-100">
                {medication.frequency}
                </span>
                {medication.scheduledTimes && medication.scheduledTimes.length > 0 && (
                    <div className="flex gap-1">
                        {medication.scheduledTimes.map((time, idx) => (
                            <span key={idx} className={`px-1.5 py-1 ${bgClass} ${textClass} rounded-md font-bold border ${borderClass} opacity-80`}>
                                {time}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        )}

        {/* Due/Task Actions */}
        {isDue && (
            <div className="mt-4 pt-3 border-t border-gray-50">
                {isConfirming ? (
                    <div className="flex gap-2 animate-fade-in">
                        <button onClick={confirmTake} className="flex-1 bg-green-500 text-white font-bold py-2 rounded-lg shadow-sm flex items-center justify-center space-x-1">
                            <i className="fas fa-check"></i> <span>Confirm</span>
                        </button>
                        <button onClick={cancelTake} className="flex-1 bg-gray-100 text-gray-600 font-bold py-2 rounded-lg">Cancel</button>
                    </div>
                ) : (
                    <div className="flex gap-2">
                        {onTake && (
                            <button onClick={handleTakeClick} className={`flex-1 font-bold py-2 rounded-lg shadow-sm transition-all flex items-center justify-center space-x-2 active:scale-95 text-white ${medication.slot ? 'bg-indigo-600' : `bg-${color}-500`}`}>
                                <i className={medication.slot ? "fas fa-arrow-down" : "fas fa-check"}></i>
                                <span>{medication.slot ? `Dispense` : 'Take'}</span>
                            </button>
                        )}
                        {onSnooze && (
                            <button onClick={() => onSnooze(medication.id)} className="px-3 bg-orange-50 text-orange-600 font-bold rounded-lg border border-orange-100">
                                <i className="fas fa-clock"></i>
                            </button>
                        )}
                    </div>
                )}
            </div>
        )}

        {/* Management Actions (Cabinet View) */}
        {isManagementMode && (
            <div className="mt-4 flex gap-2 pt-3 border-t border-gray-50">
                <button 
                    onClick={() => onEdit && onEdit(medication)}
                    className="flex-1 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold py-2 rounded-lg text-xs transition-colors border border-gray-100 flex items-center justify-center gap-2"
                >
                    <i className="fas fa-pencil-alt text-gray-400"></i> Edit
                </button>
                {onDelete && (
                     <button 
                        onClick={() => setShowDeleteConfirm(true)}
                        className="w-10 bg-white hover:bg-red-50 text-gray-300 hover:text-red-500 border border-gray-100 hover:border-red-100 font-bold py-2 rounded-lg transition-colors flex items-center justify-center"
                     >
                        <i className="fas fa-trash-alt"></i>
                    </button>
                )}
            </div>
        )}
      </div>
    </div>
  );
};
