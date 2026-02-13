import React, { useState, useEffect, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Medications } from './pages/Medications';
import { Interactions } from './pages/Interactions';
import { Profile } from './pages/Profile';
import { History } from './pages/History';
import { Reports } from './pages/Reports';
import { AuthPage } from './pages/Auth';
import { Medication, UserProfile, LogEntry, DosageForm, AppNotification } from './types';
import { syncDispenserConfig, sendDispenseCommand, syncLogs, listenToData, auth, saveUserProfile } from './services/firebase';

// Mock Data Structure
const MOCK_USER: UserProfile = {
  name: "Guest User",
  age: 34,
  conditions: ["Hypertension", "Asthma"],
  allergies: ["Penicillin", "Peanuts"],
  emergencyContact: "+1 (555) 012-3456",
  notificationsEnabled: false
};

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [user, setUser] = useState<UserProfile>(MOCK_USER);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const [snoozedMeds, setSnoozedMeds] = useState<{ [key: string]: number }>({});
  
  // Track last checked minute to avoid duplicate alerts in same minute
  const lastCheckTimeRef = useRef<string>("");

  // Auth Listener
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(u => {
      setCurrentUser(u);
      setLoadingAuth(false);
      
      if (u) {
        if (!user.name || user.name === "Guest User") {
            setUser(prev => ({
                ...prev,
                name: u.displayName || u.email?.split('@')[0] || "User"
            }));
        }
      } else {
        setMedications([]);
        setLogs([]);
        setNotifications([]);
        setUser(MOCK_USER);
        setSnoozedMeds({});
        localStorage.removeItem('pillcare_meds');
        localStorage.removeItem('pillcare_logs');
      }
    });
    return unsubscribe;
  }, []);

  // Listen for Data
  useEffect(() => {
    if (currentUser) {
        const unsubscribe = listenToData(
            (fetchedMeds) => {
                setMedications(fetchedMeds || []);
                localStorage.setItem('pillcare_meds', JSON.stringify(fetchedMeds || []));
            },
            (fetchedLogs) => {
                setLogs(fetchedLogs || []);
                localStorage.setItem('pillcare_logs', JSON.stringify(fetchedLogs || []));
            },
            (fetchedProfile) => {
                setUser(prev => ({ ...prev, ...fetchedProfile }));
            }
        );
        return () => unsubscribe();
    }
  }, [currentUser]);

  // Sync Logic
  useEffect(() => {
    if (currentUser && medications.length > 0) syncDispenserConfig(medications);
  }, [medications, currentUser]);

  useEffect(() => {
    if (currentUser && logs.length > 0) syncLogs(logs);
  }, [logs, currentUser]);

  // --- Notification System ---

  const addNotification = (title: string, message: string, type: AppNotification['type'] = 'info') => {
      const newNotif: AppNotification = {
          id: Date.now().toString(),
          title,
          message,
          type,
          timestamp: new Date().toISOString(),
          read: false
      };
      setNotifications(prev => [newNotif, ...prev]);
  };

  const sendBrowserNotification = (title: string, body: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body,
          icon: 'https://cdn-icons-png.flaticon.com/512/883/883360.png', // Fallback icon
        });
      } catch (e) {
        console.error("Failed to send notification", e);
      }
    }
  };

  // Periodic Reminder Check (Every 60s)
  useEffect(() => {
    if (!currentUser) return;

    const checkReminders = () => {
        const now = new Date();
        const currentTimeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        
        // Prevent duplicate checks within the same minute
        if (lastCheckTimeRef.current === currentTimeString) return;
        lastCheckTimeRef.current = currentTimeString;

        medications.forEach(med => {
            // Check Daily Schedules
            if (med.frequencyType === 'Daily' && med.scheduledTimes?.includes(currentTimeString)) {
                // Determine if already taken today? 
                // For simplified reminders, we just remind at the time.
                const title = `Time for ${med.name}`;
                const msg = `It's ${currentTimeString}. Please take your ${med.dosage} dose.`;
                
                if (user.notificationsEnabled) {
                    sendBrowserNotification(title, msg);
                }
                addNotification(title, msg, 'reminder');
            }
        });

        // Check Low Stock (Less frequent in real app, but here we check periodically)
        // To avoid spam, we could check only once a day, but for demo we assume logic elsewhere handles frequency
    };

    const timer = setInterval(checkReminders, 10000); // Check every 10s to hit the minute mark precisely
    return () => clearInterval(timer);
  }, [medications, currentUser, user.notificationsEnabled]);

  // Initial Permission Request
  useEffect(() => {
    // We do NOT automatically request permission here anymore if we want the user to control it via Profile
    // However, if already granted, we can assume we are good.
    // If we want to prompt early, we can, but let's stick to user-initiated in Profile for better UX.
  }, []);

  const handleClearNotifications = () => {
      setNotifications([]);
  };

  // --- Handlers ---

  const handleAddMedication = (med: Medication) => {
    const newMeds = [...medications, med];
    setMedications(newMeds);
    syncDispenserConfig(newMeds);
    addNotification('Medication Added', `${med.name} has been added to your schedule.`, 'success');
  };

  const handleUpdateMedication = (updatedMed: Medication) => {
    const newMeds = medications.map(m => m.id === updatedMed.id ? updatedMed : m);
    setMedications(newMeds);
    syncDispenserConfig(newMeds);
  };

  const handleDeleteMedication = (id: string) => {
    const newMeds = medications.filter(m => m.id !== id);
    setMedications(newMeds);
    syncDispenserConfig(newMeds);
  };

  const handleLogDose = (medId: string) => {
    const med = medications.find(m => m.id === medId);
    if (med) {
        const newLog: LogEntry = {
            id: Date.now().toString(),
            medicationId: med.id,
            medicationName: med.name,
            timestamp: new Date().toISOString(),
            status: 'Taken'
        };
        const newLogs = [newLog, ...logs];
        setLogs(newLogs);
        syncLogs(newLogs);
        
        const newInventory = Math.max(0, med.inventoryCount - 1);
        const newMeds = medications.map(m => 
            m.id === medId ? { ...m, inventoryCount: newInventory } : m
        );
        setMedications(newMeds);
        syncDispenserConfig(newMeds);

        if (med.slot) sendDispenseCommand(med.slot, med.name);

        if (newInventory <= 5 && newInventory > 0) {
             const msg = `Only ${newInventory} pills left of ${med.name}.`;
             if (user.notificationsEnabled) {
                 sendBrowserNotification("Low Stock Alert", msg);
             }
             addNotification("Low Stock Warning", msg, 'warning');
        } else if (newInventory === 0) {
             const msg = `${med.name} is out of stock!`;
             if (user.notificationsEnabled) {
                 sendBrowserNotification("Out of Stock", msg);
             }
             addNotification("Out of Stock", msg, 'warning');
        }
    }
  };

  const handleSnooze = (medId: string) => {
    const snoozeUntil = Date.now() + 15 * 60 * 1000;
    setSnoozedMeds(prev => ({ ...prev, [medId]: snoozeUntil }));
    addNotification("Snoozed", "Reminder set for 15 minutes from now.", 'info');
  };

  const handleDismiss = (medId: string) => {
    const med = medications.find(m => m.id === medId);
    if (med) {
        const newLog: LogEntry = {
            id: Date.now().toString(),
            medicationId: med.id,
            medicationName: med.name,
            timestamp: new Date().toISOString(),
            status: 'Skipped'
        };
        const newLogs = [newLog, ...logs];
        setLogs(newLogs);
        syncLogs(newLogs);
    }
  };

  const handleUpdateProfile = (updatedProfile: UserProfile) => {
      setUser(updatedProfile);
      saveUserProfile(updatedProfile);
      addNotification("Profile Updated", "Your changes have been saved successfully.", 'success');
  };

  const handleLogout = () => {
    auth.signOut();
  };

  if (loadingAuth) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center text-teal-600">
            <i className="fas fa-heartbeat fa-spin text-4xl mb-2"></i>
            <p className="font-medium">Loading PillCare...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <AuthPage />;
  }

  return (
    <HashRouter>
      <Layout notifications={notifications} onClearNotifications={handleClearNotifications}>
        <Routes>
          <Route path="/" element={
            <Dashboard 
                medications={medications} 
                logs={logs} 
                onLogDose={handleLogDose} 
                onSnooze={handleSnooze}
                onDismiss={handleDismiss}
                userName={user.name}
                snoozedMeds={snoozedMeds}
            />
          } />
          <Route path="/medications" element={
            <Medications 
                medications={medications} 
                onAdd={handleAddMedication} 
                onUpdate={handleUpdateMedication}
                onDelete={handleDeleteMedication} 
            />
          } />
          <Route path="/interactions" element={
            <Interactions 
                medications={medications} 
                userAllergies={user.allergies} 
            />
          } />
          <Route path="/history" element={<History logs={logs} />} />
          <Route path="/reports" element={<Reports logs={logs} medications={medications} />} />
          <Route path="/profile" element={
            <Profile 
                user={user} 
                medications={medications}
                logs={logs}
                onLogout={handleLogout} 
                onUpdate={handleUpdateProfile} 
            />
          } />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
};

export default App;