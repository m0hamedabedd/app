import React, { useState } from 'react';
import { Medication } from '../types';
import { resolveLanguage, tr } from '../services/i18n';

interface MedicationCardProps {
  medication: Medication;
  onTake?: (id: string) => void;
  onSnooze?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onEdit?: (med: Medication) => void;
  onDelete?: (id: string) => void;
  onToggleActive?: (med: Medication) => void;
  isDue?: boolean;
  language?: 'en' | 'ar';
}

export const MedicationCard: React.FC<MedicationCardProps> = ({
  medication,
  onTake,
  onSnooze,
  onDismiss,
  onEdit,
  onDelete,
  onToggleActive,
  isDue,
  language = 'en'
}) => {
  const lang = resolveLanguage(language);
  const [isConfirming, setIsConfirming] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const color = medication.color || 'teal';
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

  const isManagementMode = !!onEdit;
  const isActive = medication.isActive !== false;
  const localizedForm = medication.form === 'Pill'
    ? tr(lang, 'Pill', '\u062d\u0628\u0648\u0628')
    : medication.form === 'Liquid'
    ? tr(lang, 'Liquid', '\u0633\u0627\u0626\u0644')
    : medication.form === 'Injection'
    ? tr(lang, 'Injection', '\u062d\u0642\u0646')
    : medication.form === 'Cream'
    ? tr(lang, 'Cream', '\u0643\u0631\u064a\u0645')
    : medication.form === 'Inhaler'
    ? tr(lang, 'Inhaler', '\u0628\u062e\u0627\u062e')
    : tr(lang, 'Other', '\u0623\u062e\u0631\u0649');
  const localizedStomachCondition = medication.stomachCondition === 'Any'
    ? tr(lang, 'Any', '\u0623\u064a \u0648\u0642\u062a')
    : medication.stomachCondition === 'Before Meal'
    ? tr(lang, 'Before Meal', '\u0642\u0628\u0644 \u0627\u0644\u0637\u0639\u0627\u0645')
    : medication.stomachCondition === 'With Meal'
    ? tr(lang, 'With Meal', '\u0645\u0639 \u0627\u0644\u0637\u0639\u0627\u0645')
    : medication.stomachCondition === 'After Meal'
    ? tr(lang, 'After Meal', '\u0628\u0639\u062f \u0627\u0644\u0637\u0639\u0627\u0645')
    : medication.stomachCondition === 'Empty Stomach'
    ? tr(lang, 'Empty Stomach', '\u0639\u0644\u0649 \u0645\u0639\u062f\u0629 \u0641\u0627\u0631\u063a\u0629')
    : medication.stomachCondition;

  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 relative overflow-hidden transition-all duration-300 ${isDue ? `ring-2 ${ringClass} shadow-md` : 'hover:shadow-md'}`}>
      {showDeleteConfirm && (
        <div className="absolute inset-0 bg-white/95 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-4 animate-fade-in">
          <p className="text-gray-800 font-bold mb-3 text-center">{tr(lang, 'Delete', '\u062d\u0630\u0641')} {medication.name}?</p>
          <div className="flex gap-3 w-full">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 py-2 bg-gray-100 rounded-xl font-bold text-gray-600"
            >
              {tr(lang, 'Cancel', '\u0625\u0644\u063a\u0627\u0621')}
            </button>
            <button
              onClick={() => onDelete && onDelete(medication.id)}
              className="flex-1 py-2 bg-red-500 rounded-xl font-bold text-white shadow-lg shadow-red-200"
            >
              {tr(lang, 'Delete', '\u062d\u0630\u0641')}
            </button>
          </div>
        </div>
      )}

      <div className="absolute top-0 right-0 flex flex-col items-end z-10 pointer-events-none">
        {isExpired && (
          <div className="bg-red-500 text-white text-[10px] px-2 py-1 rounded-bl-lg font-bold shadow-sm mb-[1px]">
            {tr(lang, 'EXPIRED', '\u0645\u0646\u062a\u0647\u064a')}
          </div>
        )}
        {isExpiringSoon && (
          <div className="bg-orange-400 text-white text-[10px] px-2 py-1 rounded-bl-lg font-bold shadow-sm mb-[1px]">
            {tr(lang, 'EXP SOON', '\u064a\u0642\u062a\u0631\u0628 \u0627\u0644\u0627\u0646\u062a\u0647\u0627\u0621')}
          </div>
        )}
        {isDue && (
          <div className={`bg-${color}-500 text-white text-[10px] px-2 py-1 rounded-bl-lg font-bold shadow-sm`}>
            {tr(lang, 'DUE NOW', '\u062d\u0627\u0646 \u0627\u0644\u0622\u0646')}
          </div>
        )}
      </div>

      <div className="p-4">
        <div className="flex justify-between items-start">
          <div className="flex items-start space-x-3 w-full">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl relative shadow-sm flex-shrink-0 ${bgClass} ${textClass}`}>
              <i className={`fas ${medication.form === 'Injection' ? 'fa-syringe' : medication.form === 'Liquid' ? 'fa-prescription-bottle' : 'fa-tablets'}`}></i>
              {medication.slot && (
                <div className="absolute -bottom-1 -right-1 bg-indigo-600 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full border-2 border-white font-bold shadow-sm" title={`${tr(lang, 'Dispenser Slot', '\u0641\u062a\u062d\u0629 \u0627\u0644\u062c\u0647\u0627\u0632')} ${medication.slot}`}>
                  {medication.slot}
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-gray-800 text-lg leading-tight truncate pr-6">{medication.name}</h3>
              <p className="text-gray-500 text-xs font-medium mt-0.5">{medication.dosage} - {localizedForm}</p>
              {isDue && medication.scheduledTimes?.[0] && (
                <p className="text-[11px] font-semibold text-red-600 mt-1">{tr(lang, 'Due at', '\u0645\u0648\u0639\u062f\u0647')} {medication.scheduledTimes[0]}</p>
              )}

              {isManagementMode && (
                <div className="flex items-center gap-2 mt-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${isActive ? 'bg-green-50 text-green-600 border-green-100' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                    {isActive ? tr(lang, 'Active', '\u0646\u0634\u0637') : tr(lang, 'Inactive', '\u063a\u064a\u0631 \u0646\u0634\u0637')}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${medication.inventoryCount < 10 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-gray-50 text-gray-500 border-gray-100'}`}>
                    {medication.inventoryCount} {tr(lang, 'left', '\u0645\u062a\u0628\u0642\u064a')}
                  </span>
                  {medication.refillsRemaining > 0 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-100">
                      {medication.refillsRemaining} {tr(lang, 'refills', '\u0625\u0639\u0627\u062f\u0627\u062a \u0635\u0631\u0641')}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

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
            {medication.stomachCondition && medication.stomachCondition !== 'Any' && (
              <span className="px-2 py-1 bg-indigo-50 rounded-md text-indigo-600 font-bold border border-indigo-100">
                {localizedStomachCondition}
              </span>
            )}
          </div>
        )}

        {isDue && (
          <div className="mt-4 pt-3 border-t border-gray-50">
            {isConfirming ? (
              <div className="flex gap-2 animate-fade-in">
                <button onClick={() => { if (onTake) onTake(medication.id); setIsConfirming(false); }} className="flex-1 bg-green-500 text-white font-bold py-3 rounded-lg shadow-sm flex items-center justify-center space-x-1 min-h-11">
                  <i className="fas fa-check"></i> <span>{tr(lang, 'Confirm', '\u062a\u0623\u0643\u064a\u062f')}</span>
                </button>
                <button onClick={() => setIsConfirming(false)} className="flex-1 bg-gray-100 text-gray-600 font-bold py-3 rounded-lg min-h-11">{tr(lang, 'Cancel', '\u0625\u0644\u063a\u0627\u0621')}</button>
              </div>
            ) : (
              <div className="flex gap-2">
                {onTake && (
                  <button
                    onClick={() => setIsConfirming(true)}
                    aria-label={medication.slot ? `${tr(lang, 'Dispense', '\u0635\u0631\u0641')} ${medication.name}` : `${tr(lang, 'Mark', '\u062a\u062d\u062f\u064a\u062f')} ${medication.name} ${tr(lang, 'as taken', '\u0643\u062a\u0645 \u062a\u0646\u0627\u0648\u0644\u0647')}`}
                    className={`flex-1 font-bold py-3 rounded-lg shadow-sm transition-all flex items-center justify-center space-x-2 active:scale-95 text-white min-h-11 ${medication.slot ? 'bg-indigo-600' : `bg-${color}-500`}`}
                  >
                    <i className={medication.slot ? "fas fa-arrow-down" : "fas fa-check"}></i>
                    <span>{medication.slot ? tr(lang, 'Dispense', '\u0635\u0631\u0641') : tr(lang, 'Take', '\u062a\u0645 \u0627\u0644\u062a\u0646\u0627\u0648\u0644')}</span>
                  </button>
                )}
                {onSnooze && (
                  <button onClick={() => onSnooze(medication.id)} className="px-3 bg-orange-50 text-orange-700 font-bold rounded-lg border border-orange-200 min-h-11" aria-label={`${tr(lang, 'Snooze', '\u062a\u0623\u062c\u064a\u0644')} ${medication.name} ${tr(lang, 'for 15 minutes', '\u0644\u0645\u062f\u0629 15 \u062f\u0642\u064a\u0642\u0629')}`}>
                    <i className="fas fa-clock"></i>
                  </button>
                )}
                {onDismiss && (
                  <button onClick={() => onDismiss(medication.id)} className="px-3 bg-gray-50 text-gray-700 font-bold rounded-lg border border-gray-200 min-h-11" aria-label={`${tr(lang, 'Skip', '\u062a\u062e\u0637\u064a')} ${medication.name} ${tr(lang, 'for now', '\u062d\u0627\u0644\u064a\u064b\u0627')}`}>
                    <i className="fas fa-times"></i>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {isManagementMode && (
          <div className="mt-4 flex gap-2 pt-3 border-t border-gray-50">
            {onToggleActive && (
              <button
                onClick={() => onToggleActive(medication)}
                className={`flex-1 font-bold py-2 rounded-lg text-xs transition-colors border flex items-center justify-center gap-2 ${
                  isActive
                    ? 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-100'
                    : 'bg-green-50 hover:bg-green-100 text-green-700 border-green-100'
                }`}
              >
                <i className={`fas ${isActive ? 'fa-pause-circle' : 'fa-play-circle'}`}></i>
                {isActive ? tr(lang, 'Deactivate', '\u0625\u064a\u0642\u0627\u0641') : tr(lang, 'Activate', '\u062a\u0641\u0639\u064a\u0644')}
              </button>
            )}
            <button
              onClick={() => onEdit && onEdit(medication)}
              className="flex-1 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold py-2 rounded-lg text-xs transition-colors border border-gray-100 flex items-center justify-center gap-2"
            >
              <i className="fas fa-pencil-alt text-gray-400"></i> {tr(lang, 'Edit', '\u062a\u0639\u062f\u064a\u0644')}
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
