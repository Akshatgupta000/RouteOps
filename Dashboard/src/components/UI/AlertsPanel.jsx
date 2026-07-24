import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, AlertTriangle, AlertCircle, ArrowRight } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { useNavigate } from 'react-router-dom'

export default function AlertsPanel({ open, onClose }) {
  const { orders, vehicles, centers } = useApp()
  const navigate = useNavigate()

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

  if (!open) return null

  return createPortal(
    <>
      <div className="fixed inset-0 z-[100] bg-zinc-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-y-0 left-0 z-[110] w-full sm:w-96 bg-white dark:bg-zinc-950 shadow-2xl flex flex-col transform animate-in slide-in-from-left duration-300 border-r border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
          <div>
            <h2 className="text-lg font-black text-zinc-900 dark:text-white">Operational Logs</h2>
            <p className="text-xs font-medium text-zinc-500">System alerts and notifications</p>
          </div>
          <button onClick={onClose} className="p-2 text-zinc-500 hover:bg-zinc-100 rounded-lg dark:hover:bg-zinc-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {alerts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-medium">All clear! No pending issues.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map(alert => (
                <div key={alert.id} className={`p-4 rounded-xl border ${alert.type === 'critical' ? 'bg-red-50/50 border-red-200 dark:bg-red-500/10 dark:border-red-500/20' : 'bg-amber-50/50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20'}`}>
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
          )}
        </div>
      </div>
    </>,
    document.body
  )
}
