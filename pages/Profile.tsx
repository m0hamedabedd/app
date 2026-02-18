import React, { useState, useEffect, useRef } from 'react';
import { UserProfile, Medication, LogEntry } from '../types';
import { isWebPushSupported, registerPushToken } from '../services/firebase';
import { resolveLanguage, tr } from '../services/i18n';

interface ProfileProps {
  user: UserProfile;
  medications: Medication[];
  logs: LogEntry[];
  onLogout: () => void;
  onUpdate: (profile: UserProfile) => void;
}

export const Profile: React.FC<ProfileProps> = ({ user, medications, logs, onLogout, onUpdate }) => {
  const MAX_PROFILE_IMAGE_SOURCE_MB = 8;
  const MAX_PROFILE_IMAGE_SOURCE_BYTES = MAX_PROFILE_IMAGE_SOURCE_MB * 1024 * 1024;
  const PROFILE_IMAGE_MAX_DIMENSION = 1024;
  const PROFILE_IMAGE_TARGET_BYTES = 1024 * 1024;

  const [activeTab, setActiveTab] = useState<'health' | 'settings'>('health');
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<UserProfile>(user);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tempCondition, setTempCondition] = useState('');
  const [tempAllergy, setTempAllergy] = useState('');
  const language = resolveLanguage(user.language || 'en');
  const isArabic = language === 'ar';

  useEffect(() => {
    if (!isEditing) setFormData(user);
  }, [user, isEditing]);

  const handleSave = () => {
    onUpdate(formData);
    setIsEditing(false);
  };

  const addItem = (field: 'conditions' | 'allergies', value: string) => {
    if (!value.trim()) return;
    setFormData(prev => ({
      ...prev,
      [field]: [...(prev[field] || []), value.trim()]
    }));
    if (field === 'conditions') setTempCondition('');
    else setTempAllergy('');
  };

  const removeItem = (field: 'conditions' | 'allergies', idx: number) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== idx)
    }));
  };

  const updateSettings = (changes: Partial<UserProfile>) => {
    onUpdate({ ...user, ...changes });
  };

  const handleExport = () => {
    const data = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ user, medications, logs }, null, 2));
    const a = document.createElement('a');
    a.href = data;
    const exportPrefix = tr(language, 'PillGuard_Export', 'PillGuard_\u062a\u0635\u062f\u064a\u0631');
    a.download = `${exportPrefix}_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  const handleToggleNotifications = async () => {
    const isIos = /iPad|iPhone|iPod/.test(window.navigator.userAgent || '') || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
    const isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;

    if (user.notificationsEnabled) {
      onUpdate({ ...user, notificationsEnabled: false });
    } else {
      const supported = await isWebPushSupported();
      if (!supported) {
        if (isIos && !isStandalone) {
          alert(tr(language, "On iPhone, install the app to Home Screen first, open it from the Home Screen, then allow notifications.", "\u0639\u0644\u0649 iPhone: \u062b\u0628\u0651\u062a \u0627\u0644\u062a\u0637\u0628\u064a\u0642 \u0623\u0648\u0644\u0627\u064b \u0639\u0644\u0649 \u0627\u0644\u0634\u0627\u0634\u0629 \u0627\u0644\u0631\u0626\u064a\u0633\u064a\u0629\u060c \u062b\u0645 \u0627\u0641\u062a\u062d\u0647 \u0645\u0646 \u0627\u0644\u0634\u0627\u0634\u0629 \u0648\u0627\u0633\u0645\u062d \u0628\u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a."));
        } else {
          alert(tr(language, "Push notifications are not supported on this browser/device.", "\u0625\u0634\u0639\u0627\u0631\u0627\u062a \u0627\u0644\u062f\u0641\u0639 \u063a\u064a\u0631 \u0645\u062f\u0639\u0648\u0645\u0629 \u0641\u064a \u0647\u0630\u0627 \u0627\u0644\u0645\u062a\u0635\u0641\u062d/\u0627\u0644\u062c\u0647\u0627\u0632."));
        }
        return;
      }

      if (typeof Notification === 'undefined') {
        alert(tr(language, "Notifications are not available in this browser.", "\u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a \u063a\u064a\u0631 \u0645\u062a\u0627\u062d\u0629 \u0641\u064a \u0647\u0630\u0627 \u0627\u0644\u0645\u062a\u0635\u0641\u062d."));
        return;
      }

      if (Notification.permission === 'granted') {
        onUpdate({ ...user, notificationsEnabled: true });
        await registerPushToken();
      } else if (Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          onUpdate({ ...user, notificationsEnabled: true });
          await registerPushToken();
        } else {
          alert(tr(language, "You need to allow notifications in your browser to receive alerts.", "\u064a\u062c\u0628 \u0627\u0644\u0633\u0645\u0627\u062d \u0628\u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a \u0641\u064a \u0627\u0644\u0645\u062a\u0635\u0641\u062d \u0644\u062a\u0644\u0642\u064a \u0627\u0644\u062a\u0646\u0628\u064a\u0647\u0627\u062a."));
        }
      } else {
        alert(tr(language, "Notifications are currently blocked. Please enable them in your browser settings.", "\u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a \u0645\u062d\u0638\u0648\u0631\u0629 \u062d\u0627\u0644\u064a\u064b\u0627. \u0641\u0639\u0651\u0644\u0647\u0627 \u0645\u0646 \u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u0645\u062a\u0635\u0641\u062d."));
      }
    }
  };

  const handleTestNotification = () => {
    if (typeof Notification === 'undefined') {
      alert(tr(language, "Notifications are not available in this browser.", "\u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a \u063a\u064a\u0631 \u0645\u062a\u0627\u062d\u0629 \u0641\u064a \u0647\u0630\u0627 \u0627\u0644\u0645\u062a\u0635\u0641\u062d."));
      return;
    }
    if (Notification.permission === 'granted' && user.notificationsEnabled) {
      new Notification(tr(language, "Test Notification", "\u0625\u0634\u0639\u0627\u0631 \u062a\u062c\u0631\u064a\u0628\u064a"), {
        body: tr(language, "This is how your medication alerts will appear.", "\u0647\u0630\u0627 \u0634\u0643\u0644 \u062a\u0646\u0628\u064a\u0647\u0627\u062a \u0627\u0644\u062f\u0648\u0627\u0621 \u0644\u062f\u064a\u0643."),
        icon: "https://cdn-icons-png.flaticon.com/512/883/883360.png"
      });
    } else {
      alert(tr(language, "Please enable notifications above first.", "\u064a\u0631\u062c\u0649 \u062a\u0641\u0639\u064a\u0644 \u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a \u0623\u0648\u0644\u0627\u064b."));
    }
  };

  const estimateDataUrlBytes = (dataUrl: string) => {
    const base64 = dataUrl.split(',')[1] || '';
    return Math.ceil((base64.length * 3) / 4);
  };

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string) || '');
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });

  const compressProfileImage = async (file: File): Promise<string> => {
    const dataUrl = await readFileAsDataUrl(file);
    const image = await loadImage(dataUrl);

    const scale = Math.min(1, PROFILE_IMAGE_MAX_DIMENSION / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;

    ctx.drawImage(image, 0, 0, width, height);

    const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    let quality = 0.9;
    let out = canvas.toDataURL(mimeType, quality);

    while (estimateDataUrlBytes(out) > PROFILE_IMAGE_TARGET_BYTES && quality > 0.45) {
      quality -= 0.1;
      out = canvas.toDataURL('image/jpeg', quality);
    }

    return out;
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert(tr(language, "Please select a valid image file.", "\u064a\u0631\u062c\u0649 \u0627\u062e\u062a\u064a\u0627\u0631 \u0635\u0648\u0631\u0629 \u0635\u062d\u064a\u062d\u0629."));
      return;
    }
    if (file.size > MAX_PROFILE_IMAGE_SOURCE_BYTES) {
      alert(tr(language, `Image is too large. Please select an image under ${MAX_PROFILE_IMAGE_SOURCE_MB}MB.`, `\u0627\u0644\u0635\u0648\u0631\u0629 \u0643\u0628\u064a\u0631\u0629 \u062c\u062f\u064b\u0627. \u0627\u062e\u062a\u0631 \u0635\u0648\u0631\u0629 \u0628\u062d\u062c\u0645 \u0623\u0642\u0644 \u0645\u0646 ${MAX_PROFILE_IMAGE_SOURCE_MB} \u0645\u064a\u062c\u0627\u0628\u0627\u064a\u062a.`));
      return;
    }

    try {
      const compressed = await compressProfileImage(file);
      setFormData(prev => ({ ...prev, photoURL: compressed }));
    } catch (error) {
      console.error("Failed to process profile image", error);
      alert(tr(language, "Could not process this image. Please try a different one.", "\u062a\u0639\u0630\u0631\u062a \u0645\u0639\u0627\u0644\u062c\u0629 \u0647\u0630\u0647 \u0627\u0644\u0635\u0648\u0631\u0629. \u062c\u0631\u0628 \u0635\u0648\u0631\u0629 \u0623\u062e\u0631\u0649."));
    } finally {
      // Allow selecting the same file again
      e.target.value = '';
    }
  };

  const handleSnoozeDurationChange = (minutes: number) => updateSettings({ snoozeDurationMinutes: minutes });
  const handleNotificationSoundChange = (sound: UserProfile['notificationSound']) => updateSettings({ notificationSound: sound });
  const handleAppearanceChange = (appearance: UserProfile['appearance']) => updateSettings({ appearance });
  const handleLanguageChange = (language: UserProfile['language']) => updateSettings({ language });

  const handleResetSettings = () => {
    const confirmed = window.confirm(tr(language, "Reset app settings to default values?", "\u0647\u0644 \u062a\u0631\u064a\u062f \u0625\u0639\u0627\u062f\u0629 \u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u062a\u0637\u0628\u064a\u0642 \u0625\u0644\u0649 \u0627\u0644\u0642\u064a\u0645 \u0627\u0644\u0627\u0641\u062a\u0631\u0627\u0636\u064a\u0629\u061f"));
    if (!confirmed) return;
    updateSettings({
      snoozeDurationMinutes: 15,
      notificationSound: 'Chime',
      appearance: 'Light',
      language: 'en'
    });
  };

  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

  const browserPermission = typeof Notification !== 'undefined' ? Notification.permission : 'default';
  const isNotifEnabled = user.notificationsEnabled && browserPermission === 'granted';
  const snoozeMinutes = user.snoozeDurationMinutes || 15;
  const notificationSound = user.notificationSound || 'Chime';
  const appearance = user.appearance || 'Light';

  return (
    <div className="pb-24 animate-fade-in">
      <div className="bg-white px-6 pt-8 pb-6 rounded-b-3xl shadow-sm border-b border-gray-100 mb-6 relative">
        <div className="flex flex-col items-center">
          <div className="relative group mb-4">
            <div className="w-24 h-24 rounded-full shadow-inner border-4 border-white overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
              {formData.photoURL ? (
                <img src={formData.photoURL} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <span className="text-gray-500 text-3xl font-bold">{getInitials(user.name)}</span>
              )}
            </div>

            {isEditing && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 right-0 w-8 h-8 bg-teal-500 text-white rounded-full flex items-center justify-center shadow-md hover:bg-teal-600 transition-colors border-2 border-white"
              >
                <i className="fas fa-camera text-xs"></i>
              </button>
            )}
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
          </div>

          {isEditing ? (
            <div className="flex flex-col items-center gap-2 w-full max-w-xs">
              <input
                className="text-center text-xl font-bold text-gray-900 border-b border-gray-300 focus:border-teal-500 outline-none pb-1 bg-transparent w-full"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder={tr(language, 'Your Name', 'الاسم')}
              />
              <div className="flex items-center gap-2">
                <input
                  className="text-center text-sm font-medium text-gray-500 border-b border-gray-300 focus:border-teal-500 outline-none pb-1 bg-transparent w-16"
                  type="number"
                  value={formData.age}
                  onChange={e => setFormData({ ...formData, age: parseInt(e.target.value) || 0 })}
                />
                <span className="text-sm text-gray-400">{tr(language, 'years old', 'سنة')}</span>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-gray-900">{user.name}</h1>
              <p className="text-sm text-gray-500 font-medium">{tr(language, `${user.age} years old`, `${user.age} سنة`)}</p>
            </>
          )}
        </div>

        <button
          onClick={() => isEditing ? handleSave() : setIsEditing(true)}
          className={`absolute top-6 right-6 text-sm font-bold px-4 py-2 rounded-full transition-all ${isEditing ? 'bg-teal-600 text-white shadow-lg shadow-teal-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          {isEditing ? tr(language, 'Done', 'تم') : tr(language, 'Edit', 'تعديل')}
        </button>
      </div>

      <div className="px-6 mb-6">
        <div className="bg-gray-100 p-1 rounded-xl flex">
          <button
            onClick={() => setActiveTab('health')}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'health' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {tr(language, 'Health ID', 'الملف الصحي')}
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'settings' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {tr(language, 'Settings', 'الإعدادات')}
          </button>
        </div>
      </div>

      <div className="px-4 space-y-6">
        {activeTab === 'health' && (
          <div className="space-y-6 animate-slide-up">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center">
                  <i className="fas fa-pills"></i>
                </div>
                <div>
                  <p className="text-xl font-bold text-gray-900">{medications.length}</p>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">{tr(language, 'Active Meds', 'أدوية نشطة')}</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-purple-50 text-purple-500 flex items-center justify-center">
                  <i className="fas fa-history"></i>
                </div>
                <div>
                  <p className="text-xl font-bold text-gray-900">{logs.length}</p>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">{tr(language, 'Total Logs', 'إجمالي السجلات')}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="bg-red-50 px-4 py-3 border-b border-red-100 flex items-center justify-between">
                <span className="text-xs font-bold text-red-600 uppercase tracking-wide">{tr(language, 'Emergency Contact', 'جهة اتصال الطوارئ')}</span>
                <i className="fas fa-heartbeat text-red-400"></i>
              </div>
              <div className="p-4">
                {isEditing ? (
                  <input
                    className="w-full bg-gray-50 rounded-lg px-3 py-2 text-gray-800 font-medium outline-none border border-transparent focus:border-red-200"
                    value={formData.emergencyContact}
                    onChange={e => setFormData({ ...formData, emergencyContact: e.target.value })}
                    placeholder={tr(language, 'Phone Number', 'رقم الهاتف')}
                  />
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-semibold text-gray-800">{user.emergencyContact || tr(language, 'Not Set', 'غير محدد')}</span>
                    {user.emergencyContact && (
                      <a href={`tel:${user.emergencyContact}`} className="w-8 h-8 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
                        <i className="fas fa-phone text-sm"></i>
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden p-5 space-y-6">
              <div>
                <h3 className="text-sm font-bold text-gray-900 mb-3">{tr(language, 'Medical Conditions', 'الحالات المرضية')}</h3>
                <div className="flex flex-wrap gap-2">
                  {(isEditing ? formData.conditions : user.conditions).map((c, i) => (
                    <span key={i} className="px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg text-sm font-medium border border-gray-200 flex items-center">
                      {c}
                      {isEditing && (
                        <button onClick={() => removeItem('conditions', i)} className="ml-2 text-gray-400 hover:text-red-500">
                          <i className="fas fa-times"></i>
                        </button>
                      )}
                    </span>
                  ))}
                  {isEditing && (
                    <div className="flex items-center gap-2">
                      <input
                        className="bg-gray-50 rounded-lg px-3 py-1.5 text-sm outline-none border-b border-transparent focus:border-teal-500 w-32"
                        placeholder={tr(language, 'Add...', '\u0625\u0636\u0627\u0641\u0629...')}
                        value={tempCondition}
                        onChange={e => setTempCondition(e.target.value)}
                        onKeyPress={e => e.key === 'Enter' && addItem('conditions', tempCondition)}
                      />
                      <button onClick={() => addItem('conditions', tempCondition)} className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center text-gray-500">
                        <i className="fas fa-plus text-xs"></i>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="h-px bg-gray-100 w-full"></div>

              <div>
                <h3 className="text-sm font-bold text-gray-900 mb-3">{tr(language, 'Allergies', 'الحساسية')}</h3>
                <div className="flex flex-wrap gap-2">
                  {(isEditing ? formData.allergies : user.allergies).map((a, i) => (
                    <span key={i} className="px-3 py-1.5 bg-orange-50 text-orange-700 rounded-lg text-sm font-medium border border-orange-100 flex items-center">
                      {a}
                      {isEditing && (
                        <button onClick={() => removeItem('allergies', i)} className="ml-2 text-orange-400 hover:text-red-500">
                          <i className="fas fa-times"></i>
                        </button>
                      )}
                    </span>
                  ))}
                  {isEditing && (
                    <div className="flex items-center gap-2">
                      <input
                        className="bg-gray-50 rounded-lg px-3 py-1.5 text-sm outline-none border-b border-transparent focus:border-orange-500 w-32"
                        placeholder={tr(language, 'Add...', '\u0625\u0636\u0627\u0641\u0629...')}
                        value={tempAllergy}
                        onChange={e => setTempAllergy(e.target.value)}
                        onKeyPress={e => e.key === 'Enter' && addItem('allergies', tempAllergy)}
                      />
                      <button onClick={() => addItem('allergies', tempAllergy)} className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center text-gray-500">
                        <i className="fas fa-plus text-xs"></i>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-4 animate-slide-up">
            <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 text-white p-5 shadow-lg">
              <p className="text-[11px] uppercase tracking-[0.14em] text-slate-300 font-bold">{tr(language, 'Preferences', '\u0627\u0644\u062a\u0641\u0636\u064a\u0644\u0627\u062a')}</p>
              <h3 className="text-xl font-extrabold mt-1">{tr(language, 'App Settings', '\u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u062a\u0637\u0628\u064a\u0642')}</h3>
              <p className="text-sm text-slate-200 mt-1">{tr(language, 'Control reminders, sound, appearance and language.', '\u062a\u062d\u0643\u0645 \u0641\u064a \u0627\u0644\u062a\u0630\u0643\u064a\u0631\u0627\u062a \u0648\u0627\u0644\u0635\u0648\u062a \u0648\u0627\u0644\u0645\u0638\u0647\u0631 \u0648\u0627\u0644\u0644\u063a\u0629.')}</p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <button onClick={handleToggleNotifications} className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg ${isNotifEnabled ? 'bg-indigo-50 text-indigo-500' : 'bg-gray-100 text-gray-400'} flex items-center justify-center transition-colors`}>
                    <i className="fas fa-bell"></i>
                  </div>
                  <div className={isArabic ? 'text-right' : 'text-left'}>
                    <p className="text-sm font-bold text-gray-700">{tr(language, 'Notifications', '\u0627\u0644\u0625\u0634\u0639\u0627\u0631\u0627\u062a')}</p>
                    <p className="text-[11px] text-gray-400">{tr(language, 'Medication reminders and alerts', '\u062a\u0630\u0643\u064a\u0631\u0627\u062a \u0648\u062a\u0646\u0628\u064a\u0647\u0627\u062a \u0627\u0644\u0623\u062f\u0648\u064a\u0629')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${isNotifEnabled ? 'text-green-500' : 'text-gray-400'}`}>
                    {isNotifEnabled ? tr(language, 'On', '\u0645\u0641\u0639\u0644') : tr(language, 'Off', '\u0645\u062a\u0648\u0642\u0641')}
                  </span>
                  <div className={`w-10 h-6 rounded-full p-1 transition-colors ${isNotifEnabled ? 'bg-teal-500' : 'bg-gray-200'}`}>
                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isNotifEnabled ? 'translate-x-4' : 'translate-x-0'}`}></div>
                  </div>
                </div>
              </button>

              <div className="px-5 py-4 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-700 mb-2">{tr(language, 'Snooze Duration', '\u0645\u062f\u0629 \u0627\u0644\u062a\u0623\u062c\u064a\u0644')}</p>
                <div className="flex flex-wrap gap-2">
                  {[5, 10, 15, 20, 30, 45, 60].map((mins) => (
                    <button
                      key={mins}
                      onClick={() => handleSnoozeDurationChange(mins)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                        snoozeMinutes === mins
                          ? 'bg-teal-600 text-white border-teal-600'
                          : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {tr(language, `${mins} min`, `${mins} \u062f`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-5 py-4 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-700 mb-2">{tr(language, 'Notification Sound', '\u0635\u0648\u062a \u0627\u0644\u0625\u0634\u0639\u0627\u0631')}</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['Chime', 'Beep', 'Off'] as const).map((sound) => (
                    <button
                      key={sound}
                      onClick={() => handleNotificationSoundChange(sound)}
                      className={`h-10 rounded-lg text-xs font-bold border transition-colors ${
                        notificationSound === sound
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {tr(language, sound, sound === 'Chime' ? '\u0631\u0646\u064a\u0646' : sound === 'Beep' ? '\u0635\u0641\u064a\u0631' : '\u0625\u064a\u0642\u0627\u0641')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-5 py-4 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-700 mb-2">{tr(language, 'Appearance', '\u0627\u0644\u0645\u0638\u0647\u0631')}</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['Light', 'Dark', 'System'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => handleAppearanceChange(mode)}
                      className={`h-10 rounded-lg text-xs font-bold border transition-colors ${
                        appearance === mode
                          ? 'bg-slate-800 text-white border-slate-800'
                          : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {tr(language, mode, mode === 'Light' ? '\u0641\u0627\u062a\u062d' : mode === 'Dark' ? '\u062f\u0627\u0643\u0646' : '\u0627\u0644\u0646\u0638\u0627\u0645')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-5 py-4 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-700 mb-2">{tr(language, 'Language', '\u0627\u0644\u0644\u063a\u0629')}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleLanguageChange('en')}
                    className={`h-10 rounded-lg text-xs font-bold border transition-colors ${
                      language === 'en'
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {tr(language, 'English', '\u0627\u0644\u0625\u0646\u062c\u0644\u064a\u0632\u064a\u0629')}
                  </button>
                  <button
                    onClick={() => handleLanguageChange('ar')}
                    className={`h-10 rounded-lg text-xs font-bold border transition-colors ${
                      language === 'ar'
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {tr(language, 'Arabic', '\u0627\u0644\u0639\u0631\u0628\u064a\u0629')}
                  </button>
                </div>
              </div>

              <div className="px-5 py-4 flex gap-2">
                <button
                  onClick={handleResetSettings}
                  className="flex-1 h-10 rounded-lg border border-red-200 bg-red-50 text-red-600 text-xs font-bold hover:bg-red-100 transition-colors"
                >
                  {tr(language, 'Reset Settings', '\u0625\u0639\u0627\u062f\u0629 \u0636\u0628\u0637 \u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a')}
                </button>
                <button
                  onClick={handleExport}
                  className="flex-1 h-10 rounded-lg border border-green-200 bg-green-50 text-green-600 text-xs font-bold hover:bg-green-100 transition-colors"
                >
                  {tr(language, 'Export Data', '\u062a\u0635\u062f\u064a\u0631 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a')}
                </button>
              </div>
            </div>

            {isNotifEnabled && (
              <button onClick={handleTestNotification} className="w-full bg-white rounded-2xl border border-gray-100 p-4 flex items-center justify-center gap-2 text-indigo-600 font-bold hover:bg-indigo-50 transition-colors shadow-sm">
                <i className="fas fa-vial"></i>
                {tr(language, 'Test Notification', '\u062a\u062c\u0631\u0628\u0629 \u0627\u0644\u0625\u0634\u0639\u0627\u0631')}
              </button>
            )}

            <button
              onClick={onLogout}
              className="w-full bg-white rounded-2xl border border-red-100 p-4 flex items-center justify-center text-red-500 font-bold hover:bg-red-50 transition-colors shadow-sm"
            >
              {tr(language, 'Log Out', '\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062e\u0631\u0648\u062c')}
            </button>

            <p className="text-center text-xs text-gray-400 pt-2">{tr(language, 'Version 1.4.0 - Build 2026', '\u0627\u0644\u0625\u0635\u062f\u0627\u0631 1.4.0 - \u0628\u0646\u0627\u0621 2026')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

