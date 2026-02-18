import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppNotification } from '../types';
import { resolveLanguage, tr } from '../services/i18n';

interface LayoutProps {
  children: React.ReactNode;
  notifications?: AppNotification[];
  onClearNotifications?: () => void;
  language?: 'en' | 'ar';
}

export const Layout: React.FC<LayoutProps> = ({ children, notifications = [], onClearNotifications, language = 'en' }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const isInteractionsPage = location.pathname === '/interactions';
  const lang = resolveLanguage(language);

  const unreadCount = notifications.filter(n => !n.read).length;

  const navItems = [
    { icon: 'fa-home', label: tr(lang, 'Home', 'الرئيسية'), path: '/' },
    { icon: 'fa-pills', label: tr(lang, 'Meds', 'الأدوية'), path: '/medications' },
    { icon: 'fa-chart-pie', label: tr(lang, 'Reports', 'التقارير'), path: '/reports' },
    { icon: 'fa-robot', label: 'AI', path: '/interactions' },
    { icon: 'fa-user', label: tr(lang, 'Profile', 'الملف'), path: '/profile' },
  ];

  // Close notification dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const getIconForType = (type: string) => {
    switch (type) {
        case 'reminder': return 'fa-clock text-blue-500 bg-blue-50';
        case 'warning': return 'fa-exclamation-triangle text-orange-500 bg-orange-50';
        case 'success': return 'fa-check-circle text-green-500 bg-green-50';
        default: return 'fa-info-circle text-gray-500 bg-gray-50';
    }
  };

  const formatTime = (isoString: string) => {
      const date = new Date(isoString);
      const now = new Date();
      const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
      
      if (diffInSeconds < 60) return tr(lang, 'Just now', 'الآن');
      if (diffInSeconds < 3600) return tr(lang, `${Math.floor(diffInSeconds / 60)}m ago`, `منذ ${Math.floor(diffInSeconds / 60)} د`);
      if (diffInSeconds < 86400) return tr(lang, `${Math.floor(diffInSeconds / 3600)}h ago`, `منذ ${Math.floor(diffInSeconds / 3600)} س`);
      return date.toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US');
  };

  return (
    <div className="flex flex-col h-[100dvh] min-h-[100dvh] bg-gray-50 text-gray-900 overflow-hidden font-sans">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md shadow-sm z-30 px-4 py-3 flex justify-between items-center sticky top-0 border-b border-gray-100">
        <div className="flex items-center space-x-2">
            <div className="w-9 h-9 bg-gradient-to-tr from-teal-500 to-emerald-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-teal-200">
                <i className="fas fa-heartbeat text-lg"></i>
            </div>
            <h1 className="text-xl font-bold text-gray-800 tracking-tight">PillCare</h1>
        </div>
        
        {/* Notification Bell & Dropdown */}
        <div className="relative" ref={notifRef}>
            <button 
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative w-10 h-10 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors focus:outline-none"
            >
                <i className={`fas fa-bell text-xl ${unreadCount > 0 ? 'text-gray-700' : 'text-gray-400'}`}></i>
                {unreadCount > 0 && (
                    <span className="absolute top-2 right-2 w-3 h-3 bg-red-500 border-2 border-white rounded-full animate-pulse"></span>
                )}
            </button>

            {/* Dropdown Panel */}
            {showNotifications && (
                <div className="absolute right-0 top-12 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden animate-slide-up origin-top-right z-50">
                    <div className="p-4 border-b border-gray-50 flex justify-between items-center bg-gray-50/50">
                        <h3 className="font-bold text-gray-800">{tr(lang, 'Notifications', 'الإشعارات')}</h3>
                        {notifications.length > 0 && (
                            <button 
                                onClick={onClearNotifications}
                                className="text-xs font-bold text-teal-600 hover:text-teal-700"
                            >
                                {tr(lang, 'Clear All', 'مسح الكل')}
                            </button>
                        )}
                    </div>
                    
                    <div className="max-h-[60vh] overflow-y-auto no-scrollbar">
                        {notifications.length === 0 ? (
                            <div className="p-8 text-center text-gray-400 flex flex-col items-center">
                                <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-2">
                                    <i className="fas fa-bell-slash text-xl opacity-50"></i>
                                </div>
                                <p className="text-sm font-medium">{tr(lang, 'No notifications', 'لا توجد إشعارات')}</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-50">
                                {notifications.map((notif) => (
                                    <div key={notif.id} className={`p-4 hover:bg-gray-50 transition-colors flex gap-3 ${!notif.read ? 'bg-blue-50/30' : ''}`}>
                                        <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${getIconForType(notif.type)}`}>
                                            <i className={`fas ${getIconForType(notif.type).split(' ')[0]}`}></i>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-gray-800 leading-tight">{notif.title}</p>
                                            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{notif.message}</p>
                                            <p className="text-[10px] text-gray-400 mt-1.5 font-medium">{formatTime(notif.timestamp)}</p>
                                        </div>
                                        {!notif.read && (
                                            <div className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 flex-shrink-0"></div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className={`${isInteractionsPage ? 'flex-1 min-h-0 overflow-y-auto pb-16 sm:pb-20 no-scrollbar relative scroll-smooth' : 'flex-1 min-h-0 overflow-y-auto pb-20 no-scrollbar relative scroll-smooth'}`}>
        <div className={`${isInteractionsPage ? 'min-h-full w-full' : 'max-w-3xl mx-auto w-full p-4 sm:p-6'}`}>
            {children}
        </div>
      </main>

      {/* Bottom Navigation */}
      <nav className="bg-white/90 backdrop-blur-lg border-t border-gray-200 fixed bottom-0 w-full z-20 pb-safe shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <div className="max-w-3xl mx-auto flex justify-around items-center h-16 sm:h-20">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`flex flex-col items-center justify-center w-full h-full space-y-1 transition-all duration-300 relative group
                  ${isActive ? 'text-teal-600' : 'text-gray-400 hover:text-gray-600'}`}
              >
                {isActive && (
                    <span className="absolute -top-[1px] w-8 h-1 bg-teal-500 rounded-b-full shadow-sm"></span>
                )}
                <i className={`fas ${item.icon} transition-transform duration-300 ${isActive ? 'text-xl -translate-y-1' : 'text-lg group-hover:scale-110'}`}></i>
                <span className={`text-[10px] font-bold transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-70'}`}>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
