import React, { useState, useEffect, useRef } from 'react';
import { UserProfile, Medication, LogEntry } from '../types';

interface ProfileProps {
  user: UserProfile;
  medications: Medication[];
  logs: LogEntry[];
  onLogout: () => void;
  onUpdate: (profile: UserProfile) => void;
}

export const Profile: React.FC<ProfileProps> = ({ user, medications, logs, onLogout, onUpdate }) => {
  const [activeTab, setActiveTab] = useState<'health' | 'settings'>('health');
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<UserProfile>(user);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Inputs
  const [tempCondition, setTempCondition] = useState('');
  const [tempAllergy, setTempAllergy] = useState('');

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

  const handleExport = () => {
      const data = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ user, medications, logs }, null, 2));
      const a = document.createElement('a');
      a.href = data;
      a.download = `PillGuard_Export_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
  };

  const handleToggleNotifications = async () => {
    if (user.notificationsEnabled) {
        // User wants to disable
        onUpdate({ ...user, notificationsEnabled: false });
    } else {
        // User wants to enable
        if (Notification.permission === 'granted') {
            onUpdate({ ...user, notificationsEnabled: true });
            new Notification("Notifications Enabled", {
                body: "You will now receive alerts for your medication schedule.",
                icon: "https://cdn-icons-png.flaticon.com/512/883/883360.png"
            });
        } else if (Notification.permission !== 'denied') {
            const perm = await Notification.requestPermission();
            if (perm === 'granted') {
                onUpdate({ ...user, notificationsEnabled: true });
                new Notification("Notifications Enabled", {
                    body: "You will now receive alerts for your medication schedule.",
                    icon: "https://cdn-icons-png.flaticon.com/512/883/883360.png"
                });
            } else {
                // User denied
                alert("You need to allow notifications in your browser to receive alerts.");
            }
        } else {
            // Already denied
            alert("Notifications are currently blocked. Please enable them in your browser settings.");
        }
    }
  };

  const handleTestNotification = () => {
      if (Notification.permission === 'granted' && user.notificationsEnabled) {
          new Notification("Test Notification", {
              body: "This is how your medication alerts will appear.",
              icon: "https://cdn-icons-png.flaticon.com/512/883/883360.png"
          });
      } else {
          alert("Please enable notifications above first.");
      }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        // Simple size limit check (e.g. 1MB)
        if (file.size > 1024 * 1024) {
            alert("Image is too large. Please select an image under 1MB.");
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            setFormData(prev => ({ ...prev, photoURL: reader.result as string }));
        };
        reader.readAsDataURL(file);
    }
  };

  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase();

  const isNotifEnabled = user.notificationsEnabled && Notification.permission === 'granted';

  return (
    <div className="pb-24 animate-fade-in">
      
      {/* Minimal Header */}
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
                  <input 
                      type="file" 
                      ref={fileInputRef} 
                      className="hidden" 
                      accept="image/*" 
                      onChange={handleImageUpload}
                  />
              </div>
              
              {isEditing ? (
                  <div className="flex flex-col items-center gap-2 w-full max-w-xs">
                      <input 
                        className="text-center text-xl font-bold text-gray-900 border-b border-gray-300 focus:border-teal-500 outline-none pb-1 bg-transparent w-full"
                        value={formData.name}
                        onChange={e => setFormData({...formData, name: e.target.value})}
                        placeholder="Your Name"
                      />
                      <div className="flex items-center gap-2">
                        <input 
                            className="text-center text-sm font-medium text-gray-500 border-b border-gray-300 focus:border-teal-500 outline-none pb-1 bg-transparent w-16"
                            type="number"
                            value={formData.age}
                            onChange={e => setFormData({...formData, age: parseInt(e.target.value) || 0})}
                        />
                        <span className="text-sm text-gray-400">years old</span>
                      </div>
                  </div>
              ) : (
                  <>
                    <h1 className="text-2xl font-bold text-gray-900">{user.name}</h1>
                    <p className="text-sm text-gray-500 font-medium">{user.age} years old</p>
                  </>
              )}
          </div>

          {/* Edit Button Absolute */}
          <button 
            onClick={() => isEditing ? handleSave() : setIsEditing(true)}
            className={`absolute top-6 right-6 text-sm font-bold px-4 py-2 rounded-full transition-all ${isEditing ? 'bg-teal-600 text-white shadow-lg shadow-teal-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {isEditing ? 'Done' : 'Edit'}
          </button>
      </div>

      {/* Tabs */}
      <div className="px-6 mb-6">
          <div className="bg-gray-100 p-1 rounded-xl flex">
              <button 
                onClick={() => setActiveTab('health')}
                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'health' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Health ID
              </button>
              <button 
                onClick={() => setActiveTab('settings')}
                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'settings' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Settings
              </button>
          </div>
      </div>

      <div className="px-4 space-y-6">
        
        {activeTab === 'health' && (
            <div className="space-y-6 animate-slide-up">
                {/* Stats Row */}
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center">
                            <i className="fas fa-pills"></i>
                        </div>
                        <div>
                            <p className="text-xl font-bold text-gray-900">{medications.length}</p>
                            <p className="text-[10px] text-gray-400 font-bold uppercase">Active Meds</p>
                        </div>
                    </div>
                    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-full bg-purple-50 text-purple-500 flex items-center justify-center">
                            <i className="fas fa-history"></i>
                        </div>
                        <div>
                            <p className="text-xl font-bold text-gray-900">{logs.length}</p>
                            <p className="text-[10px] text-gray-400 font-bold uppercase">Total Logs</p>
                        </div>
                    </div>
                </div>

                {/* Emergency Contact */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="bg-red-50 px-4 py-3 border-b border-red-100 flex items-center justify-between">
                        <span className="text-xs font-bold text-red-600 uppercase tracking-wide">Emergency Contact</span>
                        <i className="fas fa-heartbeat text-red-400"></i>
                    </div>
                    <div className="p-4">
                        {isEditing ? (
                            <input 
                                className="w-full bg-gray-50 rounded-lg px-3 py-2 text-gray-800 font-medium outline-none border border-transparent focus:border-red-200"
                                value={formData.emergencyContact}
                                onChange={e => setFormData({...formData, emergencyContact: e.target.value})}
                                placeholder="Phone Number"
                            />
                        ) : (
                            <div className="flex items-center justify-between">
                                <span className="text-lg font-semibold text-gray-800">{user.emergencyContact || 'Not Set'}</span>
                                {user.emergencyContact && (
                                    <a href={`tel:${user.emergencyContact}`} className="w-8 h-8 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
                                        <i className="fas fa-phone text-sm"></i>
                                    </a>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Conditions & Allergies */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden p-5 space-y-6">
                    {/* Conditions */}
                    <div>
                        <h3 className="text-sm font-bold text-gray-900 mb-3">Medical Conditions</h3>
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
                                        placeholder="Add..."
                                        value={tempCondition}
                                        onChange={e => setTempCondition(e.target.value)}
                                        onKeyPress={e => e.key === 'Enter' && addItem('conditions', tempCondition)}
                                    />
                                    <button onClick={() => addItem('conditions', tempCondition)} className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center text-gray-500">
                                        <i className="fas fa-plus text-xs"></i>
                                    </button>
                                </div>
                            )}
                            {(!isEditing && (!user.conditions || user.conditions.length === 0)) && (
                                <span className="text-gray-400 text-sm italic">None listed</span>
                            )}
                        </div>
                    </div>

                    <div className="h-px bg-gray-100 w-full"></div>

                    {/* Allergies */}
                    <div>
                        <h3 className="text-sm font-bold text-gray-900 mb-3">Allergies</h3>
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
                                        placeholder="Add..."
                                        value={tempAllergy}
                                        onChange={e => setTempAllergy(e.target.value)}
                                        onKeyPress={e => e.key === 'Enter' && addItem('allergies', tempAllergy)}
                                    />
                                    <button onClick={() => addItem('allergies', tempAllergy)} className="w-7 h-7 bg-gray-100 rounded-full flex items-center justify-center text-gray-500">
                                        <i className="fas fa-plus text-xs"></i>
                                    </button>
                                </div>
                            )}
                            {(!isEditing && (!user.allergies || user.allergies.length === 0)) && (
                                <span className="text-gray-400 text-sm italic">None listed</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        )}

        {activeTab === 'settings' && (
            <div className="space-y-4 animate-slide-up">
                {/* General Settings Group */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <button onClick={handleToggleNotifications} className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-100">
                        <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-lg ${isNotifEnabled ? 'bg-indigo-50 text-indigo-500' : 'bg-gray-100 text-gray-400'} flex items-center justify-center transition-colors`}>
                                <i className="fas fa-bell"></i>
                            </div>
                            <span className="text-sm font-bold text-gray-700">Notifications</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`text-xs font-medium ${isNotifEnabled ? 'text-green-500' : 'text-gray-400'}`}>
                                {isNotifEnabled ? 'On' : 'Off'}
                            </span>
                            <div className={`w-10 h-6 rounded-full p-1 transition-colors ${isNotifEnabled ? 'bg-teal-500' : 'bg-gray-200'}`}>
                                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isNotifEnabled ? 'translate-x-4' : 'translate-x-0'}`}></div>
                            </div>
                        </div>
                    </button>
                    
                    {isNotifEnabled && (
                         <button onClick={handleTestNotification} className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-100">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-yellow-50 text-yellow-500 flex items-center justify-center">
                                    <i className="fas fa-vial"></i>
                                </div>
                                <span className="text-sm font-bold text-gray-700">Test Notification</span>
                            </div>
                            <i className="fas fa-chevron-right text-gray-300 text-xs"></i>
                        </button>
                    )}

                    <button onClick={handleExport} className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-green-50 text-green-500 flex items-center justify-center">
                                <i className="fas fa-file-export"></i>
                            </div>
                            <span className="text-sm font-bold text-gray-700">Export Data</span>
                        </div>
                        <i className="fas fa-chevron-right text-gray-300 text-xs"></i>
                    </button>
                </div>

                {/* Support Group */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <button className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-100">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center">
                                <i className="fas fa-question-circle"></i>
                            </div>
                            <span className="text-sm font-bold text-gray-700">Help & Support</span>
                        </div>
                        <i className="fas fa-chevron-right text-gray-300 text-xs"></i>
                    </button>
                    <button className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center">
                                <i className="fas fa-shield-alt"></i>
                            </div>
                            <span className="text-sm font-bold text-gray-700">Privacy Policy</span>
                        </div>
                        <i className="fas fa-chevron-right text-gray-300 text-xs"></i>
                    </button>
                </div>

                {/* Logout Button */}
                <button 
                    onClick={onLogout}
                    className="w-full bg-white rounded-2xl border border-red-100 p-4 flex items-center justify-center text-red-500 font-bold hover:bg-red-50 transition-colors shadow-sm"
                >
                    Log Out
                </button>
                
                <p className="text-center text-xs text-gray-400 pt-4">Version 1.2.0 • Build 2024</p>
            </div>
        )}

      </div>
    </div>
  );
};