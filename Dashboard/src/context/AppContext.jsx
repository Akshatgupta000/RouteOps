import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
} from 'react'
import * as api from '../services/api'
import { computeVehiclePosition } from '../utils/routeMap'
import { buildPlaybackPathForRoute, buildLegPath } from '../utils/simplePlaybackPath'
import { getLocalDateString } from '../utils/format'
import { Delaunay } from 'd3-delaunay'

export const AppContext = createContext(null)

function readInitialTheme() {
  try {
    const saved = localStorage.getItem('theme')
    if (saved === 'dark' || saved === 'light') return saved
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

function stripMeta(route) {
  if (!route) return null
  // eslint-disable-next-line no-unused-vars -- strip comparison attachment
  const { _comparisonRoute, ...rest } = route
  return rest
}

function getRouteKey(route) {
  return String(route?.route_id ?? route?.id ?? '')
}

function toSimulationRouteStatus(routeStatus) {
  if (routeStatus === 'in_progress') return 'active'
  if (routeStatus === 'completed') return 'completed'
  return 'pending'
}

function normalizeRouteForSimulation(route) {
  if (!route) return null

  const routeStatus = route.status ?? 'planned'
  const sortedStops = [...(route.stops ?? [])].sort(
    (a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0)
  )
  const currentSequence = Number(route.next_stop_sequence ?? 1)

  const stops = sortedStops.map((stop, index) => {
    let status = stop.status

    if (!status) {
      if (routeStatus === 'completed') {
        status = 'delivered'
      } else if (routeStatus === 'in_progress') {
        const sequence = Number(stop.sequence ?? index + 1)
        if (sequence < currentSequence) status = 'delivered'
        else if (sequence === currentSequence) status = 'current'
        else status = 'pending'
      } else {
        status = 'pending'
      }
    }

    return {
      ...stop,
      id: stop.id ?? stop.order_id ?? `${getRouteKey(route)}-${index}`,
      lat: Number(stop.lat ?? stop.latitude ?? stop.order?.latitude ?? 0),
      lng: Number(stop.lng ?? stop.longitude ?? stop.order?.longitude ?? 0),
      status,
    }
  })

  const currentStopIndex = stops.findIndex((s) => s.status === 'current')

  return {
    ...route,
    simulation_status: toSimulationRouteStatus(routeStatus),
    currentStopIndex: currentStopIndex >= 0 ? currentStopIndex : 0,
    stops,
  }
}

function getTodayString() {
  return getLocalDateString()
}

export function AppProvider({ children }) {
  const [theme, setTheme] = useState(readInitialTheme)
  const [centers, setCenters] = useState([])
  const [orders, setOrders] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [routesList, setRoutesList] = useState([])
  const [comparisons, setComparisons] = useState([])
  const [activeRouteBase, setActiveRouteBase] = useState(null)
  const [activeMultiRoutes, setActiveMultiRoutes] = useState([])
  const [selectedCenterId, setSelectedCenterId] = useState(null)
  const [activeOrderId, setActiveOrderId] = useState(null)
  const [loading, setLoading] = useState({ global: false })
  const [selectedDate, setSelectedDate] = useState(getTodayString)
  const [mapFocus, setMapFocus] = useState(null)
  const [toasts, setToasts] = useState([])
  const [bootstrapError, setBootstrapError] = useState(null)
  const [draftDeliveries, setDraftDeliveries] = useState([])
  /** Map animation: idle | running | paused | completed */
  const [simulationPhase, setSimulationPhase] = useState('idle')
  /** Per-vehicle polyline used for simple step animation (see buildPlaybackPathForRoute). */
  const [routePlaybackCoords, setRoutePlaybackCoords] = useState(null)
  /** Per-vehicle index along routePlaybackCoords[vehicleId]. */
  const [routePlaybackStep, setRoutePlaybackStep] = useState({})
  const playbackPathsRef = useRef({})
  const playbackIntervalRef = useRef(null)
  const [serviceZones, setServiceZones] = useState([])
  const [showZones, setShowZones] = useState(true)
  const [orderFilters, setOrderFilters] = useState({ hub: '', status: '' })

  const refreshZones = useCallback(async () => {
    try {
      const data = await api.getZones()
      setServiceZones(Array.isArray(data) ? data : [])
      return data
    } catch (e) {
      console.error('Failed to fetch zones', e)
      return []
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem('theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  const toast = useCallback((message, type = 'success') => {
    let safeMessage = String(message)
    if (typeof message === 'object' && message !== null) {
      try {
        safeMessage = message.message || JSON.stringify(message)
      } catch {
        safeMessage = '[Non-serializable Object]'
      }
    }
    
    const id = Date.now()
    
    setToasts((prev) => {
      // If the message is already active, don't duplicate it
      if (prev.some(t => t.message === safeMessage)) return prev
      
      // For a "single notification" experience as requested, we could also clear others
      // But let's just prevent duplicates for now to keep it usable.
      return [...prev, { id, message: safeMessage, type }]
    })

    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id))
    }, 4000)
  }, [])


  const clearPlaybackTimer = useCallback(() => {
    if (playbackIntervalRef.current != null) {
      window.clearInterval(playbackIntervalRef.current)
      playbackIntervalRef.current = null
    }
  }, [])

  const runPlaybackTimer = useCallback(() => {
    clearPlaybackTimer()
    playbackIntervalRef.current = window.setInterval(() => {
      setRoutePlaybackStep((prev) => {
        const paths = playbackPathsRef.current
        if (!paths || !Object.keys(paths).length) return prev

        const next = { ...prev }
        let allDone = true

        for (const vid of Object.keys(paths)) {
          const pts = paths[vid]
          if (!pts || pts.length < 2) continue
          const max = pts.length - 1
          const cur = next[vid] ?? 0
          if (cur < max) {
            next[vid] = Math.min(cur + 2, max)
            allDone = false
          }
        }

        if (allDone) {
          clearPlaybackTimer()
          window.setTimeout(() => {
            setSimulationPhase('completed')
          }, 0)
        }

        return next
      })
    }, 30)
  }, [clearPlaybackTimer, toast])

  useEffect(() => () => clearPlaybackTimer(), [clearPlaybackTimer])

  const dismissToast = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  const refreshCenters = useCallback(async () => {
    const data = await api.getCenters()
    const list = Array.isArray(data) ? data : data?.data ?? []
    setCenters(list)
    return list
  }, [])


  const refreshOrders = useCallback(async (filters = {}) => {
    // We remove hub/status filters here so they don't clobber global state
    // But we keep them in the argument for backwards compatibility if needed
    const data = await api.getOrders({ per_page: 200, date: selectedDate, ...filters })
    const list = data?.data ?? data ?? []
    setOrders(Array.isArray(list) ? list : [])
    return list
  }, [selectedDate])

  const refreshVehicles = useCallback(async () => {
    const data = await api.getVehicles()
    const list = Array.isArray(data) ? data : data?.data ?? []
    setVehicles(list)
    return list
  }, [])

  const refreshRoutes = useCallback(async () => {
    const data = await api.getRoutes()
    const list = data?.routes ?? data?.data ?? []
    
    // Deduplicate by route_id
    const uniqueList = Array.isArray(list) 
      ? Array.from(new Map(list.map(item => [item.route_id, item])).values())
      : []

    setRoutesList(uniqueList.map(normalizeRouteForSimulation))
    return uniqueList
  }, [])

  const generateVoronoiZonesAction = useCallback(async () => {
    if (centers.length < 2) return

    setLoading((l) => ({ ...l, zones: true }))
    try {
      const points = centers.map((c) => [Number(c.latitude), Number(c.longitude)])
      const delaunay = Delaunay.from(points)
      
      // Large clipping bounds for city-scale coverage
      const minLat = Math.min(...points.map(p => p[0])) - 1
      const maxLat = Math.max(...points.map(p => p[0])) + 1
      const minLng = Math.min(...points.map(p => p[1])) - 1
      const maxLng = Math.max(...points.map(p => p[1])) + 1
      
      const voronoi = delaunay.voronoi([minLat, minLng, maxLat, maxLng])
      
      const zones = []
      for (let i = 0; i < centers.length; i++) {
        const polygon = voronoi.cellPolygon(i)
        if (polygon) {
          zones.push({
            hub_id: centers[i].id,
            polygon: polygon.map((p) => [p[0], p[1]])
          })
        }
      }
      
      if (zones.length > 0) {
        await api.saveZones(zones)
        await refreshZones()
      }
    } catch (e) {
      console.error('Voronoi generation failed', e)
    } finally {
      setLoading((l) => ({ ...l, zones: false }))
    }
  }, [centers, refreshZones])

  useEffect(() => {
    if (centers.length >= 2) {
      void generateVoronoiZonesAction()
    } else {
      // Clear zones if not enough centers for Voronoi
      setServiceZones([])
      api.saveZones([]) // Clear on backend too
    }
  }, [centers.length, generateVoronoiZonesAction])

  const bootstrap = useCallback(async () => {
    setLoading((l) => ({ ...l, global: true }))
    setBootstrapError(null)
    try {
      await Promise.all([
        refreshCenters(), 
        refreshOrders(), 
        refreshVehicles(), 
        refreshRoutes(),
        refreshZones()
      ])
    } catch (e) {
      const msg = e?.response?.data?.message || e.message || 'Failed to load data'
      setBootstrapError(
        typeof msg === 'string' ? msg : 'Failed to load data. Is the API running at the configured base URL?'
      )
      toast(msg, 'error')
    } finally {
      setLoading((l) => ({ ...l, global: false }))
    }
  }, [refreshCenters, refreshOrders, refreshVehicles, refreshRoutes, refreshZones, toast])

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  // Auto-focus map when center is selected via dropdown or marker click
  useEffect(() => {
    if (selectedCenterId) {
      const center = centers.find(c => String(c.id) === String(selectedCenterId))
      if (center) {
        const lat = Number(center.latitude)
        const lng = Number(center.longitude)
        
        // Only trigger focus change if coordinates are different from current focus
        if (!mapFocus || mapFocus.lat !== lat || mapFocus.lng !== lng) {
          setMapFocus({ lat, lng, zoom: 11 })
        }
      }
    }
  }, [selectedCenterId, centers, mapFocus])

  const attachComparison = useCallback((route) => {
    return route
  }, [])

  const activeRoute = useMemo(
    () => attachComparison(activeRouteBase),
    [activeRouteBase, attachComparison]
  )

  const vehiclePosition = useMemo(
    () => computeVehiclePosition(activeRoute),
    [activeRoute]
  )

  const setActiveRoute = useCallback((route) => {
    setActiveRouteBase(normalizeRouteForSimulation(stripMeta(route)))
  }, [])

  const resetFleetSimulation = useCallback(
    ({ silent = false } = {}) => {
      clearPlaybackTimer()
      playbackPathsRef.current = {}
      setRoutePlaybackCoords(null)
      setRoutePlaybackStep({})
      setSimulationPhase('idle')
      if (!silent) toast('Fleet simulation reset.')
    },
    [toast, clearPlaybackTimer]
  )

  useEffect(() => {
    let t;
    if (simulationPhase === 'completed') {
      t = setTimeout(() => {
        resetFleetSimulation({ silent: true })
      }, 2500)
    }
    return () => clearTimeout(t)
  }, [simulationPhase, resetFleetSimulation])

  const resetSelection = useCallback(() => {
    resetFleetSimulation({ silent: true })
    setSelectedCenterId(null)
    setActiveRouteBase(null)
    setActiveMultiRoutes([])
    setActiveOrderId(null)
    setMapFocus(null)
  }, [resetFleetSimulation])

  const generateRoutesAction = useCallback(async (overrideCenterId = null) => {
    // Immediately clear state for instant visual feedback
    resetFleetSimulation({ silent: true })
    setActiveMultiRoutes([])
    setActiveRouteBase(null)

    const centerToUse = overrideCenterId || selectedCenterId
    const payload = {
      ...(centerToUse != null ? { delivery_center_id: centerToUse } : {}),
      date: selectedDate,
    }
    setLoading((l) => ({ ...l, generate: true }))
    try {
      let data
      if (activeMultiRoutes.length > 0 && centerToUse) {
        data = await api.regenerateRoutes(centerToUse, { date: selectedDate })
      } else {
        data = await api.generateRoute(payload)
      }
      
      const comps = data?.comparisons ?? []
      setComparisons(comps)
      
      if (!comps.length) {
        setActiveMultiRoutes([])
        setActiveRouteBase(null)
        toast('No pending orders in this hub\'s zone.', 'info')
        return
      }
      const allPrimaryRoutes = comps.map(c => c.shortest_distance_route)
      
      setActiveMultiRoutes(
        allPrimaryRoutes.map((r) => normalizeRouteForSimulation(stripMeta(r)))
      )
      if (allPrimaryRoutes.length > 0) {
        setActiveRouteBase(normalizeRouteForSimulation(stripMeta(allPrimaryRoutes[0])))
      }
      
      // Keep first one as the main active route for backwards compatibility / simulation
      if (allPrimaryRoutes.length > 0) {
        setActiveRouteBase(normalizeRouteForSimulation(stripMeta(allPrimaryRoutes[0])))
      }
      
      await Promise.all([refreshOrders(), refreshRoutes()])
      resetFleetSimulation({ silent: true })

      return allPrimaryRoutes.map((r) => normalizeRouteForSimulation(stripMeta(r)))
    } catch (e) {
      const msg =
        e?.response?.data?.errors?.delivery_center_id?.[0] ||
        e?.response?.data?.message ||
        e.message ||
        'Generation failed'
      // On error, clear active routes to prevent showing stale/invalid data
      setActiveMultiRoutes([])
      setActiveRouteBase(null)
      resetFleetSimulation({ silent: true })
      
      toast(msg, 'error')
    } finally {
      setLoading((l) => ({ ...l, generate: false }))
    }
  }, [
    selectedCenterId,
    selectedDate,
    refreshOrders,
    refreshRoutes,
    toast,
    activeMultiRoutes.length,
    resetFleetSimulation,
  ])

  const addCenterAction = useCallback(async (payload) => {
    setLoading((l) => ({ ...l, addCenter: true }))
    try {
      const response = await api.createCenter(payload)
      const newCenter = response.data || response
      
      // Fast refresh: Update centers state immediately
      setCenters(prev => [...prev, newCenter].sort((a, b) => a.name.localeCompare(b.name)))
      
      // Auto-select and focus the new center
      setSelectedCenterId(newCenter.id)
      setMapFocus({
        lat: Number(newCenter.latitude),
        lng: Number(newCenter.longitude),
        zoom: 12
      })
      
      toast(`Delivery center "${newCenter.name}" added. Auto-capturing nearby orders...`)
      
      // Trigger route generation and data sync in background without blocking UI
      generateRoutesAction(newCenter.id).then(() => {
        refreshOrders()
        refreshVehicles()
      })
      
      return newCenter
    } catch (e) {
      const msg = e?.response?.data?.message || e.message || 'Failed to add center'
      toast(msg, 'error')
      throw e
    } finally {
      setLoading((l) => ({ ...l, addCenter: false }))
    }
  }, [setCenters, toast, refreshOrders, refreshVehicles, generateRoutesAction])

  const addOrderAction = useCallback(async (payload) => {
    setLoading((l) => ({ ...l, addOrder: true }))
    try {
      const response = await api.createOrder(payload)
      const newOrder = response.data || response
      
      // Fast refresh: Update orders state if it matches current date
      const orderDate = newOrder.delivery_date?.split('T')[0]
      if (orderDate === selectedDate) {
        setOrders(prev => [newOrder, ...prev])
      }
      
      toast(`Order created and geocoded.`)
      return newOrder
    } catch (e) {
      const msg = e?.response?.data?.message || e.message || 'Failed to create order'
      toast(msg, 'error')
      throw e
    } finally {
      setLoading((l) => ({ ...l, addOrder: false }))
    }
  }, [selectedDate, setOrders, toast])

  const addVehicleAction = useCallback(async (payload) => {
    setLoading((l) => ({ ...l, addVehicle: true }))
    try {
      const response = await api.createVehicle(payload)
      const newVehicle = response.data || response
      
      // Fast refresh: Update vehicles state immediately
      setVehicles(prev => [...prev, newVehicle])
      
      toast(`Vehicle ${newVehicle.vehicle_number} added.`)
      return newVehicle
    } catch (e) {
      const msg = e?.response?.data?.message || e.message || 'Failed to add vehicle'
      toast(msg, 'error')
      throw e
    } finally {
      setLoading((l) => ({ ...l, addVehicle: false }))
    }
  }, [setVehicles, toast])

  const selectRouteFromList = useCallback((route) => {
    const stripped = normalizeRouteForSimulation(stripMeta(route))
    setActiveRouteBase(stripped)
  }, [])


  const addDraftDelivery = useCallback((delivery) => {
    setDraftDeliveries((prev) => [...prev, { ...delivery, id: Date.now() }])
  }, [])

  const removeDraftDelivery = useCallback((id) => {
    setDraftDeliveries((prev) => prev.filter((d) => d.id !== id))
  }, [])

  const startFleetSimulation = useCallback((routesOverride = null) => {
    const baseRoutes = routesOverride || (activeMultiRoutes.length > 0 ? activeMultiRoutes : activeRoute ? [activeRoute] : [])
    const routesToSimulate = baseRoutes.filter(r => {
      // Find latest availability from state
      const latestVehicle = vehicles.find(v => String(v.id) === String(r.vehicle_id || r.vehicle?.id))
      const isAvailable = latestVehicle ? latestVehicle.is_available : (r.vehicle?.is_available ?? true)
      
      // Only simulate if the route is already in progress 
      // OR if it's a planned route and the vehicle is currently available
      return r.status === 'in_progress' || isAvailable
    })

    if (!routesToSimulate.length) {
      toast('No active or planned routes for available vehicles found.', 'info')
      return
    }

    /** @type {Record<string, Array<[number, number]>>} */
    const paths = {}

    for (const r of routesToSimulate) {
      const vid = String(r?.vehicle_id ?? r.vehicle?.id ?? '')
      if (!vid || vid === 'undefined') continue
      const pts = buildPlaybackPathForRoute(r, centers)
      if (pts.length >= 2) {
        paths[vid] = pts
      }
    }

    const keys = Object.keys(paths)

    if (keys.length === 0) {
      toast(
        'No path to animate. Optimize routes again, or check that stops have latitude/longitude.',
        'error'
      )
      return
    }

    clearPlaybackTimer()
    playbackPathsRef.current = paths
    setRoutePlaybackCoords(paths)

    const initialSteps = {}
    keys.forEach((k) => {
      initialSteps[k] = 0
    })
    setRoutePlaybackStep(initialSteps)

    setSimulationPhase('running')
    runPlaybackTimer()
    toast(`Moving ${keys.length} vehicle(s) along the route.`)
  }, [activeMultiRoutes, activeRoute, centers, toast, clearPlaybackTimer, runPlaybackTimer])

  const pauseFleetSimulation = useCallback(() => {
    clearPlaybackTimer()
    setSimulationPhase((p) => (p === 'running' ? 'paused' : p))
  }, [clearPlaybackTimer])

  const resumeFleetSimulation = useCallback(() => {
    setSimulationPhase((p) => {
      if (p !== 'paused') return p
      window.setTimeout(() => runPlaybackTimer(), 0)
      return 'running'
    })
  }, [runPlaybackTimer])

  const resetFleetAction = useCallback(async (centerId = null) => {
    setLoading((l) => ({ ...l, resetFleet: true }))

    // Store previous state for rollback
    const prevVehicles = vehicles;
    
    // Optimistic Update
    setVehicles(prev => prev.map(v => {
      if (centerId && String(v.delivery_center_id) !== String(centerId)) return v;
      return { ...v, is_available: true };
    }));

    try {
      const payload = centerId ? { delivery_center_id: centerId } : {}
      await api.resetFleet(payload)
      await Promise.all([refreshVehicles(), refreshRoutes(), refreshOrders()])
      toast('Fleet status reset to available.')
    } catch {
      // Rollback
      setVehicles(prevVehicles)
      toast('Failed to reset fleet.', 'error')
    } finally {
      setLoading((l) => ({ ...l, resetFleet: false }))
    }
  }, [vehicles, refreshVehicles, refreshRoutes, refreshOrders, toast])

  const toggleVehicleAvailability = useCallback(async (vehicleId, currentStatus) => {
    const wasSimulating = simulationPhase === 'running' || simulationPhase === 'paused'

    // Force instant clear of map and simulation
    setActiveMultiRoutes([])
    setActiveRouteBase(null)
    resetFleetSimulation({ silent: true })

    setLoading((l) => ({ ...l, updateVehicle: true }))

    // Optimistic update
    setVehicles(prev => prev.map(v => String(v.id) === String(vehicleId) ? { ...v, is_available: !currentStatus } : v))

    try {
      await api.updateVehicle(vehicleId, { is_available: !currentStatus })
      await refreshVehicles()
      
      // If we have a center selected, we MUST regenerate routes to reflect the new fleet capacity
      if (selectedCenterId) {
        // We use generateRoutesAction which will handle the API call and update activeMultiRoutes
        const newRoutes = await generateRoutesAction(selectedCenterId)
        
        // If we were simulating before, restart it with the new routes
        if (wasSimulating && newRoutes) {
          // Small delay to ensure the new routes are rendered on the map before building animation paths
          setTimeout(() => startFleetSimulation(newRoutes), 100)
        }
      }
      
      toast(`Vehicle marked as ${!currentStatus ? 'available' : 'busy'}.`)
    } catch (e) {
      // Rollback on error
      setVehicles(prev => prev.map(v => String(v.id) === String(vehicleId) ? { ...v, is_available: currentStatus } : v))
      toast('Failed to update vehicle status', 'error')
    } finally {
      setLoading((l) => ({ ...l, updateVehicle: false }))
    }
  }, [selectedCenterId, generateRoutesAction, refreshVehicles, toast, resetFleetSimulation, simulationPhase, startFleetSimulation])

  const clearDraftDeliveries = useCallback(() => {
    setDraftDeliveries([])
  }, [])

  // When selectedDate changes, refresh orders and clear route state
  useEffect(() => {
    refreshOrders()
    // Clear any active routes/simulation when date changes
    setActiveRouteBase(null)
    setActiveMultiRoutes([])
    setComparisons([])
    resetFleetSimulation({ silent: true })
  }, [selectedDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync active routes stops with latest order statuses
  useEffect(() => {
    if (orders.length === 0 || activeMultiRoutes.length === 0) return

    setActiveMultiRoutes(prev => {
      let globalChanged = false
      const next = prev.map(route => {
        const remainingStops = route.stops.filter(stop => {
          const latestOrder = orders.find(o => String(o.id) === String(stop.order_id))
          return !latestOrder || latestOrder.status !== 'delivered'
        })
        
        if (remainingStops.length !== route.stops.length) {
          globalChanged = true
          // Re-sequence the remaining stops if necessary, though sequence is usually fixed
          return { ...route, stops: remainingStops }
        }
        return route
      })
      
      return globalChanged ? next : prev
    })

    // Also sync the single activeRouteBase
    setActiveRouteBase(prev => {
      if (!prev) return prev
      const remainingStops = prev.stops.filter(stop => {
        const latestOrder = orders.find(o => String(o.id) === String(stop.order_id))
        return !latestOrder || latestOrder.status !== 'delivered'
      })
      if (remainingStops.length !== prev.stops.length) {
        return { ...prev, stops: remainingStops }
      }
      return prev
    })
  }, [orders])

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
      centers,
      orders,
      setOrders,
      vehicles,
      setVehicles,
      routesList,
      comparisons,
      setComparisons,
      activeRoute,
      setActiveRoute,
      activeMultiRoutes,
      setActiveMultiRoutes,
      setActiveRouteBase,
      selectedCenterId,
      setSelectedCenterId,
      selectedDate,
      setSelectedDate,
      activeOrderId,
      setActiveOrderId,
      loading,
      setLoading,
      toasts,
      dismissToast,
      toast,
      refreshCenters,
      refreshOrders,
      refreshVehicles,
      refreshRoutes,
      bootstrap,
      generateRoutesAction,
      selectRouteFromList,
      vehiclePosition,
      bootstrapError,
      mapFocus,
      setMapFocus,
      addCenterAction,
      addOrderAction,
      addVehicleAction,
      draftDeliveries,
      addDraftDelivery,
      removeDraftDelivery,
      clearDraftDeliveries,
      simulationPhase,
      isSimulating: simulationPhase === 'running',
      routePlaybackCoords,
      routePlaybackStep,
      startFleetSimulation,
      pauseFleetSimulation,
      resumeFleetSimulation,
      resetFleetSimulation,
      resetSelection,
      resetFleetAction,
      serviceZones,
      showZones,
      setShowZones,
      refreshZones,
      generateVoronoiZonesAction,
      toggleVehicleAvailability,
      orderFilters,
      setOrderFilters,
    }),
    [
      theme,
      toggleTheme,
      centers,
      orders,
      setOrders,
      vehicles,
      setVehicles,
      routesList,
      comparisons,
      activeRoute,
      setActiveRoute,
      activeMultiRoutes,
      setActiveMultiRoutes,
      setActiveRouteBase,
      selectedCenterId,
      selectedDate,
      activeOrderId,
      loading,
      setLoading,
      toasts,
      dismissToast,
      toast,
      refreshCenters,
      refreshOrders,
      refreshVehicles,
      refreshRoutes,
      bootstrap,
      generateRoutesAction,
      selectRouteFromList,
      vehiclePosition,
      bootstrapError,
      mapFocus,
      setMapFocus,
      addCenterAction,
      draftDeliveries,
      addDraftDelivery,
      removeDraftDelivery,
      clearDraftDeliveries,
      simulationPhase,
      routePlaybackCoords,
      routePlaybackStep,
      startFleetSimulation,
      pauseFleetSimulation,
      resumeFleetSimulation,
      resetFleetSimulation,
      resetSelection,
      resetFleetAction,
      serviceZones,
      showZones,
      refreshZones,
      generateVoronoiZonesAction,
      toggleVehicleAvailability,
      orderFilters,
    ]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
