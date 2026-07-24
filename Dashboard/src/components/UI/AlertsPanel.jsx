import { useMemo, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, AlertTriangle, AlertCircle, ArrowRight, CheckCircle2, Info, Clock, Check, Trash2 } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useNavigate } from 'react-router-dom'

function timeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AlertsPanel({ open, onClose }) {
  const { orders, vehicles, centers, activityLogs, markAllLogsAsRead, clearLogs } = useApp()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('alerts')

  useEffect(() => {
    if (open && activeTab === 'activity') {
      markAllLogsAsRead()
    }
  }, [open, activeTab, markAllLogsAsRead])

  const alerts = useMemo(() => {
    const list = []
    
    // 1. Unassigned Orders
    const unassignedOrders = orders.filter(o => o.status === 'pending' && !o.vehicle_id && o.delivery_center_id)
    if (unassignedOrders.length > 0) {
      list.push({
        id: 'unassigned',
        type: 'warning',
        title: 'Unassigned Orders',
        message: `${unassignedOrders.length} active order(s) are waiting to be assigned to a vehicle.`,
        actionText: 'View Orders',
        onAction: () => {
          navigate('/orders')
          onClose()
        }
      })
    }

    // 2. Orphan Orders (No Hub Assigned)
    const orphanOrders = orders.filter(o => o.status !== 'delivered' && !o.delivery_center_id)
    if (orphanOrders.length > 0) {
      list.push({
        id: 'orphan',
        type: 'critical',
        title: 'No Hub Assigned',
        message: `${orphanOrders.length} order(s) are missing a delivery center.`,
        actionText: 'Assign Hubs',
        onAction: () => {
          navigate('/orders')
          onClose()
        }
      })
    }

    // 3. No vehicles available in this hub
    centers.forEach(c => {
      const availableVehicles = vehicles.filter(v => String(v.delivery_center_id) === String(c.id) && v.is_available)
      const pendingOrders = orders.filter(o => String(o.delivery_center_id) === String(c.id) && o.status === 'pending')
      if (availableVehicles.length === 0 && pendingOrders.length > 0) {
        list.push({
          id: `no-vehicle-${c.id}`,
          type: 'critical',
          title: 'Vehicle Shortage',
          message: `Hub "${c.name}" has pending orders but no available vehicles.`,
          actionText: 'Manage Vehicles',
          onAction: () => {
            navigate('/vehicles')
            onClose()
          }
        })
      }
    })

    return list
  }, [orders, vehicles, centers, navigate, onClose])

  const unreadLogsCount = activityLogs ? activityLogs.filter(log => !log.read).length : 0

  if (!open) return null

  return createPortal(
    <>
      <div className="fixed inset-0 z-[100] bg-zinc-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-y-0 left-0 z-[110] w-full sm:w-96 bg-white dark:bg-zinc-950 shadow-2xl flex flex-col transform animate-in slide-in-from-left duration-300 border-r border-zinc-200 dark:border-zinc-800">
        
        {/* Header */}
        <div className="flex flex-col border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between px-6 py-4">
            <div>
              <h2 className="text-lg font-black text-zinc-900 dark:text-white">Notifications</h2>
              <p className="text-xs font-medium text-zinc-500">System alerts and activity logs</p>
            </div>
            <button onClick={onClose} className="p-2 text-zinc-500 hover:bg-zinc-100 rounded-lg dark:hover:bg-zinc-800 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-4 px-6">
            <button 
              onClick={() => setActiveTab('alerts')}
              className={`pb-3 text-sm font-bold border-b-2 transition-colors relative ${activeTab === 'alerts' ? 'border-zinc-900 text-zinc-900 dark:border-white dark:text-white' : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
            >
              Action Required
              {alerts.length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400 text-[10px] px-1.5 py-0.5 rounded-full font-black">
                  {alerts.length}
                </span>
              )}
            </button>
            <button 
              onClick={() => setActiveTab('activity')}
              className={`pb-3 text-sm font-bold border-b-2 transition-colors relative ${activeTab === 'activity' ? 'border-zinc-900 text-zinc-900 dark:border-white dark:text-white' : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
            >
              Recent Activity
              {unreadLogsCount > 0 && (
                <span className="ml-2 inline-flex items-center justify-center bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 text-[10px] px-1.5 py-0.5 rounded-full font-black">
                  {unreadLogsCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-zinc-50/50 dark:bg-zinc-950/50">
          {activeTab === 'alerts' ? (
            alerts.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-zinc-500 space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <p className="text-sm font-medium">All clear! No pending issues.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {alerts.map(alert => (
                  <div key={alert.id} className={`p-4 rounded-xl border bg-white dark:bg-zinc-900 shadow-sm ${alert.type === 'critical' ? 'border-red-200 dark:border-red-500/20' : 'border-amber-200 dark:border-amber-500/20'}`}>
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 shrink-0 ${alert.type === 'critical' ? 'text-red-500' : 'text-amber-500'}`}>
                        {alert.type === 'critical' ? <AlertCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                      </div>
                      <div className="flex-1">
                        <h4 className={`text-sm font-bold ${alert.type === 'critical' ? 'text-red-800 dark:text-red-400' : 'text-amber-800 dark:text-amber-400'}`}>{alert.title}</h4>
                        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">{alert.message}</p>
                        
                        {alert.actionText && (
                          <button onClick={alert.onAction} className={`mt-3 flex items-center gap-1.5 text-xs font-black uppercase tracking-wider hover:opacity-70 transition-opacity ${alert.type === 'critical' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                            {alert.actionText}
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <>
              {activityLogs && activityLogs.length > 0 && (
                <div className="flex justify-end mb-3">
                  <button onClick={clearLogs} className="flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-red-500 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear Logs
                  </button>
                </div>
              )}
              {(!activityLogs || activityLogs.length === 0) ? (
                <div className="h-full flex flex-col items-center justify-center text-zinc-500 space-y-3">
                  <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                    <Clock className="w-6 h-6 text-zinc-400" />
                  </div>
                  <p className="text-sm font-medium">No recent activity.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activityLogs.map(log => (
                    <div key={log.id} className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm relative">
                      {!log.read && (
                        <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-blue-500"></div>
                      )}
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 shrink-0 ${log.type === 'success' ? 'text-emerald-500' : 'text-blue-500'}`}>
                          {log.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <Info className="w-5 h-5" />}
                        </div>
                        <div className="flex-1 min-w-0 pr-4">
                          <h4 className="text-sm font-bold text-zinc-900 dark:text-white">{log.title}</h4>
                          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">{log.message}</p>
                          <p className="mt-2 text-[10px] font-medium text-zinc-400">
                            {timeAgo(log.timestamp)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  )
}
