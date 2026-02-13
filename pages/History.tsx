import React from 'react';
import { LogEntry } from '../types';

interface HistoryProps {
  logs: LogEntry[];
}

export const History: React.FC<HistoryProps> = ({ logs }) => {
  return (
    <div className="space-y-6">
       <h2 className="text-2xl font-bold text-gray-800">History Log</h2>
       
       <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {logs.length === 0 ? (
                <div className="p-8 text-center text-gray-400">
                    <p>No history yet.</p>
                </div>
            ) : (
                <div className="divide-y divide-gray-100">
                    {logs.map((log) => (
                        <div key={log.id} className="p-4 flex justify-between items-center">
                            <div>
                                <p className="font-bold text-gray-800">{log.medicationName}</p>
                                <p className="text-xs text-gray-500">
                                    {new Date(log.timestamp).toLocaleDateString()} • {new Date(log.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </p>
                            </div>
                            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold">
                                {log.status}
                            </span>
                        </div>
                    ))}
                </div>
            )}
       </div>
    </div>
  );
};