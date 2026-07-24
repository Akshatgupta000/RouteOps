import { NavLink, useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect, useMemo } from 'react'
import Card from '../UI/Card'
import Button from '../UI/Button'
import CalendarPicker from '../UI/CalendarPicker'
import { useApp } from '../../context/AppContext'
import { formatDuration, formatKm } from '../../utils/format'
import AddCenterModal from '../Forms/AddCenterModal'
import EditCenterModal from '../Forms/EditCenterModal'
import Modal from '../UI/Modal'
import { LogOut, Sun, Moon, LayoutGrid, ClipboardList, Truck, Route, Trash2, Pencil, Bell } from 'lucide-react'
import avatar from '../../assets/avatar.png'
import AlertsPanel from '../UI/AlertsPanel'

const linkClass = ({ isActive }) =>
  `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
    isActive
      ? 'bg-zinc-900 text-white shadow-md dark:bg-white dark:text-zinc-900'
      : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
  } lg:justify-start justify-center lg:px-3 px-0`

export default function Sidebar({ onClose }) {
  const navigate = useNavigate()
  const {
    toggleTheme,
    theme,
    centers,
    orders,
    vehicles,
    selectedCenterId,
    setSelectedCenterId,
    selectedDate,
    setSelectedDate,
    refreshCenters,
    refreshOrders,
    refreshVehicles,
    refreshRoutes,
    setOrders,
    setVehicles,
    setActiveMultiRoutes,
    setActiveRouteBase,
    toast,
    resetSelection,
    generateRoutesAction,
  } = useApp()

  const [showHubs, setShowHubs] = useState(false)
  const [addCenterOpen, setAddCenterOpen] = useState(false)
  const [editingCenter, setEditingCenter] = useState(null)
  const [deleteConfirmCenter, setDeleteConfirmCenter] = useState(null)
  const [alertsOpen, setAlertsOpen] = useState(false)

  const alertsCount = useMemo(() => {
    let count = 0
    count += orders.filter(o => o.status === 'pending' && !o.vehicle_id && o.delivery_center_id).length
    count += orders.filter(o => o.status !== 'delivered' && !o.delivery_center_id).length
    centers.forEach(c => {
      const availableVehicles = vehicles.filter(v => String(v.delivery_center_id) === String(c.id) && v.is_available)
      const pendingOrders = orders.filter(o => String(o.delivery_center_id) === String(c.id) && o.status === 'pending')
      if (availableVehicles.length === 0 && pendingOrders.length > 0) count++
    })
    return count
  }, [orders, vehicles, centers])

  const currentCenter = centers.find(c => String(c.id) === String(selectedCenterId))

  const [deleting, setDeleting] = useState(false)
  const hubRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(event) {
      if (hubRef.current && !hubRef.current.contains(event.target)) {
        setShowHubs(false)
      }
    }
    if (showHubs) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showHubs])

  const confirmDeleteCenter = async () => {
    if (!deleteConfirmCenter) return

    setDeleting(true)
    try {
      const response = await api.deleteCenter(deleteConfirmCenter.id)
      toast(response.message || 'Hub deleted and orders reassigned')
      resetSelection()
      setVehicles(prev => prev.filter(v => String(v.delivery_center_id) !== String(deleteConfirmCenter.id)))
      setOrders(prev => prev.filter(o => String(o.delivery_center_id) !== String(deleteConfirmCenter.id)))
      setDeleteConfirmCenter(null)
      setShowHubs(false)
      await Promise.all([
        refreshCenters(),
        refreshOrders(),
        refreshVehicles(),
        refreshRoutes()
      ])
      await generateRoutesAction()
    } catch (err) {
      const msg = err?.response?.data?.message || err.message || 'Failed to delete hub safely'
      toast(msg, 'error')
    } finally {
      setDeleting(false)
    }
  }

  const handleNavClick = () => {
    if (onClose) onClose()
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-transparent">
      {/* Brand Section */}
      <div className={`flex items-center justify-center lg:justify-between gap-2 border-b border-zinc-200/80 px-4 py-4 dark:border-zinc-800 transition-all duration-300 ${showHubs ? 'blur-[2px] opacity-40 grayscale pointer-events-none' : ''}`}>
        <div className="flex flex-col hidden lg:flex">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
            Last-Mile
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
            Routiqo
          </h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setAlertsOpen(true)}
            className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 hover:bg-zinc-200 lg:bg-transparent lg:hover:bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 lg:dark:bg-transparent lg:dark:hover:bg-zinc-800 transition-all"
          >
            <Bell className="h-4 w-4" />
            {alertsCount > 0 && (
              <span className="absolute top-2 right-2 flex h-2 w-2 items-center justify-center rounded-full bg-red-500 ring-2 ring-white dark:ring-zinc-950"></span>
            )}
          </button>
          <button
            onClick={toggleTheme}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 hover:bg-zinc-200 lg:bg-transparent lg:hover:bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 lg:dark:bg-transparent lg:dark:hover:bg-zinc-800 transition-all"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className={`flex flex-col gap-1.5 p-3 transition-all duration-300 ${showHubs ? 'blur-[2px] opacity-40 grayscale pointer-events-none' : ''}`}>
        <NavLink to="/" end className={linkClass} onClick={handleNavClick}>
          <LayoutGrid className="h-5 w-5 shrink-0" />
          <span className="hidden lg:block">Dashboard</span>
        </NavLink>
        <NavLink to="/orders" className={linkClass} onClick={handleNavClick}>
          <ClipboardList className="h-5 w-5 shrink-0" />
          <span className="hidden lg:block">Orders</span>
        </NavLink>
        <NavLink to="/vehicles" className={linkClass} onClick={handleNavClick}>
          <Truck className="h-5 w-5 shrink-0" />
          <span className="hidden lg:block">Vehicles</span>
        </NavLink>
        <NavLink to="/routes" className={linkClass} onClick={handleNavClick}>
          <Route className="h-5 w-5 shrink-0" />
          <span className="hidden lg:block">Routes</span>
        </NavLink>
      </nav>

      {/* Calendar - Compact/Hidden on tablet */}
      <div className={`flex-1 overflow-y-auto px-3 pb-2 custom-scrollbar transition-all duration-300 md:hidden lg:block ${showHubs ? 'blur-[2px] opacity-40 grayscale pointer-events-none' : ''}`}>
        <CalendarPicker
          value={selectedDate}
          onChange={setSelectedDate}
          orderCount={orders.length}
          refreshKey={orders.length}
        />
      </div>

      {/* Operations Hub Selection */}
      <div className="border-t border-zinc-200/80 p-3 dark:border-zinc-800 relative">
        <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 lg:block hidden">
          Operations Hub
        </label>

        <div className="relative" ref={hubRef}>
          <button
            onClick={() => centers.length === 0 ? setAddCenterOpen(true) : setShowHubs(!showHubs)}
            className={`w-full flex items-center gap-2 rounded-xl transition-all border ${
              showHubs 
                ? 'bg-zinc-50 border-zinc-300 ring-2 ring-zinc-900/5 dark:bg-zinc-800 dark:border-zinc-600' 
                : 'bg-white border-zinc-200 hover:border-zinc-300 dark:bg-zinc-900 dark:border-zinc-800 dark:hover:border-zinc-700 shadow-sm'
            } ${centers.length === 0 ? 'p-3' : 'lg:p-2 p-1 justify-center lg:justify-start'}`}
          >
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 shadow-sm ${currentCenter ? 'bg-zinc-900 dark:bg-white' : (centers.length === 0 ? 'bg-primary/10 text-primary' : 'bg-zinc-100 dark:bg-zinc-800')}`}>
              <span className={`text-xs font-black ${currentCenter ? 'text-white dark:text-zinc-900' : 'text-zinc-500'}`}>
                {currentCenter ? currentCenter.name.charAt(0).toUpperCase() : (centers.length === 0 ? '+' : '○')}
              </span>
            </div>
            
            <div className="text-left min-w-0 hidden lg:block flex-1">
              <p className={`text-sm font-black truncate tracking-tight leading-none ${currentCenter ? 'text-zinc-900 dark:text-white' : 'text-primary'}`}>
                {centers.length === 0 ? 'New Hub' : (currentCenter ? currentCenter.name : 'Select a Hub')}
              </p>
              <p className="mt-0.5 text-[10px] text-zinc-500 truncate">
                {centers.length === 0 ? 'Create your first hub' : (currentCenter ? currentCenter.address : 'Click to choose')}
              </p>
            </div>

            <svg 
              className={`w-4 h-4 text-zinc-400 transition-transform duration-300 hidden lg:block ${showHubs ? 'rotate-180' : ''}`} 
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Hub List Popup */}
          {showHubs && (
            <div className="absolute bottom-full left-0 mb-4 w-72 z-[70] bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-2xl shadow-zinc-950/20 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="p-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 pl-2">Available Hubs</span>
                <button 
                  onClick={() => {
                    setShowHubs(false);
                    setAddCenterOpen(true);
                  }}
                  className="text-[10px] font-black uppercase text-primary hover:opacity-80 px-2 py-1"
                >
                  + New Hub
                </button>
              </div>
              <div className="max-h-[320px] overflow-y-auto custom-scrollbar p-2 space-y-1">
                {centers.map((c) => {
                  const isSelected = selectedCenterId === c.id
                  return (
                    <div key={c.id} className="group relative flex gap-1">
                      <button
                        onClick={() => {
                          setSelectedCenterId(c.id)
                          setActiveMultiRoutes([])
                          setActiveRouteBase(null)
                          setShowHubs(false)
                          navigate('/')
                          handleNavClick()
                        }}
                        className={`flex-1 flex items-center gap-3 p-3 rounded-xl transition-all ${
                          isSelected 
                            ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 shadow-lg' 
                            : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                        }`}
                      >
                        <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-primary' : 'bg-zinc-200 dark:bg-zinc-700'}`} />
                        <div className="text-left min-w-0 flex-1">
                          <p className="text-xs font-bold truncate">{c.name}</p>
                          <p className={`text-[10px] truncate ${isSelected ? 'text-zinc-400' : 'text-zinc-500'}`}>{c.address}</p>
                        </div>
                      </button>
                      
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingCenter(c)
                          }}
                          className={`p-2 rounded-lg transition-all opacity-0 group-hover:opacity-100 ${
                            isSelected 
                              ? 'text-white/60 hover:text-white hover:bg-white/20' 
                              : 'text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/20'
                          }`}
                          title="Edit Hub"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteConfirmCenter(c)
                          }}
                          className={`p-2 rounded-lg transition-all opacity-0 group-hover:opacity-100 ${
                            isSelected 
                              ? 'text-white/60 hover:text-white hover:bg-white/20' 
                              : 'text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20'
                          }`}
                          title="Delete Hub"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* User Profile */}
      <div className="border-t border-zinc-200/80 p-3 dark:border-zinc-800">
        <div className={`flex items-center gap-3 px-1 ${centers.length === 0 ? 'justify-between' : 'lg:justify-between justify-center'}`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 shadow-sm overflow-hidden border border-zinc-200 dark:border-zinc-700">
              <img src={avatar} alt="User Avatar" className="w-full h-full object-cover scale-110" />
            </div>
            <div className="min-w-0 hidden lg:block">
              <p className="text-xs font-bold text-zinc-900 dark:text-white truncate">
                {JSON.parse(localStorage.getItem('user') || '{}')?.name || 'User'}
              </p>
              <p className="text-[10px] text-zinc-500 truncate">
                {JSON.parse(localStorage.getItem('user') || '{}')?.email || ''}
              </p>
            </div>
          </div>
          <button 
            onClick={() => {
              localStorage.clear()
              window.location.href = import.meta.env.VITE_LANDING_URL
            }}
            className="p-2.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-xl transition-all hidden lg:block"
            title="Logout"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </div>

      <AddCenterModal open={addCenterOpen} onClose={() => setAddCenterOpen(false)} />
      <EditCenterModal open={!!editingCenter} onClose={() => setEditingCenter(null)} center={editingCenter} />
      <Modal
        open={!!deleteConfirmCenter}
        onClose={() => setDeleteConfirmCenter(null)}
        title="Delete Delivery Hub?"
        footer={
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setDeleteConfirmCenter(null)} disabled={deleting}>Cancel</Button>
            <Button variant="danger" onClick={confirmDeleteCenter} disabled={deleting}>
              {deleting ? 'Deleting Hub...' : 'Delete Hub'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-zinc-500">
          Are you sure you want to delete "{deleteConfirmCenter?.name}"? This will orphan all associated data.
        </p>
      </Modal>

      <AlertsPanel open={alertsOpen} onClose={() => setAlertsOpen(false)} />
    </div>
  )
}
